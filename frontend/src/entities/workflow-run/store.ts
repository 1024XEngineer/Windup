import type { WorkflowRun } from './index'
import { parseCharacterTemplateGenerationResult } from '../generation'
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

interface WorkflowRunStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface WorkflowRunStore {
  get(runId: WorkflowRun['id']): WorkflowRun | null
  save(run: WorkflowRun): void
  subscribe(runId: WorkflowRun['id'], listener: WorkflowRunListener): () => void
}

export interface CreateWorkflowRunStoreOptions {
  /**
   * 传 null 可显式创建仅内存存储；不传时在浏览器中使用 localStorage。
   * 该入口也让纯逻辑测试无需模拟完整 DOM。
   */
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isMember<T extends string>(value: unknown, members: readonly T[]): value is T {
  return typeof value === 'string' && members.includes(value as T)
}

function isWorkflowStep(value: unknown): boolean {
  if (!isRecord(value)) return false

  const commonFieldsAreValid =
    typeof value.id === 'string' &&
    isMember(value.type, WORKFLOW_STEP_ORDER) &&
    isMember(value.status, WORKFLOW_STEP_STATUSES) &&
    isNullableString(value.taskId) &&
    isNullableString(value.submissionId) &&
    isStringArray(value.referenceStepIds) &&
    'input' in value &&
    'output' in value
  if (!commonFieldsAreValid) return false
  const error = value.error
  if (!isNullableString(error)) return false
  if (
    (value.status === 'failed' && (error === null || error.trim().length === 0)) ||
    (value.status !== 'failed' && error !== null)
  ) {
    return false
  }

  if (value.type === 'character-setup') {
    return (
      value.output === null &&
      (value.input === null ||
        (isRecord(value.input) &&
          typeof value.input.description === 'string' &&
          isStringArray(value.input.referenceMedia)))
    )
  }
  if (value.type === 'character-template') {
    return (
      (value.input === null ||
        (isRecord(value.input) &&
          value.input.type === 'character_template' &&
          typeof value.input.projectId === 'string' &&
          typeof value.input.prompt === 'string' &&
          isStringArray(value.input.referenceMedia))) &&
      (value.output === null || parseCharacterTemplateGenerationResult(value.output) !== null)
    )
  }
  return true
}

function isWorkflowRevision(value: unknown): boolean {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    isNullableString(value.basedOnRevisionId) &&
    isNullableString(value.restartStepId) &&
    isMember(value.status, WORKFLOW_REVISION_STATUSES) &&
    Array.isArray(value.steps) &&
    value.steps.length === WORKFLOW_STEP_ORDER.length &&
    value.steps.every(
      (step, index) =>
        isWorkflowStep(step) && isRecord(step) && step.type === WORKFLOW_STEP_ORDER[index],
    ) &&
    isMember(value.generationStatus, GENERATION_STATUSES) &&
    isMember(value.exportStatus, EXPORT_STATUSES) &&
    typeof value.createdAt === 'string'
  )
}

function isWorkflowRun(value: unknown): value is WorkflowRun {
  if (!isRecord(value) || !Array.isArray(value.revisions)) return false

  const fieldsAreValid =
    typeof value.id === 'string' &&
    typeof value.projectId === 'string' &&
    isNullableString(value.characterId) &&
    isNullableString(value.outfitId) &&
    isMember(value.purpose, WORKFLOW_PURPOSES) &&
    isMember(value.driver, WORKFLOW_DRIVERS) &&
    isMember(value.status, WORKFLOW_RUN_STATUSES) &&
    typeof value.currentRevisionId === 'string' &&
    value.revisions.length === 1 &&
    value.revisions.every(isWorkflowRevision) &&
    value.revisions.some(
      (revision) => isRecord(revision) && revision.id === value.currentRevisionId,
    ) &&
    isNullableString(value.prompt)
  if (!fieldsAreValid) return false

  const currentRevision = value.revisions.find(
    (revision) => isRecord(revision) && revision.id === value.currentRevisionId,
  )
  if (!isRecord(currentRevision) || !Array.isArray(currentRevision.steps)) return false
  if (currentRevision.basedOnRevisionId !== null || currentRevision.restartStepId !== null) {
    return false
  }

  const expectedRevisionStatus =
    value.status === 'failed' ? 'failed' : value.status === 'completed' ? 'completed' : 'active'
  if (currentRevision.status !== expectedRevisionStatus) return false

  const activeStepCount = currentRevision.steps.filter(
    (step) => isRecord(step) && step.status === 'active',
  ).length
  if (
    ((value.status === 'active' || value.status === 'interrupted') && activeStepCount !== 1) ||
    ((value.status === 'failed' || value.status === 'completed') && activeStepCount !== 0)
  ) {
    return false
  }

  return value.revisions.every(
    (revision) =>
      isRecord(revision) &&
      Array.isArray(revision.steps) &&
      revision.steps.every((step) => {
        if (!isRecord(step)) return false
        const taskId = step.taskId
        const submissionId = step.submissionId
        if (taskId !== null && submissionId !== null) return false
        if (taskId === null && submissionId === null) return true
        return step.type === 'character-template' && step.status === 'active'
      }),
  )
}

function readPersistedRuns(storage: WorkflowRunStorage | null): WorkflowRun[] {
  if (storage === null) return []

  try {
    const serialized = storage.getItem(WORKFLOW_RUN_STORAGE_KEY)
    if (serialized === null) return []

    const persisted: unknown = JSON.parse(serialized)
    if (
      !isRecord(persisted) ||
      persisted.version !== WORKFLOW_RUN_STORAGE_VERSION ||
      !Array.isArray(persisted.runs)
    ) {
      return []
    }

    return persisted.runs.filter(isWorkflowRun).map((run) => structuredClone(run))
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

/**
 * WorkflowRun 的内存快照是当前会话的权威状态，localStorage 只负责刷新恢复。
 * 因此 save 先更新内存；浏览器拒绝写入时，本次运行仍能继续读取和订阅。
 */
export function createWorkflowRunStore(
  options: CreateWorkflowRunStoreOptions = {},
): WorkflowRunStore {
  const storage = options.storage === undefined ? resolveBrowserStorage() : options.storage
  const runs = new Map(readPersistedRuns(storage).map((run) => [run.id, run] as const))
  const listeners = new Map<WorkflowRun['id'], Set<WorkflowRunListener>>()

  return {
    get(runId) {
      const run = runs.get(runId)
      return run === undefined ? null : structuredClone(run)
    },

    save(run) {
      const savedRun = structuredClone(run)
      runs.set(savedRun.id, savedRun)

      const persisted: PersistedWorkflowRuns = {
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [...runs.values()],
      }

      try {
        storage?.setItem(WORKFLOW_RUN_STORAGE_KEY, JSON.stringify(persisted))
      } catch {
        // 内存已成功更新；持久化失败不能中断当前会话中的工作流。
      }

      for (const listener of listeners.get(savedRun.id) ?? []) {
        try {
          listener(structuredClone(savedRun))
        } catch {
          // 订阅方渲染失败不能撤销已经保存的运行状态，也不能阻断其他订阅方。
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
  }
}
