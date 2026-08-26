import { describe, expect, it, vi } from 'vitest'

import { createAiSdkQuickStartPlanner } from './planner'
import { validatePlannerTerminal } from './runtime'

function completion(choice: Record<string, unknown>) {
  return Response.json({
    id: 'chatcmpl-fixture',
    object: 'chat.completion',
    created: 1,
    model: 'server-model',
    choices: [{ index: 0, ...choice }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })
}

describe('AI SDK OpenAI-compatible protocol fixture', () => {
  it('parses a standard text completion without a custom response parser', async () => {
    let requestBody: Record<string, unknown> | null = null
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      fetch: vi.fn(async (input, init) => {
        requestBody = JSON.parse(await new Request(input, init).text())
        return completion({
          message: { role: 'assistant', content: '请补充一个外观特征。' },
          finish_reason: 'stop',
        })
      }),
    })

    await expect(
      planner({
        messages: [{ role: 'user', content: '一个角色' }],
        clarificationUsed: false,
      }),
    ).resolves.toEqual({
      text: '请补充一个外观特征。',
      finishReason: 'stop',
      toolCalls: [],
    })
    const captured = requestBody as unknown as Record<string, unknown>
    expect(captured).toMatchObject({
      model: 'quick-start-planner',
      tool_choice: 'required',
    })
    expect(captured.stream).toBeUndefined()
    const tools = captured.tools as
      | Array<{ function?: { parameters?: { oneOf?: Array<{ required?: string[] }> } } }>
      | undefined
    expect(tools).toHaveLength(1)
    expect(tools?.[0]?.function?.parameters?.oneOf).toEqual([
      expect.objectContaining({
        required: ['kind', 'optimizedPrompt', 'optimizationSummary'],
      }),
      expect.objectContaining({ required: ['kind', 'message'] }),
    ])
  })

  it('parses one standard Tool Call and normalizes its finish reason', async () => {
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      fetch: vi.fn(async () =>
        completion({
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'start_character_generation',
                  arguments:
                    '{"optimizedPrompt":"银发像素骑士全身像","optimizationSummary":"我会保留银发骑士特征，并整理为完整的全身母版描述。"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        }),
      ),
    })

    await expect(
      planner({
        messages: [{ role: 'user', content: '直接生成银发骑士' }],
        clarificationUsed: false,
      }),
    ).resolves.toEqual({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolName: 'start_character_generation',
          input: {
            optimizedPrompt: '银发像素骑士全身像',
            optimizationSummary: '我会保留银发骑士特征，并整理为完整的全身母版描述。',
          },
        },
      ],
    })
  })

  it('declares candidate handles for an indexed character refinement', async () => {
    let requestBody: Record<string, unknown> | null = null
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      fetch: vi.fn(async (input, init) => {
        requestBody = JSON.parse(await new Request(input, init).text())
        return completion({
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-refine-candidate',
                type: 'function',
                function: {
                  name: 'refine_character_template',
                  arguments: '{"candidateId":"candidate-2","adjustmentPrompt":"把牛角缩短"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        })
      }),
    })

    await expect(
      planner({
        messages: [{ role: 'user', content: '把第二张的牛角缩短' }],
        clarificationUsed: false,
        workflow: {
          availableTools: ['regenerate_character_template', 'refine_character_template'],
          characterTemplateCandidates: [
            { id: 'candidate-1', position: 1 },
            { id: 'candidate-2', position: 2 },
            { id: 'candidate-3', position: 3 },
          ],
        },
      }),
    ).resolves.toEqual({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolName: 'refine_character_template',
          input: { candidateId: 'candidate-2', adjustmentPrompt: '把牛角缩短' },
        },
      ],
    })
    expect(JSON.stringify(requestBody)).toContain('第 2 张对应 candidate-2')
  })

  it('repairs the production proposal shape when the summary is returned as message', async () => {
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      fetch: vi.fn(async () =>
        completion({
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-production-shape',
                type: 'function',
                function: {
                  name: 'quick_start_decision',
                  arguments:
                    '{"kind":"proposal","message":"我保留了斗篷骑士的核心特征。","optimizedPrompt":"披着深色斗篷的全身骑士"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        }),
      ),
    })

    await expect(
      planner({
        messages: [{ role: 'user', content: '生成一个披着斗篷的骑士' }],
        clarificationUsed: false,
      }),
    ).resolves.toEqual({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolName: 'quick_start_decision',
          input: {
            kind: 'proposal',
            optimizedPrompt: '披着深色斗篷的全身骑士',
            optimizationSummary: '我保留了斗篷骑士的核心特征。',
          },
        },
      ],
    })
  })

  it('re-asks once for an irreparable Tool Call and returns the repaired proposal', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        completion({
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-invalid',
                type: 'function',
                function: {
                  name: 'quick_start_decision',
                  arguments: '{"kind":"proposal","message":"已经整理好了。"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        }),
      )
      .mockResolvedValueOnce(
        completion({
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-repaired',
                type: 'function',
                function: {
                  name: 'quick_start_decision',
                  arguments:
                    '{"kind":"proposal","optimizedPrompt":"披着斗篷的全身骑士","optimizationSummary":"补齐了完整的角色母版描述。"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        }),
      )
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      fetch,
    })

    const result = await planner({
      messages: [{ role: 'user', content: '生成一个披着斗篷的骑士' }],
      clarificationUsed: false,
    })

    expect(validatePlannerTerminal(result)).toEqual({
      kind: 'proposal',
      optimizedPrompt: '披着斗篷的全身骑士',
      optimizationSummary: '补齐了完整的角色母版描述。',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('falls back to a confirmable original prompt after one failed repair', async () => {
    const invalid = () =>
      completion({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-still-invalid',
              type: 'function',
              function: {
                name: 'quick_start_decision',
                arguments: '{"kind":"proposal"}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      })
    const fetch = vi.fn<typeof globalThis.fetch>(async () => invalid())
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      fetch,
    })

    const result = await planner({
      messages: [{ role: 'user', content: '生成一个披着斗篷的骑士' }],
      clarificationUsed: false,
    })

    expect(validatePlannerTerminal(result)).toEqual({
      kind: 'proposal',
      optimizedPrompt: '生成一个披着斗篷的骑士',
      optimizationSummary: '我先完整保留了你的原始描述，你可以直接采用或继续补充细节。',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('surfaces a standard 401 and honors cancellation', async () => {
    const unauthorized = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      fetch: vi.fn(async () =>
        Response.json(
          { error: { message: 'expired', type: 'authentication_error' } },
          { status: 401 },
        ),
      ),
    })
    await expect(
      unauthorized({
        messages: [{ role: 'user', content: '一个角色' }],
        clarificationUsed: false,
      }),
    ).rejects.toThrow()

    const abortController = new AbortController()
    const pending = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      fetch: vi.fn(
        async (input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = new Request(input, init).signal
            if (signal.aborted) {
              reject(new DOMException('aborted', 'AbortError'))
              return
            }
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    })
    const request = pending({
      messages: [{ role: 'user', content: '一个角色' }],
      clarificationUsed: false,
      signal: abortController.signal,
    })
    abortController.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })
})
