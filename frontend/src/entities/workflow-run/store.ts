import type { WorkflowRun } from './index'
import {
  parseCharacterTemplateGenerationResult,
  parseCompleteAnimationGenerationResult,
} from '../generation'
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
export const WORKFLOW_RUN_STORAGE_VERSION = 4

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
  if (value.type === 'action-generation') {
    return (
      (value.input === null ||
        (isRecord(value.input) &&
          value.input.type === 'complete_animation' &&
          typeof value.input.projectId === 'string' &&
          typeof value.input.characterId === 'string' &&
          typeof value.input.outfitId === 'string' &&
          typeof value.input.firstFrameUrl === 'string' &&
          typeof value.input.actionType === 'string' &&
          isStringArray(value.input.referenceMedia))) &&
      (value.output === null || parseCompleteAnimationGenerationResult(value.output) !== null)
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
    value.revisions.length > 0 &&
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
  if (!hasValidRevisionLine(value.revisions)) return false

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
        // 只有 character-template 与 action-generation 允许在 active 步骤上
        // 持有任务 ID（角色图 / 动作生成任务，刷新后可恢复轮询）
        return (
          (step.type === 'character-template' || step.type === 'action-generation') &&
          step.status === 'active'
        )
      }),
  )
}

function hasValidRevisionLine(revisions: unknown[]): boolean {
  const seenRevisionIds = new Set<string>()
  const byId = new Map<string, Record<string, unknown>>()

  for (const [index, revision] of revisions.entries()) {
    if (
      !isRecord(revision) ||
      typeof revision.id !== 'string' ||
      seenRevisionIds.has(revision.id)
    ) {
      return false
    }
    seenRevisionIds.add(revision.id)

    if (index === 0) {
      if (revision.basedOnRevisionId !== null || revision.restartStepId !== null) return false
    } else {
      if (
        typeof revision.basedOnRevisionId !== 'string' ||
        typeof revision.restartStepId !== 'string'
      ) {
        return false
      }
      const source = byId.get(revision.basedOnRevisionId)
      if (
        !source ||
        !Array.isArray(source.steps) ||
        !source.steps.some(
          (step) =>
            isRecord(step) && step.id === revision.restartStepId && step.status === 'passed',
        )
      ) {
        return false
      }
    }

    byId.set(revision.id, revision)
  }

  return true
}

function migrateVersionOneRun(value: unknown): WorkflowRun | null {
  if (!isRecord(value) || !Array.isArray(value.revisions)) return null

  const revisions: unknown[] = []
  for (const revision of value.revisions) {
    const migratedRevision = migrateVersionOneRevision(revision)
    if (!migratedRevision) return null
    revisions.push(migratedRevision)
  }

  const migrated = { ...value, revisions }
  return migrateVersionThreeRun(migrated)
}

function migrateVersionTwoRun(value: unknown): WorkflowRun | null {
  return migrateVersionThreeRun(value)
}

function migrateVersionThreeRun(value: unknown): WorkflowRun | null {
  if (!isRecord(value) || !Array.isArray(value.revisions)) return null
  const revisions = value.revisions.map((revision) => {
    if (!isRecord(revision) || !Array.isArray(revision.steps)) return revision
    return {
      ...revision,
      steps: revision.steps.map((step) => {
        if (!isRecord(step) || step.type !== 'action-generation' || !isRecord(step.output)) {
          return step
        }
        if (step.output.type !== 'first_frame' || !isRecord(step.output.image)) return step
        const url = step.output.image.url
        if (typeof url !== 'string' || !url) return step
        const actionType =
          isRecord(step.input) &&
          ['walk', 'idle', 'attack', 'jump', 'custom'].includes(String(step.input.actionType))
            ? step.input.actionType
            : 'custom'
        return {
          ...step,
          output: {
            type: 'complete_animation',
            actionType,
            frames: [{ url, durationMs: null }],
          },
        }
      }),
    }
  })
  const migrated = { ...value, revisions }
  return isWorkflowRun(migrated) ? migrated : null
}

