// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlannerInput, PlannerResult } from './runtime'
import { useQuickStartAgent } from './react'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useQuickStartAgent', () => {
  it('keeps one clarification inline and presents the final plan before dispatch', async () => {
    const presentation = deferred()
    const plannerResults: PlannerResult[] = [
      { text: '请补充角色的美术风格。', finishReason: 'stop', toolCalls: [] },
      {
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolName: 'start_character_generation',
            input: {
              optimizedPrompt: '银发像素骑士，全身像',
              optimizationSummary: '我会保留银发骑士特征，并补全适合母版生成的全身描述。',
            },
          },
        ],
      },
    ]
    const planner = vi.fn(async (_input: PlannerInput) => plannerResults.shift()!)
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() =>
      useQuickStartAgent({
        planner,
        startCharacterGeneration,
        waitForPresentation: () => presentation.promise,
      }),
    )

    await act(async () => {
      await result.current.submit('一个银发骑士')
    })
    expect(result.current.state).toEqual({
      status: 'awaiting-input',
      message: '请补充角色的美术风格。',
    })

    let secondTurn!: Promise<unknown>
    act(() => {
      secondTurn = result.current.submit('16-bit 像素风，请直接生成')
    })
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'dispatching',
        optimizedPrompt: '银发像素骑士，全身像',
        optimizationSummary: '我会保留银发骑士特征，并补全适合母版生成的全身描述。',
      }),
    )
    expect(startCharacterGeneration).not.toHaveBeenCalled()

    presentation.resolve()
    await act(async () => {
      await secondTurn
    })
    expect(startCharacterGeneration).toHaveBeenCalledWith({
      prompt: '银发像素骑士，全身像',
    })
  })

  it('revokes pending authorization when the host unmounts', async () => {
    const planner = vi.fn(
      async ({ signal }: { signal?: AbortSignal }) =>
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

  it('rejects overlapping turns while the current Planner request is pending', async () => {
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
    await waitFor(() => expect(planner).toHaveBeenCalledTimes(1))

    await expect(result.current.submit('再发一条')).rejects.toThrow('Planner 正在处理上一条输入')

    resolvePlanner({ text: '请补充角色风格。', finishReason: 'stop', toolCalls: [] })
    await act(async () => {
      await firstTurn
    })
    expect(result.current.state).toEqual({
      status: 'awaiting-input',
      message: '请补充角色风格。',
    })
  })

  it('shows the safe fallback message for a non-Error Planner rejection', async () => {
    const planner = vi.fn(async () => Promise.reject('offline'))
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() => useQuickStartAgent({ planner, startCharacterGeneration }))
    let rejection: unknown

    await act(async () => {
      try {
        await result.current.submit('银发骑士')
      } catch (cause) {
        rejection = cause
      }
    })

    expect(rejection).toBe('offline')
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'Agent 暂时不可用，请稍后重试',
    })
  })

  it('does not expose Agent protocol details in the user-facing error state', async () => {
    const planner = vi.fn(async () => ({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolName: 'start_character_generation',
          input: { optimizedPrompt: '像素骑士' },
        },
      ],
    }))
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() => useQuickStartAgent({ planner, startCharacterGeneration }))

    await act(async () => {
      await expect(result.current.submit('像素骑士')).rejects.toThrow('生成 Tool 参数字段无效')
    })

    expect(result.current.state).toEqual({
      status: 'error',
      message: '提示词优化没有完成，请重新发送',
    })
  })

  it('keeps the first successful clarification available after an initial Planner failure', async () => {
    const planner = vi
      .fn<(input: PlannerInput) => Promise<PlannerResult>>()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        text: '请补充角色风格。',
        finishReason: 'stop',
        toolCalls: [],
      })
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() => useQuickStartAgent({ planner, startCharacterGeneration }))

    await act(async () => {
      await expect(result.current.submit('一个骑士')).rejects.toThrow('network unavailable')
    })
    await act(async () => {
      await result.current.submit('重试')
    })

    expect(result.current.state).toEqual({
      status: 'awaiting-input',
      message: '请补充角色风格。',
    })
  })

  it('dispatches without a presentation delay when animation frames are unavailable', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const planner = vi.fn(
      async (): Promise<PlannerResult> => ({
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolName: 'start_character_generation',
            input: {
              optimizedPrompt: '银发像素骑士，全身像',
              optimizationSummary: '我会保留银发骑士特征，并整理为完整的全身母版描述。',
            },
          },
        ],
      }),
    )
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() => useQuickStartAgent({ planner, startCharacterGeneration }))

    await act(async () => {
      await result.current.submit('请直接生成银发骑士')
    })

    expect(startCharacterGeneration).toHaveBeenCalledWith({
      prompt: '银发像素骑士，全身像',
    })
  })

  it('requires an explicit restart after the one clarification is exhausted', async () => {
    const plannerResults: PlannerResult[] = [
      { text: '请补充角色风格。', finishReason: 'stop', toolCalls: [] },
      { text: '描述仍有冲突，请修改后重新开始。', finishReason: 'stop', toolCalls: [] },
      {
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolName: 'start_character_generation',
            input: {
              optimizedPrompt: '银发像素骑士，全身像',
              optimizationSummary: '我会保留银发骑士特征，并整理为完整的全身母版描述。',
            },
          },
        ],
      },
    ]
    const planner = vi.fn(async (_input: PlannerInput) => plannerResults.shift()!)
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const { result } = renderHook(() => useQuickStartAgent({ planner, startCharacterGeneration }))

    await act(async () => {
      await result.current.submit('一个骑士')
      await result.current.submit('仍然缺少明确风格')
    })
    expect(result.current.state).toEqual({
      status: 'restart-required',
      message: '描述仍有冲突，请修改后重新开始。',
    })

    await act(async () => {
      await result.current.submit('16-bit 银发像素骑士，请直接生成')
    })
    expect(startCharacterGeneration).toHaveBeenCalledWith({
      prompt: '银发像素骑士，全身像',
    })
    expect(planner.mock.calls[2]?.[0].messages).toEqual([
      { role: 'user', content: '16-bit 银发像素骑士，请直接生成' },
    ])
  })
})
