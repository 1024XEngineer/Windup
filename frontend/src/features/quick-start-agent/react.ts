import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createQuickStartAgent,
  type CharacterGenerationPlan,
  type CreateQuickStartAgentOptions,
  type QuickStartAgentResult,
} from './runtime'

export type QuickStartAgentState =
  | { status: 'idle' }
  | { status: 'planning' }
  | { status: 'awaiting-input'; message: string }
  | ({ status: 'dispatching' } & CharacterGenerationPlan)
  | { status: 'error'; message: string }

export interface UseQuickStartAgentOptions extends CreateQuickStartAgentOptions {
  /** 测试可替换；生产至少等待一帧，保证最终 Prompt 先于付费写操作可见。 */
  waitForPresentation?: () => Promise<void>
}

async function waitForBrowserPresentation(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : 'Agent 暂时不可用，请稍后重试'
}

export function useQuickStartAgent({
  planner,
  startCharacterGeneration,
  waitForPresentation = waitForBrowserPresentation,
}: UseQuickStartAgentOptions) {
  const [state, setState] = useState<QuickStartAgentState>({ status: 'idle' })
  const agent = useRef<ReturnType<typeof createQuickStartAgent> | null>(null)
  const started = useRef(false)
  const running = useRef(false)
  const abortController = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    started.current = false
    return () => {
      mounted.current = false
      abortController.current?.abort()
      agent.current?.revoke()
      agent.current = null
      started.current = false
    }
  }, [planner, startCharacterGeneration])

  const submit = useCallback(
    async (input: string): Promise<QuickStartAgentResult> => {
      if (running.current) throw new Error('Planner 正在处理上一条输入')
      running.current = true
      const controller = new AbortController()
      abortController.current = controller
      if (mounted.current) setState({ status: 'planning' })

      try {
        agent.current ??= createQuickStartAgent({ planner, startCharacterGeneration })
        const activeAgent = agent.current
        const runTurn = started.current ? activeAgent.continue : activeAgent.start
        started.current = true
        const result = await runTurn(input, {
          signal: controller.signal,
          async onBeforeDispatch(plan) {
            if (mounted.current) setState({ status: 'dispatching', ...plan })
            await waitForPresentation()
          },
        })
        if (result.kind === 'message' && mounted.current) {
          setState({ status: 'awaiting-input', message: result.message })
        }
        return result
      } catch (cause) {
        if (mounted.current && !(cause instanceof Error && cause.name === 'AbortError')) {
          setState({ status: 'error', message: errorMessage(cause) })
        }
        throw cause
      } finally {
        running.current = false
        if (abortController.current === controller) abortController.current = null
      }
    },
    [planner, startCharacterGeneration, waitForPresentation],
  )

  return {
    state,
    busy: state.status === 'planning' || state.status === 'dispatching',
    submit,
  }
}
