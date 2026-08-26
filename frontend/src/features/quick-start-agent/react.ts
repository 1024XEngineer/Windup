import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createQuickStartAgent,
  createQuickStartWorkflowAgent,
  type CharacterGenerationProposal,
  type CreateQuickStartAgentOptions,
  type QuickStartAgentResult,
  type QuickStartDirectionalMovement,
  type CreateQuickStartWorkflowAgentOptions,
  type WorkflowAgentToolName,
} from './runtime'

export type QuickStartAgentState =
  | { status: 'idle' }
  | { status: 'planning' }
  | {
      status: 'awaiting-input'
      message: string
      messageKind: 'reply' | 'clarification' | 'blocked'
    }
  | ({ status: 'proposal' } & CharacterGenerationProposal)
  | ({ status: 'dispatching' } & CharacterGenerationProposal)
  | { status: 'error'; message: string }

export type UseQuickStartAgentOptions = CreateQuickStartAgentOptions

function requestIdFromCause(cause: unknown): string | undefined {
  if (!cause || typeof cause !== 'object') return undefined
  const headers = (cause as { responseHeaders?: Record<string, string> }).responseHeaders
  if (!headers) return undefined
  return headers['x-request-id'] ?? headers['X-Request-Id']
}

function logAgentFailure(cause: unknown): void {
  console.error('[quick-start-agent] 本轮失败', {
    name: cause instanceof Error ? cause.name : typeof cause,
    message: cause instanceof Error ? cause.message : String(cause),
    requestId: requestIdFromCause(cause),
  })
}

function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError'
  )
}

function errorMessage(cause: unknown): string {
  if (!(cause instanceof Error) || !cause.message) return 'Agent 暂时不可用，请稍后重试'
  if (
    /Tool|Planner|quick_start_decision|optimizedPrompt|optimizationSummary|生成提案|请求参数无效|生成授权/u.test(
      cause.message,
    )
  ) {
    return 'Agent 没有完成这次回复，请重新发送'
  }
  return cause.message
}

function initialState(options: UseQuickStartAgentOptions): QuickStartAgentState {
  return options.initialProposal
    ? { status: 'proposal', ...options.initialProposal }
    : { status: 'idle' }
}

