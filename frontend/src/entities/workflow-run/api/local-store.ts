import type { WorkflowNode, WorkflowRevision, WorkflowRun } from '../model/types'

/** 本地 adapter 只用于 Python WorkflowRun API 上线前，使用独立版本键隔离旧模型。 */
const STORAGE_KEY = 'windup.workflow-runs.v3'

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
    (run) =>
      Boolean(run) &&
      typeof run === 'object' &&
      typeof (run as WorkflowRun).id === 'string' &&
      Array.isArray((run as WorkflowRun).revisions),
  )
}

function readAll(): RunMap {
  const store = storage()
  if (!store) return memory
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return memory
    const parsed: unknown = JSON.parse(raw)
    return isRunMap(parsed) ? parsed : memory
  } catch {
    return memory
  }
}

function writeAll(runs: RunMap): void {
  memory = runs
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(runs))
  } catch {
    // memory 已保存当前会话数据；持久化失败由调用界面另行提示。
  }
}

export function saveRun(run: WorkflowRun): WorkflowRun {
  writeAll({ ...readAll(), [run.id]: run })
  return run
}

export function loadRun(runId: string): WorkflowRun | null {
  return readAll()[runId] ?? null
}

export function newId(prefix: 'run' | 'revision' | 'node'): string {
  return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`
}

function node(type: WorkflowNode['type'], status: WorkflowNode['status'], input: unknown): WorkflowNode {
  return {
    id: newId('node'),
    type,
    order: 0,
    status,
    input,
    output: null,
    referenceNodeIds: [],
    qualityFailureCount: 0,
  }
}

export function initialRevision(input: {
  driver: WorkflowRun['driver']
  prompt: string | null
}): WorkflowRevision {
  const asset = node('asset', input.driver === 'ai' ? 'passed' : 'active', {
    prompt: input.prompt,
  })
  const nodes =
    input.driver === 'ai'
      ? [
          asset,
          {
            ...node('generation', 'active', { prompt: input.prompt }),
            order: 1,
            referenceNodeIds: [asset.id],
          },
        ]
      : [asset]

  return {
    id: newId('revision'),
    basedOnRevisionId: null,
    restartNodeId: null,
    status: 'active',
    nodes,
    generationStatus: 'in_progress',
    exportStatus: 'not_exported',
    playtestStatus: 'not_tested',
    createdAt: new Date().toISOString(),
  }
}
