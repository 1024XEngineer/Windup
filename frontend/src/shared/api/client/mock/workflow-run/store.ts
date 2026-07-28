import type { NodeDto, RevisionDto, RunDto } from './types'

/** 假后端的落盘。前端不再直接读这个键。 */
const STORAGE_KEY = 'windup.mock.workflow-runs.v3'

type RunMap = Record<string, RunDto>

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
    (run: RunDto) => typeof run?.id === 'string' && Array.isArray(run?.revisions),
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

export function saveRun(run: RunDto): RunDto {
  memory = { ...readAll(), [run.id]: run }
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // 落盘失败（无痕模式等）时退回内存，本次会话内仍能读回。
  }
  return run
}

export function loadRun(runId: string): RunDto | null {
  return readAll()[runId] ?? null
}

export function newId(prefix: 'run' | 'revision' | 'node'): string {
  return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`
}

function node(type: NodeDto['type'], status: NodeDto['status'], input: unknown): NodeDto {
  return {
    id: newId('node'),
    type,
    order: 0,
    status,
    input,
    output: null,
    reference_node_ids: [],
    quality_failure_count: 0,
  }
}

/** AI 入口跳过资产设置直接进生成，手动入口从资产设置开始。 */
export function initialRevision(driver: RunDto['driver'], prompt: string | null): RevisionDto {
  const asset = node('asset', driver === 'ai' ? 'passed' : 'active', { prompt })
  const nodes =
    driver === 'ai'
      ? [
          asset,
          { ...node('generation', 'active', { prompt }), order: 1, reference_node_ids: [asset.id] },
        ]
      : [asset]

  return {
    id: newId('revision'),
    based_on_revision_id: null,
    restart_node_id: null,
    status: 'active',
    nodes,
    generation_status: 'in_progress',
    export_status: 'not_exported',
    playtest_status: 'not_tested',
    created_at: new Date().toISOString(),
  }
}

export function createRun(input: {
  projectId: string
  driver: RunDto['driver']
  prompt: string | null
}): RunDto {
  const revision = initialRevision(input.driver, input.prompt)
  return saveRun({
    id: newId('run'),
    project_id: input.projectId,
    character_id: null,
    driver: input.driver,
    status: 'active',
    current_revision_id: revision.id,
    revisions: [revision],
    prompt: input.prompt,
  })
}