export function useQuickStartAgent(options: UseQuickStartAgentOptions) {
  const {
    planner,
    startCharacterGeneration,
    artStyle,
    initialMessages,
    initialClarificationUsed,
    initialProposal,
  } = options
  const [state, setState] = useState<QuickStartAgentState>(() => initialState(options))
  const agent = useRef<ReturnType<typeof createQuickStartAgent> | null>(null)
  const started = useRef(Boolean(initialMessages?.length))
  const running = useRef(false)
  const abortController = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    started.current = Boolean(initialMessages?.length)
    return () => {
      mounted.current = false
      abortController.current?.abort()
      agent.current?.revoke()
      agent.current = null
    }
  }, [artStyle, initialMessages, planner, startCharacterGeneration])

  const ensureAgent = useCallback(() => {
    agent.current ??= createQuickStartAgent({
      planner,
      startCharacterGeneration,
      artStyle,
      initialMessages,
      initialClarificationUsed,
      initialProposal,
    })
    return agent.current
  }, [
    artStyle,
    initialClarificationUsed,
    initialMessages,
    initialProposal,
    planner,
    startCharacterGeneration,
  ])

  const submit = useCallback(
    async (input: string): Promise<QuickStartAgentResult> => {
      if (running.current) throw new Error('Planner 正在处理上一条输入')
      running.current = true
      const controller = new AbortController()
      abortController.current = controller
      if (mounted.current) setState({ status: 'planning' })

      try {
        const activeAgent = ensureAgent()
        const runTurn = started.current ? activeAgent.continue : activeAgent.start
        started.current = true
        const result = await runTurn(input, { signal: controller.signal })
        if (mounted.current && abortController.current === controller) {
          if (result.kind === 'message') {
            setState({
              status: 'awaiting-input',
              message: result.message,
              messageKind: result.messageKind,
            })
          } else if (result.kind === 'proposal') {
            const {
              proposalId,
              optimizedPrompt,
              actionPrompt,
              actionType,
              optimizationSummary,
              suggestPixelPerfect,
            } = result
            setState({
              status: 'proposal',
              proposalId,
              optimizedPrompt,
              ...(actionPrompt ? { actionPrompt } : {}),
              ...(actionType ? { actionType } : {}),
              optimizationSummary,
              ...(suggestPixelPerfect ? { suggestPixelPerfect: true } : {}),
            })
          }
        }
        return result
      } catch (cause) {
        const isCurrent = abortController.current === controller
        if (isAbortError(cause) && isCurrent) {
          agent.current?.revoke()
          agent.current = null
          started.current = Boolean(initialMessages?.length)
          if (mounted.current) setState({ status: 'idle' })
        } else if (!isAbortError(cause) && isCurrent && mounted.current) {
          logAgentFailure(cause)
          setState({ status: 'error', message: errorMessage(cause) })
        }
        throw cause
      } finally {
        if (abortController.current === controller) {
          running.current = false
          abortController.current = null
        }
      }
    },
    [ensureAgent, initialMessages],
  )

  const confirmProposal = useCallback(
    async (
      prompt: string,
      directionalMovement: QuickStartDirectionalMovement = 'single',
      options?: { gameStyle?: string; automaticDelivery?: boolean },
    ): Promise<QuickStartAgentResult> => {
      if (running.current) throw new Error('Planner 正在处理上一条输入')
      if (state.status !== 'proposal') throw new Error('提示词提案已失效')
      running.current = true
      const {
        proposalId,
        optimizedPrompt,
        actionPrompt,
        actionType,
        optimizationSummary,
        suggestPixelPerfect,
      } = state
      if (mounted.current) {
        setState({
          status: 'dispatching',
          proposalId,
          optimizedPrompt,
          ...(actionPrompt ? { actionPrompt } : {}),
          ...(actionType ? { actionType } : {}),
          optimizationSummary,
          ...(suggestPixelPerfect ? { suggestPixelPerfect: true } : {}),
        })
      }
      try {
        return await ensureAgent().confirmProposal(proposalId, prompt, directionalMovement, options)
      } catch (cause) {
        if (mounted.current) {
          logAgentFailure(cause)
          setState({ status: 'error', message: errorMessage(cause) })
        }
        throw cause
      } finally {
        running.current = false
      }
    },
    [ensureAgent, state],
  )

  const cancel = useCallback(() => {
    if (!running.current) return
    abortController.current?.abort()
    agent.current?.revoke()
    agent.current = null
    started.current = Boolean(initialMessages?.length)
    abortController.current = null
    running.current = false
    if (mounted.current) setState({ status: 'idle' })
  }, [initialMessages])

  return {
    state,
    busy: state.status === 'planning' || state.status === 'dispatching',
    submit,
    confirmProposal,
    cancel,
  }
}

export type QuickStartWorkflowAgentState =
  | { status: 'idle' }
  | { status: 'planning' }
  | { status: 'awaiting-input'; message: string }
  | { status: 'action'; action: WorkflowAgentToolName; message: string }
  | { status: 'error'; message: string }

export function useQuickStartWorkflowAgent({
  planner,
  actions,
  initialMessages,
}: CreateQuickStartWorkflowAgentOptions) {
  const [state, setState] = useState<QuickStartWorkflowAgentState>({ status: 'idle' })
  const agent = useRef<ReturnType<typeof createQuickStartWorkflowAgent> | null>(null)
  const running = useRef(false)
  const abortController = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abortController.current?.abort()
      agent.current?.revoke()
      agent.current = null
    }
  }, [actions, initialMessages, planner])

  const submit = useCallback(
    async (input: string) => {
      if (running.current) throw new Error('Planner 正在处理上一条输入')
      running.current = true
      const controller = new AbortController()
      abortController.current = controller
      if (mounted.current) setState({ status: 'planning' })
      try {
        agent.current ??= createQuickStartWorkflowAgent({ planner, actions, initialMessages })
        const result = await agent.current.submit(input, { signal: controller.signal })
        if (mounted.current) {
          setState(
            result.kind === 'action'
              ? { status: 'action', action: result.action, message: result.message }
              : { status: 'awaiting-input', message: result.message },
          )
        }
        return result
      } catch (cause) {
        if (mounted.current && !(cause instanceof Error && cause.name === 'AbortError')) {
          logAgentFailure(cause)
          setState({ status: 'error', message: errorMessage(cause) })
        }
        throw cause
      } finally {
        running.current = false
        if (abortController.current === controller) abortController.current = null
      }
    },
    [actions, initialMessages, planner],
  )

  return {
    state,
    busy: state.status === 'planning',
    submit,
  }
}
