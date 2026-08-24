import { describe, expect, it, vi } from 'vitest'

import {
  createQuickStartAgent,
  parseQuickStartDecision,
  validatePlannerTerminal,
  type PlannerResult,
  type QuickStartDecision,
  type QuickStartPlanner,
  type StartCharacterGenerationAction,
} from './runtime'

function decisionResult(input: QuickStartDecision): PlannerResult {
  return {
    text: '',
    finishReason: 'tool-calls',
    toolCalls: [{ toolName: 'quick_start_decision', input }],
  }
}

function proposalResult(prompt = '完整身体的银发像素骑士'): PlannerResult {
  return decisionResult({
    kind: 'proposal',
    optimizedPrompt: prompt,
    optimizationSummary: '我会保留银发骑士特征，并整理成完整的全身母版描述。',
  })
}

function fixture(result: PlannerResult = proposalResult()) {
  const planner = vi.fn<QuickStartPlanner>(async () => result)
  const startCharacterGeneration = vi.fn<StartCharacterGenerationAction>(async () => ({
    runId: 'run-1',
  }))
  const agent = createQuickStartAgent({ planner, startCharacterGeneration })
  return { agent, planner, startCharacterGeneration }
}

describe('Planner decisions', () => {
  it.each([
    [{ kind: 'reply', message: '可以继续讨论。' }],
    [{ kind: 'clarification', message: '最想保留哪个外观特征？' }],
    [{ kind: 'blocked', message: '请先解决角色数量冲突。' }],
    [
      {
        kind: 'proposal',
        optimizedPrompt: '银发像素骑士全身像',
        optimizationSummary: '我会保留银发骑士特征。',
      },
    ],
  ] satisfies readonly [QuickStartDecision][])('validates %s', (decision) => {
    expect(validatePlannerTerminal(decisionResult(decision))).toEqual(decision)
  })

  it.each([
    [{ kind: 'reply', message: '' }, 'Planner 的文字决策无效'],
    [{ kind: 'reply', message: '可以', optimizedPrompt: '多余字段' }, 'Planner 文字决策字段无效'],
    [
      { kind: 'proposal', optimizedPrompt: '骑士', optimizationSummary: '' },
      '生成提案的 optimizationSummary 无效',
    ],
    [{ kind: 'unknown', message: '未知' }, 'Planner 决策类型无效'],
  ])('rejects malformed decision %#', (input, message) => {
    expect(() => parseQuickStartDecision(input)).toThrow(message)
  })

  it('fails closed for text-only, duplicate, or unknown decisions', () => {
    expect(() =>
      validatePlannerTerminal({ text: '', finishReason: 'stop', toolCalls: [] }),
    ).toThrow('Planner 的文字决策无效')
    expect(() =>
      validatePlannerTerminal({
        ...decisionResult({ kind: 'reply', message: '可以' }),
        toolCalls: [
          { toolName: 'quick_start_decision', input: { kind: 'reply', message: '一' } },
          { toolName: 'quick_start_decision', input: { kind: 'reply', message: '二' } },
        ],
      }),
    ).toThrow('Planner 每轮必须且只能返回一个决策')
    expect(() =>
      validatePlannerTerminal({
        ...decisionResult({ kind: 'reply', message: '可以' }),
        toolCalls: [{ toolName: 'other', input: { kind: 'reply', message: '可以' } }],
      }),
    ).toThrow('Planner 返回了未知决策')
  })
})

