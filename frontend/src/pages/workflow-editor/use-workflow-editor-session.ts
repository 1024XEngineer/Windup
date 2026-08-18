import { useCallback, useEffect, useReducer, useRef } from 'react'

import {
  type Character,
  type Generation,
  type WorkflowGenerationRole,
  type WorkflowNode,
  type WorkflowRun,
  WorkflowRunConflictError,
} from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'
import { createDefaultRealWorkflowEditorSession, type WorkflowEditorSession } from './runtime'

interface WorkflowEditorSessionState {
  session: WorkflowEditorSession | null
  character: Character | null
  run: WorkflowRun | null
  generations: Record<string, Generation | null>
  busyBranches: ReadonlySet<string>
  error: string | null
  workflowConflict: boolean
  resumeError: string | null
  generationReadError: string | null
}

type SessionAction =
  | { type: 'reset' }
  | { type: 'session-ready'; session: WorkflowEditorSession }
  | { type: 'run-updated'; run: WorkflowRun }
  | { type: 'character-updated'; character: Character }
  | { type: 'generations-read'; generations: Record<string, Generation | null> }
  | { type: 'generation-read-failed'; message: string }
  | { type: 'command-started'; branchKey: string }
  | { type: 'command-finished'; branchKey: string }
  | { type: 'workflow-error'; message: string; conflict: boolean }
  | { type: 'workflow-error-cleared' }
  | { type: 'resume-failed'; message: string }
  | { type: 'resume-error-cleared' }

const INITIAL_STATE: WorkflowEditorSessionState = {
  session: null,
  character: null,
  run: null,
  generations: {},
  busyBranches: new Set(),
  error: null,
  workflowConflict: false,
  resumeError: null,
  generationReadError: null,
}

export function useWorkflowEditorSession(
  runId: string | undefined,
  loadSession?: (runId: string) => Promise<WorkflowEditorSession>,
) {
  const [state, dispatch] = useReducer(sessionReducer, INITIAL_STATE)
  const sessionAbortRef = useRef<AbortController | null>(null)
  const latestReadAbortRef = useRef<AbortController | null>(null)
  const settledGenerationsRef = useRef(new Map<Generation['id'], Generation>())
  const workflowConflictRef = useRef(false)
  const busyBranchesRef = useRef<ReadonlySet<string>>(new Set())

  const reportWorkflowError = useCallback((cause: unknown, fallback: string) => {
    const presented = presentWorkflowError(cause, fallback)
    if (workflowConflictRef.current && !presented.conflict) return
    workflowConflictRef.current ||= presented.conflict
    dispatch({
      type: 'workflow-error',
      message: presented.message,
      conflict: workflowConflictRef.current,
    })
  }, [])

  const requestGenerations = useCallback(
    (targetSession: WorkflowEditorSession, targetRun: WorkflowRun, sessionSignal: AbortSignal) => {
      latestReadAbortRef.current?.abort()
      const readAbort = new AbortController()
      latestReadAbortRef.current = readAbort
      const outdated = () => sessionSignal.aborted || readAbort.signal.aborted
      void readGenerations(targetSession.controller, targetRun, settledGenerationsRef.current)
        .then((generations) => {
          if (!outdated()) dispatch({ type: 'generations-read', generations })
        })
        .catch((cause: unknown) => {
          if (!outdated()) {
            dispatch({
              type: 'generation-read-failed',
              message: errorMessage(cause, '读取生成结果失败'),
            })
          }
        })
    },
    [],
  )

  const runCommand = useCallback(
    (branchKey: string, command: () => Promise<void>) => {
      if (workflowConflictRef.current || busyBranchesRef.current.has(branchKey)) return
      const sessionSignal = sessionAbortRef.current?.signal
      busyBranchesRef.current = new Set(busyBranchesRef.current).add(branchKey)
      dispatch({ type: 'command-started', branchKey })
      dispatch({ type: 'workflow-error-cleared' })
      void command()
        .catch((cause: unknown) => {
          if (!sessionSignal?.aborted) reportWorkflowError(cause, '工作流命令执行失败')
        })
        .finally(() => {
          if (sessionSignal?.aborted) return
          const next = new Set(busyBranchesRef.current)
          next.delete(branchKey)
          busyBranchesRef.current = next
          dispatch({ type: 'command-finished', branchKey })
        })
    },
    [reportWorkflowError],
  )

  useEffect(() => {
    const sessionAbort = new AbortController()
    sessionAbortRef.current = sessionAbort
    latestReadAbortRef.current?.abort()
    settledGenerationsRef.current = new Map()
    workflowConflictRef.current = false
    busyBranchesRef.current = new Set()
    dispatch({ type: 'reset' })
    if (!runId) return

    let loaded: WorkflowEditorSession | null = null
    let unsubscribe: () => void = () => undefined
    let unsubscribeErrors: () => void = () => undefined
    const loader = loadSession ?? createDefaultRealWorkflowEditorSession
    const signal = sessionAbort.signal

    void loader(runId)
      .then(async (nextSession) => {
        if (signal.aborted) {
          nextSession.dispose()
          return
        }
        loaded = nextSession
        dispatch({ type: 'session-ready', session: nextSession })
        unsubscribeErrors = nextSession.subscribeErrors((nextError) => {
          if (!signal.aborted) reportWorkflowError(nextError, '工作流异步处理失败')
        })
        unsubscribe = nextSession.controller.subscribe((nextRun) => {
          if (signal.aborted) return
          dispatch({ type: 'run-updated', run: nextRun })
          requestGenerations(nextSession, nextRun, signal)
        })
        try {
          await nextSession.controller.resume()
        } catch (cause: unknown) {
          if (signal.aborted) return
          const presented = presentWorkflowError(cause, '恢复 WorkflowRun 失败')
          if (presented.conflict) {
            reportWorkflowError(cause, '恢复 WorkflowRun 失败')
          } else if (!workflowConflictRef.current) {
            dispatch({ type: 'resume-failed', message: presented.message })
          }
        }
      })
      .catch((cause: unknown) => {
        if (!signal.aborted) reportWorkflowError(cause, '恢复 WorkflowRun 失败')
      })

    return () => {
      sessionAbort.abort()
      latestReadAbortRef.current?.abort()
      unsubscribe()
      unsubscribeErrors()
      loaded?.dispose()
    }
  }, [loadSession, reportWorkflowError, requestGenerations, runId])

  useEffect(() => {
    if (
      state.resumeError &&
      state.run &&
      !state.run.nodes.some(
        (node) => !node.deletedAt && node.status === 'active' && node.phase === 'generating',
      )
    ) {
      dispatch({ type: 'resume-error-cleared' })
    }
  }, [state.resumeError, state.run])

  const setCharacter = useCallback((character: Character) => {
    dispatch({ type: 'character-updated', character })
  }, [])

  const retryGenerations = useCallback(() => {
    const signal = sessionAbortRef.current?.signal
    if (signal && state.session && state.run) {
      requestGenerations(state.session, state.run, signal)
    }
  }, [requestGenerations, state.run, state.session])

  return { state, retryGenerations, runCommand, setCharacter }
}

