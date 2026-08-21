import { describe, expect, it, vi } from 'vitest'

import {
  createAiSdkQuickStartPlanner,
  quickStartPlannerInstructions,
  type QuickStartGenerateText,
} from './planner'

describe('quickStartPlannerInstructions', () => {
  it('keeps readiness, direct-generation, negative intent, and one-question rules in the model', () => {
    const firstTurn = quickStartPlannerInstructions(false)
    const laterTurn = quickStartPlannerInstructions(true)

    expect(firstTurn).toContain('最多追问一个')
    expect(firstTurn).toContain('直接生成')
    expect(firstTurn).toContain('不要生成')
    expect(firstTurn).toContain('不得依赖关键词匹配')
    expect(firstTurn).toContain('交给用户检查和编辑')
    expect(firstTurn).toContain('不得输出思维过程')
    expect(laterTurn).toContain('追问额度已经用完')
    expect(laterTurn).toContain('必要补全直接写入 optimizedPrompt')
  })
})

describe('createAiSdkQuickStartPlanner', () => {
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
    expect(options?.toolChoice).toBe('auto')
    expect(Object.keys(options?.tools ?? {})).toEqual(['start_character_generation'])
    expect(options?.tools?.start_character_generation?.execute).toBeUndefined()
    expect(options?.messages).toEqual([{ role: 'user', content: '直接生成银发骑士' }])
  })
})
