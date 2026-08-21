import { describe, expect, it, vi } from 'vitest'

import {
  createQuickStartAgent,
  parseCharacterGenerationPlan,
  validatePlannerTerminal,
  type PlannerResult,
  type QuickStartPlanner,
  type StartCharacterGenerationAction,
} from './runtime'

function plannerResult(overrides: Partial<PlannerResult> = {}): PlannerResult {
  return {
    text: '',
    finishReason: 'tool-calls',
    toolCalls: [
      {
        toolName: 'start_character_generation',
        input: {
          optimizedPrompt: '完整身体的银发像素骑士',
          optimizationSummary: '我会保留银发骑士的身份特征，并补全适合角色母版的全身描述。',
        },
      },
    ],
    ...overrides,
  }
}

function fixture(result: PlannerResult = plannerResult()) {
  const planner = vi.fn<QuickStartPlanner>(async () => result)
  const startCharacterGeneration = vi.fn<StartCharacterGenerationAction>(async () => ({
    runId: 'run-1',
  }))
  const agent = createQuickStartAgent({ planner, startCharacterGeneration })
  return { agent, planner, startCharacterGeneration }
}

describe('validatePlannerTerminal', () => {
  it('accepts one complete, schema-valid write Tool Call', () => {
    expect(validatePlannerTerminal(plannerResult())).toEqual({
      kind: 'tool',
      optimizedPrompt: '完整身体的银发像素骑士',
      optimizationSummary: '我会保留银发骑士的身份特征，并补全适合角色母版的全身描述。',
    })
  })

  it('accepts a complete text response without treating it as an action', () => {
    expect(
      validatePlannerTerminal(
        plannerResult({
          text: '请补充角色的身份或外观特征。',
          finishReason: 'stop',
          toolCalls: [],
        }),
      ),
    ).toEqual({ kind: 'message', message: '请补充角色的身份或外观特征。' })
  })

  it.each([
    ['unknown Tool', plannerResult({ toolCalls: [{ toolName: 'other_tool', input: {} }] })],
    [
      'multiple Tools',
      plannerResult({
        toolCalls: [plannerResult().toolCalls[0]!, plannerResult().toolCalls[0]!],
      }),
    ],
    [
      'invalid Tool input',
      plannerResult({
        toolCalls: [
          {
            toolName: 'start_character_generation',
            input: {
              optimizedPrompt: ' ',
              optimizationSummary: '我会整理角色描述。',
            },
          },
        ],
      }),
    ],
    ['unfinished Tool response', plannerResult({ finishReason: 'stop' })],
  ])('fails closed for %s', (_label, result) => {
    expect(() => validatePlannerTerminal(result)).toThrow()
  })

  it('rejects an incomplete text terminal result', () => {
    expect(() =>
      validatePlannerTerminal(plannerResult({ text: '', finishReason: 'stop', toolCalls: [] })),
    ).toThrow('Planner 未返回完整的文字响应')
  })
})

describe('parseCharacterGenerationPlan', () => {
  it.each([
    [
      'unknown fields',
      {
        optimizedPrompt: '像素骑士',
        optimizationSummary: '我会整理角色描述。',
        unexpected: true,
      },
      '生成 Tool 参数字段无效',
    ],
    ['missing optimization summary', { optimizedPrompt: '像素骑士' }, '生成 Tool 参数字段无效'],
    [
      'empty optimization summary',
      { optimizedPrompt: '像素骑士', optimizationSummary: ' ' },
      '生成 Tool 的 optimizationSummary 无效',
    ],
  ])('rejects %s', (_label, input, message) => {
    expect(() => parseCharacterGenerationPlan(input)).toThrow(message)
  })
})