function sessionReducer(
  state: WorkflowEditorSessionState,
  action: SessionAction,
): WorkflowEditorSessionState {
  switch (action.type) {
    case 'reset':
      return { ...INITIAL_STATE, busyBranches: new Set() }
    case 'session-ready':
      return { ...state, session: action.session, character: action.session.character }
    case 'run-updated':
      return { ...state, run: action.run }
    case 'character-updated':
      return { ...state, character: action.character }
    case 'generations-read':
      return { ...state, generations: action.generations, generationReadError: null }
    case 'generation-read-failed':
      return { ...state, generationReadError: action.message }
    case 'command-started':
      return { ...state, busyBranches: new Set(state.busyBranches).add(action.branchKey) }
    case 'command-finished': {
      const busyBranches = new Set(state.busyBranches)
      busyBranches.delete(action.branchKey)
      return { ...state, busyBranches }
    }
    case 'workflow-error':
      return {
        ...state,
        error: action.message,
        workflowConflict: action.conflict,
        resumeError: action.conflict ? null : state.resumeError,
      }
    case 'workflow-error-cleared':
      return state.workflowConflict ? state : { ...state, error: null }
    case 'resume-failed':
      return { ...state, resumeError: action.message }
    case 'resume-error-cleared':
      return { ...state, resumeError: null }
  }
}

async function readGenerations(
  controller: WorkflowController,
  run: WorkflowRun,
  settled: Map<Generation['id'], Generation>,
): Promise<Record<string, Generation | null>> {
  const entries = await Promise.all(
    run.nodes
      .filter((node) => !node.deletedAt)
      .flatMap((node) =>
        node.generations.map(async (reference) => {
          const key = generationKey(node.id, reference.role)
          const cached = settled.get(reference.taskId)
          if (cached) return [key, cached] as const
          const generation = await controller.getGeneration(node.id, reference.role)
          if (generation && (generation.status === 'completed' || generation.status === 'failed')) {
            settled.set(generation.id, generation)
          }
          return [key, generation] as const
        }),
      ),
  )
  return Object.fromEntries(entries)
}

function generationKey(nodeId: WorkflowNode['id'], role: WorkflowGenerationRole) {
  return `${nodeId}:${role}`
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function presentWorkflowError(cause: unknown, fallback: string) {
  if (cause instanceof WorkflowRunConflictError) {
    return {
      message: '工作流已在其他位置更新，请加载最新版本后继续。',
      conflict: true,
    }
  }
  return { message: errorMessage(cause, fallback), conflict: false }
}
