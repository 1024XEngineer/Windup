import type { WorkflowRevision, WorkflowRun } from './index'
import {
  EXPORT_STATUSES,
  GENERATION_STATUSES,
  WORKFLOW_DRIVERS,
  WORKFLOW_PURPOSES,
  WORKFLOW_REVISION_STATUSES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_ORDER,
  WORKFLOW_STEP_STATUSES,
} from './constants'

export const WORKFLOW_RUN_STORAGE_KEY = 'windup.workflow-runs'
export const WORKFLOW_RUN_STORAGE_VERSION = 1

type WorkflowRunListener = (run: WorkflowRun) => void
type WorkflowRunListListener = (runs: WorkflowRun[]) => void

interface WorkflowRunStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface WorkflowRunStore {
  get(runId: WorkflowRun['id']): WorkflowRun | null
  list(): WorkflowRun[]
  save(run: WorkflowRun): void
  subscribe(runId: WorkflowRun['id'], listener: WorkflowRunListener): () => void
  subscribeAll(listener: WorkflowRunListListener): () => void
}

export interface CreateWorkflowRunStoreOptions {
  /** null 表示仅保存在当前内存；未传时浏览器默认使用 localStorage。 */
  storage?: WorkflowRunStorage | null
}

interface PersistedWorkflowRuns {
  version: typeof WORKFLOW_RUN_STORAGE_VERSION
  runs: WorkflowRun[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isMember<T extends string>(value: unknown, members: readonly T[]): value is T {
  return typeof value === 'string' && members.includes(value as T)
}

function isWorkflowStep(value: unknown, expectedType: string): boolean {
  if (!isRecord(value)) return false

  const errorIsValid =
    isNullableString(value.error) &&
    (value.status === 'failed'
      ? typeof value.error === 'string' && value.error.trim().length > 0
      : value.error === null)
  const taskStateIsValid =
    isNullableString(value.taskId) &&
    isNullableString(value.submissionId) &&
    !(value.taskId !== null && value.submissionId !== null) &&
    ((value.taskId === null && value.submissionId === null) || value.status === 'active')

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.type === expectedType &&
    isMember(value.status, WORKFLOW_STEP_STATUSES) &&
    'input' in value &&
    'output' in value &&
    taskStateIsValid &&
    errorIsValid &&
    isStringArray(value.referenceStepIds)
  )
}

function isWorkflowRevision(value: unknown): value is WorkflowRevision {
  if (!isRecord(value) || !Array.isArray(value.steps)) return false
  const stepIds = value.steps.map((step) => (isRecord(step) ? step.id : null))

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    isNullableString(value.basedOnRevisionId) &&
    isNullableString(value.restartStepId) &&
    isMember(value.status, WORKFLOW_REVISION_STATUSES) &&
    value.steps.length === WORKFLOW_STEP_ORDER.length &&
    value.steps.every((step, index) => isWorkflowStep(step, WORKFLOW_STEP_ORDER[index]!)) &&
    new Set(stepIds).size === stepIds.length &&
    isMember(value.generationStatus, GENERATION_STATUSES) &&
    isMember(value.exportStatus, EXPORT_STATUSES) &&
    typeof value.createdAt === 'string'
  )
}

function hasValidRevisionLine(revisions: WorkflowRevision[]): boolean {
  const prior = new Map<string, WorkflowRevision>()
  const priorStepIds = new Set<string>()

  for (const [index, revision] of revisions.entries()) {
    if (prior.has(revision.id)) return false
    if (index === 0) {
      if (revision.basedOnRevisionId !== null || revision.restartStepId !== null) return false
    } else {
      if (revision.basedOnRevisionId === null || revision.restartStepId === null) return false
      const source = prior.get(revision.basedOnRevisionId)
      if (
        !source?.steps.some(
          (step) => step.id === revision.restartStepId && step.status === 'passed',
        )
      ) {
        return false
      }
    }
    if (
      revision.steps.some((step) =>
        step.referenceStepIds.some((stepId) => !priorStepIds.has(stepId)),
      )
    ) {
      return false
    }
    prior.set(revision.id, revision)
    revision.steps.forEach((step) => priorStepIds.add(step.id))
  }

  return true
}

