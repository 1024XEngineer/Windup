import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createQuickStartAgent,
  createQuickStartWorkflowAgent,
  type CharacterGenerationProposal,
  type CreateQuickStartAgentOptions,
  type QuickStartAgentResult,
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

function errorMessage(cause: unknown): string {
  if (!(cause instanceof Error) || !cause.message) return 'Agent 暂时不可用，请稍后重试'
  if (
    /Tool|Planner|quick_start_decision|optimizedPrompt|optimizationSummary|生成授权/u.test(
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
  }, [initialMessages, planner, startCharacterGeneration])

  const ensureAgent = useCallback(() => {
    agent.current ??= createQuickStartAgent({
      planner,
      startCharacterGeneration,
      initialMessages,
      initialClarificationUsed,
      initialProposal,
    })
    return agent.current
  }, [
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
        if (mounted.current) {
          if (result.kind === 'message') {
            setState({
              status: 'awaiting-input',
              message: result.message,
              messageKind: result.messageKind,
            })
          } else if (result.kind === 'proposal') {
            const { proposalId, optimizedPrompt, optimizationSummary } = result
            setState({ status: 'proposal', proposalId, optimizedPrompt, optimizationSummary })
          }
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
    [ensureAgent],
  )

  const confirmProposal = useCallback(
    async (prompt: string): Promise<QuickStartAgentResult> => {
      if (running.current) throw new Error('Planner 正在处理上一条输入')
      if (state.status !== 'proposal') throw new Error('提示词提案已失效')
      running.current = true
      const { proposalId, optimizedPrompt, optimizationSummary } = state
      if (mounted.current) {
        setState({
          status: 'dispatching',
          proposalId,
          optimizedPrompt,
          optimizationSummary,
        })
      }
      try {
        return await ensureAgent().confirmProposal(proposalId, prompt)
      } catch (cause) {
        if (mounted.current) setState({ status: 'error', message: errorMessage(cause) })
        throw cause
      } finally {
        running.current = false
      }
    },
    [ensureAgent, state],
  )

  return {
    state,
    busy: state.status === 'planning' || state.status === 'dispatching',
    submit,
    confirmProposal,
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
