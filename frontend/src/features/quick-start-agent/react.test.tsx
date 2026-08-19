// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlannerResult } from './runtime'
import { useQuickStartAgent } from './react'

afterEach(cleanup)

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
              assumptions: ['默认单角色', '默认横版视角'],
            },
          },
        ],
      },
    ]
    const planner = vi.fn(async () => plannerResults.shift()!)
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
        assumptions: ['默认单角色', '默认横版视角'],
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
})