describe('createQuickStartAgent', () => {
  it('revokes authorization when the request is already cancelled', async () => {
    const { agent, planner, startCharacterGeneration } = fixture()
    const abortController = new AbortController()
    abortController.abort()

    await expect(agent.start('直接生成', { signal: abortController.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    )
    await expect(agent.continue('再试一次')).rejects.toThrow('生成授权已失效')
    expect(planner).not.toHaveBeenCalled()
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('revokes authorization when cancellation happens while planning', async () => {
    let resolvePlanner: ((result: PlannerResult) => void) | undefined
    const planner = vi.fn<QuickStartPlanner>(
      () =>
        new Promise((resolve) => {
          resolvePlanner = resolve
        }),
    )
    const startCharacterGeneration = vi.fn<StartCharacterGenerationAction>(async () => ({
      runId: 'run-should-not-exist',
    }))
    const agent = createQuickStartAgent({ planner, startCharacterGeneration })
    const abortController = new AbortController()

    const request = agent.start('直接生成', { signal: abortController.signal })
    await vi.waitFor(() => expect(planner).toHaveBeenCalledTimes(1))
    abortController.abort()
    resolvePlanner?.(plannerResult())

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await expect(agent.continue('再试一次')).rejects.toThrow('生成授权已失效')
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('dispatches the user-edited prompt once after presenting the proposal', async () => {
    const { agent, startCharacterGeneration } = fixture()
    const events: string[] = []
    startCharacterGeneration.mockImplementation(async () => {
      events.push('action')
      return { runId: 'run-1' }
    })

    await expect(
      agent.start('银发骑士', {
        onBeforeDispatch: async (plan) => {
          events.push(`visible:${plan.optimizedPrompt}`)
          return '完整身体的银发像素骑士，深蓝斗篷'
        },
      }),
    ).resolves.toEqual({
      kind: 'generated',
      runId: 'run-1',
      optimizedPrompt: '完整身体的银发像素骑士，深蓝斗篷',
      optimizationSummary: '我会保留银发骑士的身份特征，并补全适合角色母版的全身描述。',
    })

    expect(events).toEqual(['visible:完整身体的银发像素骑士', 'action'])
    expect(startCharacterGeneration).toHaveBeenCalledTimes(1)
    expect(startCharacterGeneration).toHaveBeenCalledWith({
      prompt: '完整身体的银发像素骑士，深蓝斗篷',
    })
  })

  it('rejects an explicitly cleared prompt without dispatching the write action', async () => {
    const { agent, startCharacterGeneration } = fixture()

    await expect(
      agent.start('银发骑士', {
        onBeforeDispatch: async () => '   ',
      }),
    ).rejects.toThrow('确认后的角色提示词无效')

    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('keeps a text-only response side-effect free and spends at most one clarification', async () => {
    const { agent, planner, startCharacterGeneration } = fixture(
      plannerResult({ text: '最希望保留什么外观特征？', finishReason: 'stop', toolCalls: [] }),
    )

    await expect(agent.start('一个角色')).resolves.toEqual({
      kind: 'message',
      message: '最希望保留什么外观特征？',
    })
    vi.mocked(planner).mockResolvedValueOnce(plannerResult())
    await agent.continue('银色卷发')

    expect(planner).toHaveBeenNthCalledWith(2, expect.objectContaining({ clarificationUsed: true }))
    expect(startCharacterGeneration).toHaveBeenCalledTimes(1)
  })

  it('ends an unresolved conversation after the single clarification turn', async () => {
    const textResult = plannerResult({
      text: '这个请求仍有冲突，请修改后重新开始。',
      finishReason: 'stop',
      toolCalls: [],
    })
    const { agent, planner, startCharacterGeneration } = fixture(textResult)

    await expect(agent.start('一个角色')).resolves.toEqual({
      kind: 'message',
      message: '这个请求仍有冲突，请修改后重新开始。',
    })
    await expect(agent.continue('补充说明')).resolves.toEqual({
      kind: 'message',
      message: '这个请求仍有冲突，请修改后重新开始。',
    })
    await expect(agent.continue('再追问一次')).rejects.toThrow('生成授权已失效')

    expect(planner).toHaveBeenCalledTimes(2)
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('does not dispatch an unknown, duplicate, invalid, or text-only terminal result', async () => {
    const cases = [
      plannerResult({ toolCalls: [{ toolName: 'unknown', input: {} }] }),
      plannerResult({
        toolCalls: [plannerResult().toolCalls[0]!, plannerResult().toolCalls[0]!],
      }),
      plannerResult({
        toolCalls: [
          {
            toolName: 'start_character_generation',
            input: { optimizedPrompt: '', optimizationSummary: '我会整理角色描述。' },
          },
        ],
      }),
    ]

    for (const result of cases) {
      const { agent, startCharacterGeneration } = fixture(result)
      await expect(agent.start('直接生成')).rejects.toThrow()
      expect(startCharacterGeneration).not.toHaveBeenCalled()
    }

    const textOnly = fixture(
      plannerResult({
        text: '这个请求目前不能生成，请修改。',
        finishReason: 'stop',
        toolCalls: [],
      }),
    )
    await expect(textOnly.agent.start('不要生成，只润色')).resolves.toEqual({
      kind: 'message',
      message: '这个请求目前不能生成，请修改。',
    })
    expect(textOnly.startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('does not dispatch when cancellation happens before the write starts', async () => {
    const { agent, startCharacterGeneration } = fixture()
    const abortController = new AbortController()

    await expect(
      agent.start('直接生成', {
        signal: abortController.signal,
        onBeforeDispatch: async () => abortController.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('does not pretend a dispatched action was cancelled', async () => {
    let resolveWrite: ((result: { runId: string }) => void) | undefined
    const { agent, startCharacterGeneration } = fixture()
    startCharacterGeneration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve
        }),
    )
    const abortController = new AbortController()

    const result = agent.start('直接生成', { signal: abortController.signal })
    await vi.waitFor(() => expect(startCharacterGeneration).toHaveBeenCalledTimes(1))
    abortController.abort()
    resolveWrite?.({ runId: 'run-accepted' })

    await expect(result).resolves.toMatchObject({ kind: 'generated', runId: 'run-accepted' })
  })

  it('revokes unused authorization and never calls the action afterwards', async () => {
    const { agent, startCharacterGeneration } = fixture()
    agent.revoke()

    await expect(agent.start('直接生成')).rejects.toThrow('生成授权已失效')
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('never retries or replays the write action after an uncertain failure', async () => {
    const { agent, startCharacterGeneration } = fixture()
    startCharacterGeneration.mockRejectedValueOnce(new Error('generation response lost'))

    await expect(agent.start('直接生成')).rejects.toThrow('generation response lost')
    await expect(agent.continue('再试一次')).rejects.toThrow('生成授权已使用')
    expect(startCharacterGeneration).toHaveBeenCalledTimes(1)
  })
})
