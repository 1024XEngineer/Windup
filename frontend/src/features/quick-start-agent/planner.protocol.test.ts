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
    expect((captured.tools as unknown[] | undefined)?.length).toBe(1)
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

  it('rejects a Tool Call whose arguments fail the declared schema', async () => {
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      fetch: vi.fn(async () =>
        completion({
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-invalid',
                type: 'function',
                function: {
                  name: 'start_character_generation',
                  arguments: '{"optimizedPrompt":"","optimizationSummary":"我会整理角色描述。"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        }),
      ),
    })

    const result = await planner({
      messages: [{ role: 'user', content: '直接生成' }],
      clarificationUsed: false,
    })

    expect(() => validatePlannerTerminal(result)).toThrow('生成提案的 optimizedPrompt 无效')
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