function migrateVersionOneRevision(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.steps)) return null

  const steps = value.steps
  const legacyOrder = [
    'character-setup',
    'character-template',
    'template-candidate',
    'action-setup',
    'first-frame',
    'complete-animation',
    'review',
    'export',
  ] as const
  if (
    steps.length !== legacyOrder.length ||
    !steps.every((step, index) => isRecord(step) && step.type === legacyOrder[index])
  ) {
    return null
  }

  const [
    characterSetup,
    characterTemplate,
    templateCandidate,
    actionSetup,
    firstFrame,
    animation,
    review,
  ] = steps
  if (
    !isRecord(characterSetup) ||
    !isRecord(characterTemplate) ||
    !isRecord(templateCandidate) ||
    !isRecord(actionSetup) ||
    !isRecord(firstFrame) ||
    !isRecord(animation) ||
    !isRecord(review)
  ) {
    return null
  }

  const actionSteps = [actionSetup, firstFrame, animation]
  const collapsedAction =
    actionSteps.find((step) => step.status === 'active') ??
    actionSteps.find((step) => step.status === 'failed') ??
    (actionSteps.every((step) => step.status === 'passed') ? animation : actionSetup)
  const actionStepId = `${value.id}:action-generation`
  const legacyActionIds = new Set(
    actionSteps.map((step) => step.id).filter((id): id is string => typeof id === 'string'),
  )

  function migrateReferences(step: Record<string, unknown>): Record<string, unknown> {
    const referenceStepIds = Array.isArray(step.referenceStepIds)
      ? step.referenceStepIds.map((id) => (legacyActionIds.has(id) ? actionStepId : id))
      : step.referenceStepIds
    return { ...step, referenceStepIds }
  }

  return {
    ...value,
    steps: [
      migrateReferences(characterSetup),
      migrateReferences(characterTemplate),
      migrateReferences(templateCandidate),
      {
        ...migrateReferences(collapsedAction),
        id: actionStepId,
        type: 'action-generation',
      },
      migrateReferences(review),
    ],
  }
}

function readPersistedRuns(storage: WorkflowRunStorage | null): WorkflowRun[] {
  if (storage === null) return []

  try {
    const serialized = storage.getItem(WORKFLOW_RUN_STORAGE_KEY)
    if (serialized === null) return []

    const persisted: unknown = JSON.parse(serialized)
    if (!isRecord(persisted) || !Array.isArray(persisted.runs)) return []

    if (persisted.version === WORKFLOW_RUN_STORAGE_VERSION) {
      return persisted.runs.filter(isWorkflowRun).map((run) => structuredClone(run))
    }

    if (persisted.version === 1) {
      return persisted.runs
        .map(migrateVersionOneRun)
        .filter((run): run is WorkflowRun => run !== null)
        .map((run) => structuredClone(run))
    }

    if (persisted.version === 2) {
      return persisted.runs
        .map(migrateVersionTwoRun)
        .filter((run): run is WorkflowRun => run !== null)
        .map((run) => structuredClone(run))
    }

    if (persisted.version === 3) {
      return persisted.runs
        .map(migrateVersionThreeRun)
        .filter((run): run is WorkflowRun => run !== null)
        .map((run) => structuredClone(run))
    }

    return []
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
  const listListeners = new Set<WorkflowRunListListener>()

  return {
    get(runId) {
      const run = runs.get(runId)
      return run === undefined ? null : structuredClone(run)
    },

    list() {
      return [...runs.values()].map((run) => structuredClone(run))
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
      const snapshot = [...runs.values()].map((run) => structuredClone(run))
      for (const listener of listListeners) {
        try {
          listener(snapshot.map((run) => structuredClone(run)))
        } catch {
          // 一个列表订阅方失败不能阻断其他页面刷新。
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