describe('createQuickStartAgent', () => {
  it('keeps ordinary replies conversational beyond one clarification', async () => {
    const results = [
      decisionResult({ kind: 'clarification', message: '请描述一个外观特征。' }),
      decisionResult({ kind: 'reply', message: '你刚才说想做银发骑士。' }),
      decisionResult({ kind: 'reply', message: '我们还可以继续比较披风方向。' }),
    ]
    const planner = vi.fn<QuickStartPlanner>(async () => results.shift()!)
    const startCharacterGeneration = vi.fn<StartCharacterGenerationAction>(async () => ({
      runId: 'run-should-not-exist',
    }))
    const agent = createQuickStartAgent({ planner, startCharacterGeneration })

    await expect(agent.start('银发骑士')).resolves.toMatchObject({
      kind: 'message',
      messageKind: 'clarification',
    })
    await expect(agent.continue('刚才我说了什么')).resolves.toMatchObject({
      kind: 'message',
      messageKind: 'reply',
    })
    await expect(agent.continue('你觉得披风怎么样')).resolves.toMatchObject({
      kind: 'message',
      messageKind: 'reply',
    })

    expect(planner.mock.calls[2]?.[0]).toMatchObject({
      clarificationUsed: true,
      messages: [
        { role: 'user', content: '银发骑士' },
        { role: 'assistant', content: '请描述一个外观特征。' },
        { role: 'user', content: '刚才我说了什么' },
        { role: 'assistant', content: '你刚才说想做银发骑士。' },
        { role: 'user', content: '你觉得披风怎么样' },
      ],
    })
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('hydrates the planner history and clarification state', async () => {
    const planner = vi.fn<QuickStartPlanner>(async () =>
      decisionResult({ kind: 'reply', message: '你最早描述的是机械师。' }),
    )
    const startCharacterGeneration = vi.fn<StartCharacterGenerationAction>(async () => ({
      runId: 'run-should-not-exist',
    }))
    const agent = createQuickStartAgent({
      planner,
      startCharacterGeneration,
      initialMessages: [
        { role: 'user', content: '云端机械师' },
        { role: 'assistant', content: '想保留什么外观特征？' },
      ],
      initialClarificationUsed: true,
    })

    await agent.continue('我刚才说了什么？')

    expect(planner).toHaveBeenCalledWith(
      expect.objectContaining({
        clarificationUsed: true,
        messages: [
          { role: 'user', content: '云端机械师' },
          { role: 'assistant', content: '想保留什么外观特征？' },
          { role: 'user', content: '我刚才说了什么？' },
        ],
      }),
    )
  })

  it('keeps a submitted user turn in history when the planner fails', async () => {
    const planner = vi
      .fn<QuickStartPlanner>()
      .mockRejectedValueOnce(new Error('planner unavailable'))
      .mockResolvedValueOnce(decisionResult({ kind: 'reply', message: '我会基于银发骑士继续。' }))
    const startCharacterGeneration = vi.fn<StartCharacterGenerationAction>()
    const agent = createQuickStartAgent({ planner, startCharacterGeneration })

    await expect(agent.start('银发骑士')).rejects.toThrow('planner unavailable')
    await agent.continue('请基于刚才内容继续')

    expect(planner.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: '银发骑士' },
      { role: 'user', content: '请基于刚才内容继续' },
    ])
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('returns a proposal without dispatching generation', async () => {
    const { agent, startCharacterGeneration } = fixture()

    await expect(agent.start('银发骑士')).resolves.toEqual({
      kind: 'proposal',
      proposalId: 'proposal-1',
      optimizedPrompt: '完整身体的银发像素骑士',
      optimizationSummary: '我会保留银发骑士特征，并整理成完整的全身母版描述。',
    })
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('invalidates the previous proposal when discussion continues', async () => {
    const { agent, planner, startCharacterGeneration } = fixture()
    const proposal = await agent.start('银发骑士')
    if (proposal.kind !== 'proposal') throw new Error('测试缺少提案')
    planner.mockResolvedValueOnce(decisionResult({ kind: 'reply', message: '可以比较两种披风。' }))

    await agent.continue('先讨论披风')

    await expect(
      agent.confirmProposal(proposal.proposalId, proposal.optimizedPrompt),
    ).rejects.toThrow('提示词提案已失效')
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('dispatches the edited prompt exactly once after explicit confirmation', async () => {
    const { agent, startCharacterGeneration } = fixture()
    const proposal = await agent.start('银发骑士')
    if (proposal.kind !== 'proposal') throw new Error('测试缺少提案')

    await expect(
      agent.confirmProposal(proposal.proposalId, '完整身体的银发像素骑士，深蓝斗篷'),
    ).resolves.toMatchObject({
      kind: 'generated',
      runId: 'run-1',
      optimizedPrompt: '完整身体的银发像素骑士，深蓝斗篷',
    })
    await expect(
      agent.confirmProposal(proposal.proposalId, proposal.optimizedPrompt),
    ).rejects.toThrow('生成授权已使用')
    expect(startCharacterGeneration).toHaveBeenCalledTimes(1)
    expect(startCharacterGeneration).toHaveBeenCalledWith({
      prompt: '完整身体的银发像素骑士，深蓝斗篷',
    })
  })

  it('restores a pending proposal without dispatching it', async () => {
    const planner = vi.fn<QuickStartPlanner>()
    const startCharacterGeneration = vi.fn<StartCharacterGenerationAction>(async () => ({
      runId: 'run-restored',
    }))
    const proposal = {
      proposalId: 'proposal-restored',
      optimizedPrompt: '云端机械师全身像',
      optimizationSummary: '我会保留云端机械师设定。',
    }
    const agent = createQuickStartAgent({
      planner,
      startCharacterGeneration,
      initialMessages: [
        { role: 'user', content: '云端机械师' },
        { role: 'assistant', content: '我会保留云端机械师设定。\n\n提示词提案：云端机械师全身像' },
      ],
      initialProposal: proposal,
    })

    expect(startCharacterGeneration).not.toHaveBeenCalled()
    await expect(
      agent.confirmProposal(proposal.proposalId, proposal.optimizedPrompt),
    ).resolves.toMatchObject({
      kind: 'generated',
      runId: 'run-restored',
    })
  })

  it('revokes authorization when planning is cancelled', async () => {
    let resolvePlanner: ((result: PlannerResult) => void) | undefined
    const planner = vi.fn<QuickStartPlanner>(
      () =>
        new Promise((resolve) => {
          resolvePlanner = resolve
        }),
    )
    const startCharacterGeneration = vi.fn<StartCharacterGenerationAction>()
    const agent = createQuickStartAgent({ planner, startCharacterGeneration })
    const controller = new AbortController()

    const pending = agent.start('银发骑士', { signal: controller.signal })
    await vi.waitFor(() => expect(planner).toHaveBeenCalledOnce())
    controller.abort()
    resolvePlanner?.(proposalResult())

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await expect(agent.continue('重试')).rejects.toThrow('生成授权已失效')
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('never replays an uncertain generation failure', async () => {
    const { agent, startCharacterGeneration } = fixture()
    startCharacterGeneration.mockRejectedValueOnce(new Error('generation response lost'))
    const proposal = await agent.start('银发骑士')
    if (proposal.kind !== 'proposal') throw new Error('测试缺少提案')

    await expect(
      agent.confirmProposal(proposal.proposalId, proposal.optimizedPrompt),
    ).rejects.toThrow('generation response lost')
    await expect(
      agent.confirmProposal(proposal.proposalId, proposal.optimizedPrompt),
    ).rejects.toThrow('生成授权已使用')
    expect(startCharacterGeneration).toHaveBeenCalledTimes(1)
  })
})
