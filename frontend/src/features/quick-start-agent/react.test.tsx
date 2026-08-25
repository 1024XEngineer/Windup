// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlannerInput, PlannerResult, QuickStartDecision } from './runtime'
import { useQuickStartAgent, useQuickStartWorkflowAgent } from './react'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function decisionResult(input: QuickStartDecision): PlannerResult {
  return {
    text: '',
    finishReason: 'tool-calls',
    toolCalls: [{ toolName: 'quick_start_decision', input }],
  }
}

function proposalResult(): PlannerResult {
  return decisionResult({
    kind: 'proposal',
    optimizedPrompt: '银发像素骑士，全身像',
    optimizationSummary: '我会保留银发骑士特征，并整理为完整的全身母版描述。',
  })
}

describe('useQuickStartAgent', () => {
  it('keeps clarification and ordinary replies in one session', async () => {
    const plannerResults = [
      decisionResult({ kind: 'clarification', message: '请补充角色的美术风格。' }),
      decisionResult({ kind: 'reply', message: '你刚才描述了一个银发骑士。' }),
      decisionResult({ kind: 'reply', message: '可以继续讨论披风设计。' }),
    ]
    const planner = vi.fn(async (_input: PlannerInput) => plannerResults.shift()!)
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() => useQuickStartAgent({ planner, startCharacterGeneration }))

    await act(async () => {
      await result.current.submit('一个银发骑士')
      await result.current.submit('刚才我说了什么')
      await result.current.submit('你觉得披风怎么样')
    })

    expect(result.current.state).toEqual({
      status: 'awaiting-input',
      message: '可以继续讨论披风设计。',
      messageKind: 'reply',
    })
    expect(planner.mock.calls[2]?.[0].clarificationUsed).toBe(true)
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('presents a proposal without dispatching and confirms it explicitly', async () => {
    const planner = vi.fn(async () => proposalResult())
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() => useQuickStartAgent({ planner, startCharacterGeneration }))

    await act(async () => {
      await result.current.submit('银发骑士')
    })
    expect(result.current.state).toEqual({
      status: 'proposal',
      proposalId: 'proposal-1',
      optimizedPrompt: '银发像素骑士，全身像',
      optimizationSummary: '我会保留银发骑士特征，并整理为完整的全身母版描述。',
    })
    expect(startCharacterGeneration).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.confirmProposal('银发像素骑士，全身像，深蓝斗篷')
    })
    expect(startCharacterGeneration).toHaveBeenCalledWith({
      prompt: '银发像素骑士，全身像，深蓝斗篷',
      directionalMovement: 'single',
    })
  })

  it('lets a new discussion message supersede the visible proposal', async () => {
    const plannerResults = [
      proposalResult(),
      decisionResult({ kind: 'reply', message: '可以比较短斗篷和长斗篷。' }),
    ]
    const planner = vi.fn(async () => plannerResults.shift()!)
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() => useQuickStartAgent({ planner, startCharacterGeneration }))

    await act(async () => {
      await result.current.submit('银发骑士')
      await result.current.submit('先讨论披风')
    })

    expect(result.current.state).toEqual({
      status: 'awaiting-input',
      message: '可以比较短斗篷和长斗篷。',
      messageKind: 'reply',
    })
    await expect(result.current.confirmProposal('旧提案')).rejects.toThrow('提示词提案已失效')
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('hydrates a pending proposal without dispatching', () => {
    const proposal = {
      proposalId: 'proposal-restored',
      optimizedPrompt: '云端机械师全身像',
      optimizationSummary: '我会保留云端机械师设定。',
    }
    const planner = vi.fn()
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() =>
      useQuickStartAgent({
        planner,
        startCharacterGeneration,
        initialMessages: [{ role: 'user', content: '云端机械师' }],
        initialProposal: proposal,
      }),
    )

    expect(result.current.state).toEqual({ status: 'proposal', ...proposal })
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })

  it('rejects overlapping turns while planning', async () => {
    let resolvePlanner!: (result: PlannerResult) => void
    const planner = vi.fn(
      async () =>
        new Promise<PlannerResult>((resolve) => {
          resolvePlanner = resolve
        }),
    )
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() => useQuickStartAgent({ planner, startCharacterGeneration }))

    let firstTurn!: Promise<unknown>
    act(() => {
      firstTurn = result.current.submit('银发骑士')
    })
    await waitFor(() => expect(planner).toHaveBeenCalledOnce())
    await expect(result.current.submit('再发一条')).rejects.toThrow('Planner 正在处理上一条输入')

    resolvePlanner(decisionResult({ kind: 'reply', message: '可以继续。' }))
    await act(async () => firstTurn)
  })

  it.each(['生成提案参数字段无效', '请求参数无效'])(
    'keeps the internal protocol error %s out of the conversation',
    async (message) => {
      const planner = vi.fn(async () => {
        throw new Error(message)
      })
      const { result } = renderHook(() =>
        useQuickStartAgent({ planner, startCharacterGeneration: vi.fn() }),
      )

      await act(async () => {
        await expect(result.current.submit('直接生成')).rejects.toThrow(message)
      })

      expect(result.current.state).toEqual({
        status: 'error',
        message: 'Agent 没有完成这次回复，请重新发送',
      })
    },
  )

  it('revokes pending work when the host unmounts', async () => {
    const planner = vi.fn(
      async ({ signal }: PlannerInput) =>
        new Promise<PlannerResult>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result, unmount } = renderHook(() =>
      useQuickStartAgent({ planner, startCharacterGeneration }),
    )

    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.submit('银发骑士')
    })
    unmount()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(startCharacterGeneration).not.toHaveBeenCalled()
  })
})

describe('useQuickStartWorkflowAgent', () => {
  it('reports the submitted Controller action after planning', async () => {
    const planner = vi.fn(async () => ({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolName: 'regenerate_character_template',
          input: {},
        },
      ],
    }))
    const regenerateCharacterTemplate = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      useQuickStartWorkflowAgent({
        planner,
        actions: {
          getContext: () => ({ availableTools: ['regenerate_character_template'] }),
          regenerateCharacterTemplate,
          refineCharacterTemplate: vi.fn(async () => undefined),
          regenerateFirstFrame: vi.fn(async () => undefined),
          refineFirstFrame: vi.fn(async () => undefined),
        },
      }),
    )

    await act(async () => {
      await result.current.submit('重新生成角色')
    })

    expect(result.current.state).toEqual({
      status: 'action',
      action: 'regenerate_character_template',
      message: '已提交角色母版重新生成。',
    })
    expect(regenerateCharacterTemplate).toHaveBeenCalledOnce()
  })
})
