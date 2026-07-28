import type { WorkflowRun } from '../model/types'

const STORAGE_KEY = 'windup.workflow-runs.v1'

type RunMap = Record<string, WorkflowRun>

let memory: RunMap = {}
let fallbackSequence = 0

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

function readPersisted(): RunMap {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return isRunMap(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function readAll(): RunMap {
  return { ...readPersisted(), ...memory }
}

export function saveRun(run: WorkflowRun): WorkflowRun {
  memory = { ...memory, [run.id]: run }
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(readAll()))
  } catch {
    // 无痕模式等场景无法落盘时，本次会话仍使用内存仓库。
  }
  return run
}

export function loadRun(runId: WorkflowRun['id']): WorkflowRun | null {
  return readAll()[runId] ?? null
}

function randomSuffix(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID().replaceAll('-', '').slice(0, 12)
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(8)
    cryptoApi.getRandomValues(bytes)
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  }

  fallbackSequence += 1
  return `${Date.now().toString(36)}${fallbackSequence.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function newId(prefix: 'run' | 'revision' | 'node'): string {
  return `${prefix}-${randomSuffix()}`
}
