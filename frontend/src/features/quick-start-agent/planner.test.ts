import { describe, expect, it, vi } from 'vitest'

import {
  createAiSdkQuickStartPlanner,
  quickStartPlannerInstructions,
  type QuickStartGenerateText,
} from './planner'

describe('quickStartPlannerInstructions', () => {
  it('separates conversation, optional proposals, and generation authorization', () => {
    const firstTurn = quickStartPlannerInstructions(false)
    const laterTurn = quickStartPlannerInstructions(true)

    expect(firstTurn).toContain('最多问一个')
    expect(firstTurn).toContain('直接生成')
    expect(firstTurn).toContain('proposal 只是提案，不代表用户授权生成')
    expect(firstTurn).toContain('角色和动作')
    expect(firstTurn).toContain('actionPrompt')
    expect(firstTurn).toContain('suggestPixelPerfect')
    expect(firstTurn).toContain('明确表达像素风素材意图')
    expect(firstTurn).toContain('actionType: "idle"、"walk"、"attack" 或 "jump"')
    expect(firstTurn).toContain('locomotion: true')
    expect(firstTurn).toContain('两项判断互相独立')
    expect(firstTurn).toContain('不得只靠关键词')
    expect(firstTurn).toContain('对话轮数永远不是 proposal 的触发条件')
    expect(firstTurn).toContain('咨询或元对话必须用 reply')
    expect(firstTurn).toContain('不得输出思维过程')
    expect(laterTurn).toContain('不得因为轮数强制生成')
    expect(laterTurn).toContain('不得再问第二个澄清问题')
    expect(laterTurn).toContain('可继续补充')
  })
})

describe('createAiSdkQuickStartPlanner', () => {
  it('treats the selected art style as fixed context when drafting prompts', async () => {
    const generate = vi.fn<QuickStartGenerateText>(async () => ({
      text: '可以继续。',
      finishReason: 'stop',
      toolCalls: [],
    }))
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      generateText: generate,
    })

    await planner({
      messages: [{ role: 'user', content: '一个住在云端的机械师' }],
      clarificationUsed: false,
      artStyle: '像素',
    })

    expect(generate.mock.calls[0]?.[0].instructions).toContain('用户当前选择的画风是「像素」')

    await planner({
      messages: [{ role: 'user', content: '一个住在云端的机械师' }],
      clarificationUsed: false,
    })
    expect(generate.mock.calls[1]?.[0].instructions).not.toContain('用户当前选择的画风')
  })

  it('uses one schema-only Tool, non-streaming generateText, and no SDK retries', async () => {
    const signal = new AbortController().signal
    const generate = vi.fn<QuickStartGenerateText>(async () => ({
      text: '',
      finishReason: 'tool-calls' as const,
      toolCalls: [
        {
          toolName: 'start_character_generation',
          input: {
            optimizedPrompt: '银发像素骑士全身像',
            optimizationSummary: '我会保留银发骑士特征，并整理为完整的全身母版描述。',
          },
        },
      ],
    }))
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      modelId: 'quick-start-planner',
      fetch: vi.fn(),
      generateText: generate,
    })

    await expect(
      planner({
        messages: [{ role: 'user', content: '直接生成银发骑士' }],
        clarificationUsed: false,
        signal,
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

    const options = generate.mock.calls[0]?.[0]
    expect(options?.maxRetries).toBe(0)
    expect(options?.abortSignal).toBe(signal)
    expect(options?.toolChoice).toBe('required')
    expect(Object.keys(options?.tools ?? {})).toEqual(['quick_start_decision'])
    expect(options?.tools?.quick_start_decision?.execute).toBeUndefined()
    expect(options?.messages).toEqual([{ role: 'user', content: '直接生成银发骑士' }])
  })

  it('exposes only Controller actions allowed by the current workflow snapshot', async () => {
    const generate = vi.fn<QuickStartGenerateText>(async () => ({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolName: 'refine_character_template',
          input: { adjustmentPrompt: '把披风改成深蓝色' },
        },
      ],
    }))
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      generateText: generate,
    })

    await planner({
      messages: [{ role: 'user', content: '把披风改成深蓝色' }],
      clarificationUsed: false,
      workflow: {
        availableTools: ['regenerate_character_template', 'refine_character_template'],
      },
    })

    const options = generate.mock.calls[0]?.[0]
    expect(options?.toolChoice).toBe('auto')
    expect(Object.keys(options?.tools ?? {})).toEqual([
      'regenerate_character_template',
      'refine_character_template',
    ])
    expect(options?.tools?.refine_character_template?.execute).toBeUndefined()
    expect(options?.tools?.regenerate_first_frame).toBeUndefined()
  })

  it('keeps the request within the backend message limit while preserving the latest turn', async () => {
    const generate = vi.fn<QuickStartGenerateText>(async () => ({
      text: '可以继续。',
      finishReason: 'stop',
      toolCalls: [],
    }))
    const planner = createAiSdkQuickStartPlanner({
      baseURL: 'https://api.windup.test/ai/v1',
      generateText: generate,
    })
    const messages = Array.from({ length: 19 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `消息 ${index + 1}`,
    }))

    await planner({ messages, clarificationUsed: true })

    expect(generate.mock.calls[0]?.[0].messages).toEqual(messages.slice(-15))
    expect(generate.mock.calls[0]?.[0].messages.at(-1)).toEqual({
      role: 'user',
      content: '消息 19',
    })
  })
})