function isWorkflowRun(value: unknown): value is WorkflowRun {
  if (!isRecord(value) || !Array.isArray(value.revisions) || value.revisions.length === 0) {
    return false
  }
  if (!value.revisions.every(isWorkflowRevision)) return false

  const revisions = value.revisions
  const current = revisions.at(-1)
  if (!current || current.id !== value.currentRevisionId || !hasValidRevisionLine(revisions)) {
    return false
  }

  const expectedRevisionStatus =
    value.status === 'failed' ? 'failed' : value.status === 'completed' ? 'completed' : 'active'
  if (current.status !== expectedRevisionStatus) return false
  if (revisions.slice(0, -1).some((revision) => revision.status === 'active')) return false

  const activeStepCount = current.steps.filter((step) => step.status === 'active').length
  if (
    ((value.status === 'active' || value.status === 'interrupted') && activeStepCount !== 1) ||
    ((value.status === 'failed' || value.status === 'completed') && activeStepCount !== 0)
  ) {
    return false
  }

  const targetIsValid =
    value.purpose === 'add_action'
      ? isNonEmptyString(value.characterId) && isNonEmptyString(value.outfitId)
      : value.purpose === 'create_character' &&
        ((value.characterId === null && value.outfitId === null) ||
          (isNonEmptyString(value.characterId) && isNonEmptyString(value.outfitId)))

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.projectId === 'string' &&
    isMember(value.purpose, WORKFLOW_PURPOSES) &&
    targetIsValid &&
    isMember(value.driver, WORKFLOW_DRIVERS) &&
    isMember(value.status, WORKFLOW_RUN_STATUSES) &&
    isNullableString(value.prompt)
  )
}

function readPersistedRuns(storage: WorkflowRunStorage | null): WorkflowRun[] {
  if (storage === null) return []
  try {
    const serialized = storage.getItem(WORKFLOW_RUN_STORAGE_KEY)
    if (serialized === null) return []
    const value: unknown = JSON.parse(serialized)
    if (
      !isRecord(value) ||
      value.version !== WORKFLOW_RUN_STORAGE_VERSION ||
      !Array.isArray(value.runs)
    ) {
      return []
    }
    return value.runs.filter(isWorkflowRun).map((run) => structuredClone(run))
  } catch {
    return []
  }
}

function resolveBrowserStorage(): WorkflowRunStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 内存快照是当前会话的权威状态，localStorage 仅用于刷新恢复。 */
export function createWorkflowRunStore(
  options: CreateWorkflowRunStoreOptions = {},
): WorkflowRunStore {
  const storage = options.storage === undefined ? resolveBrowserStorage() : options.storage
  const runs = new Map(readPersistedRuns(storage).map((run) => [run.id, run] as const))
  const listeners = new Map<string, Set<WorkflowRunListener>>()
  const listListeners = new Set<WorkflowRunListListener>()

  const snapshotList = () => [...runs.values()].map((run) => structuredClone(run))

  return {
    get(runId) {
      const run = runs.get(runId)
      return run ? structuredClone(run) : null
    },
    list: snapshotList,
    save(run) {
      if (!isWorkflowRun(run)) throw new TypeError('Invalid WorkflowRun snapshot')
      const saved = structuredClone(run)
      runs.set(saved.id, saved)

      const persisted: PersistedWorkflowRuns = {
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [...runs.values()],
      }
      try {
        storage?.setItem(WORKFLOW_RUN_STORAGE_KEY, JSON.stringify(persisted))
      } catch {
        // 持久化失败不撤销已经写入的当前会话状态。
      }

      for (const listener of listeners.get(saved.id) ?? []) {
        try {
          listener(structuredClone(saved))
        } catch {
          // 一个订阅方失败不能阻断其他订阅方。
        }
      }
      for (const listener of listListeners) {
        try {
          listener(snapshotList())
        } catch {
          // 历史列表订阅方失败不影响已保存状态。
        }
      }
    },
    subscribe(runId, listener) {
      const runListeners = listeners.get(runId) ?? new Set<WorkflowRunListener>()
      runListeners.add(listener)
      listeners.set(runId, runListeners)
      return () => {
        runListeners.delete(listener)
        if (runListeners.size === 0) listeners.delete(runId)
      }
    },
    subscribeAll(listener) {
      listListeners.add(listener)
      return () => listListeners.delete(listener)
    },
  }
}
