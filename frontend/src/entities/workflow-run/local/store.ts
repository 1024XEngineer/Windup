import type { WorkflowRun } from '../model/types'

const STORAGE_KEY = 'windup.workflow-runs.v1'

type RunMap = Record<string, WorkflowRun>

let memory: RunMap = {}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isRunMap(value: unknown): value is RunMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(
    (run: WorkflowRun) => typeof run?.id === 'string' && Array.isArray(run?.revisions),
  )
}

function readAll(): RunMap {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw) return memory
    const parsed: unknown = JSON.parse(raw)
    return isRunMap(parsed) ? parsed : memory
  } catch {
    return memory
  }
}

export function saveRun(run: WorkflowRun): WorkflowRun {
  memory = { ...readAll(), [run.id]: run }
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // 无痕模式等场景无法落盘时，本次会话仍使用内存仓库。
  }
  return run
}

export function loadRun(runId: WorkflowRun['id']): WorkflowRun | null {
  return readAll()[runId] ?? null
}

export function newId(prefix: 'run' | 'revision' | 'node'): string {
  return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`
}
