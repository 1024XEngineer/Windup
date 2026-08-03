/**
 * WorkflowRun 的本地仓库与运行时边界校验。
 *
 * 这个 Store 只做四件事：创建合法初始快照、保存/读取快照、刷新恢复、通知订阅者。
 * 它不是 WorkflowController：不调 Generation API、不处理 SSE、不决定何时进入下一步，
 * 也不负责调用后端候选图清理接口。这些编排行为由同一 Entity 下的
 * WorkflowRun Service 组合已有 Generation/Character 端口完成。
 *
 * localStorage 是当前没有 WorkflowRun 后端持久化时的刷新恢复适配器，
 * 不代表把浏览器宣布为最终服务器数据源。
 */

import type {
  CreateWorkflowRunInput,
  WorkflowRevision,
  WorkflowRun,
  WorkflowRunPurpose,
} from '../model'
import {
  ACTION_FIRST_FRAME_CANDIDATE_COUNT,
  EXPORT_STATUSES,
  GENERATION_STATUSES,
  WORKFLOW_DRIVERS,
  WORKFLOW_PURPOSES,
  WORKFLOW_REVISION_STATUSES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_ORDERS,
  WORKFLOW_STEP_STATUSES,
} from '../model/constants'

/** 稳定 key 保证刷新前后读取同一份数据，不随页面路由或组件名改动。 */
export const WORKFLOW_RUN_STORAGE_KEY = 'windup.workflow-runs'

/**
 * 持久化数据版本。当快照结构或业务不变式变更时递增，
 * 防止新代码将旧 JSON 误认为合法运行状态。
 */
export const WORKFLOW_RUN_STORAGE_VERSION = 3

type WorkflowRunListener = (run: WorkflowRun) => void
type WorkflowRunListListener = (runs: WorkflowRun[]) => void

/** 只依赖最小存储能力，测试可用内存替身，未来也可换成其他适配器。 */
interface WorkflowRunStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * WorkflowRun 的最小仓库接口。
 *
 * create 只产生初始合法快照；save 保存已由业务层推进的整体快照。
 * subscribe 服务单个创作页，subscribeAll 服务历史列表；两者都不改写数据。
 */
export interface WorkflowRunStore {
  create(input: CreateWorkflowRunInput): WorkflowRun
  get(runId: WorkflowRun['id']): WorkflowRun | null
  list(): WorkflowRun[]
  save(run: WorkflowRun): void
  subscribe(runId: WorkflowRun['id'], listener: WorkflowRunListener): () => void
  subscribeAll(listener: WorkflowRunListListener): () => void
}

export interface CreateWorkflowRunStoreOptions {
  /** null 表示仅保存在当前内存；未传时浏览器默认使用 localStorage。 */
  storage?: WorkflowRunStorage | null
  /** 测试可注入确定性 ID；生产默认使用 crypto.randomUUID。 */
  createId?: () => string
  /** 测试可注入确定性时间。 */
  now?: () => string
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

/**
 * 校验单个步骤的关键不变式。
 *
 * - failed 必须有可读错误，非 failed 不得残留旧错误；
 * - submissionId 只能出现在 active 且与 taskId 互斥；
 * - taskId 可在 passed/failed 后保留，便于追踪后端任务；
 * - 只有 first-frame 可保存最多 4 个 candidateTaskIds，passed 时必须已集齐 4 个；
 * - 拒绝 input/output 是为了防止四张临时候选或页面对象被塞进长期快照。
 */
function isWorkflowStep(value: unknown, expectedType: string): boolean {
  if (!isRecord(value)) return false
  const candidateTaskIds = isStringArray(value.candidateTaskIds) ? value.candidateTaskIds : null

  const errorIsValid =
    isNullableString(value.error) &&
    (value.status === 'failed'
      ? typeof value.error === 'string' && value.error.trim().length > 0
      : value.error === null)
  const taskStateIsValid =
    isNullableString(value.taskId) &&
    candidateTaskIds !== null &&
    new Set(candidateTaskIds).size === candidateTaskIds.length &&
    candidateTaskIds.every((id) => id.length > 0) &&
    isNullableString(value.submissionId) &&
    !(value.taskId !== null && value.submissionId !== null) &&
    (value.submissionId === null || value.status === 'active') &&
    (value.taskId === null || ['active', 'passed', 'failed'].includes(String(value.status)))
  const candidateTasksAreValid =
    candidateTaskIds !== null &&
    (expectedType === 'first-frame'
      ? value.taskId === null &&
        candidateTaskIds.length <= ACTION_FIRST_FRAME_CANDIDATE_COUNT &&
        (value.status !== 'passed' ||
          candidateTaskIds.length === ACTION_FIRST_FRAME_CANDIDATE_COUNT)
      : candidateTaskIds.length === 0)

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.type === expectedType &&
    isMember(value.status, WORKFLOW_STEP_STATUSES) &&
    !('input' in value) &&
    !('output' in value) &&
    taskStateIsValid &&
    candidateTasksAreValid &&
    errorIsValid &&
    isStringArray(value.referenceStepIds)
  )
}

/**
 * Revision 必须完整包含当前 purpose 的步骤模板，数量、顺序和 type 都要一致。
 * 这会阻止 add_action 在恢复时被误塞入角色母版步骤，也阻止页面自行改变顺序。
 */
function isWorkflowRevision(
  value: unknown,
  purpose: WorkflowRunPurpose,
): value is WorkflowRevision {
  if (!isRecord(value) || !Array.isArray(value.steps)) return false
  const stepIds = value.steps.map((step) => (isRecord(step) ? step.id : null))
  const expectedOrder = WORKFLOW_STEP_ORDERS[purpose]

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    isNullableString(value.basedOnRevisionId) &&
    isNullableString(value.restartStepId) &&
    isMember(value.status, WORKFLOW_REVISION_STATUSES) &&
    value.steps.length === expectedOrder.length &&
    value.steps.every((step, index) => isWorkflowStep(step, expectedOrder[index]!)) &&
    new Set(stepIds).size === stepIds.length &&
    isMember(value.generationStatus, GENERATION_STATUSES) &&
    isMember(value.exportStatus, EXPORT_STATUSES) &&
    typeof value.createdAt === 'string'
  )
}

/**
 * 验证 Revision 历史链，防止伪造或悬空引用。
 *
 * 首版不能有来源；后续版本必须指向更早的 Revision，且只能从该版本中
 * 已 passed 的步骤重开。referenceStepIds 只能引用已经出现的旧步骤，
 * 不能指向未来版本或不存在的 ID。
 */
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

/**
 * 整体 Run 校验。它在两个不可信边界调用：读取 localStorage 和 save() 写入前。
 * 因此 TypeScript 类型正确仍不够；JSON、旧版数据和手工断言都可能绕过编译期。
 */
function isWorkflowRun(value: unknown): value is WorkflowRun {
  if (
    !isRecord(value) ||
    !isMember(value.purpose, WORKFLOW_PURPOSES) ||
    !Array.isArray(value.revisions) ||
    value.revisions.length === 0
  ) {
    return false
  }
  const purpose = value.purpose
  if (!value.revisions.every((revision) => isWorkflowRevision(revision, purpose))) return false

  const revisions = value.revisions
  const current = revisions.at(-1)
  if (!current || current.id !== value.currentRevisionId || !hasValidRevisionLine(revisions)) {
    return false
  }

  // Run 的结果必须与当前 Revision 结果同步，避免页面各读一层时得到矛盾答案。
  const expectedRevisionStatus =
    value.status === 'failed' ? 'failed' : value.status === 'completed' ? 'completed' : 'active'
  if (current.status !== expectedRevisionStatus) return false
  if (revisions.slice(0, -1).some((revision) => revision.status === 'active')) return false

  // 运行中/已中断保留唯一当前步骤；终态不得继续挂着 active 步骤。
  const activeStepCount = current.steps.filter((step) => step.status === 'active').length
  if (
    ((value.status === 'active' || value.status === 'interrupted') && activeStepCount !== 1) ||
    ((value.status === 'failed' || value.status === 'completed') && activeStepCount !== 0)
  ) {
    return false
  }

  //
  // 角色 Run 有两个合法阶段：尚未选择时三个字段都为 null，
  // 或正式保存成功后 ID 与选择时间同时存在。动作 Run 则从创建起就必须绑定角色造型。
  const targetIsValid =
    value.purpose === 'add_action'
      ? isNonEmptyString(value.characterId) &&
        isNonEmptyString(value.outfitId) &&
        value.selectedAt === undefined &&
        isNonEmptyString(value.actionId) &&
        isNonEmptyString(value.actionName) &&
        ['walk', 'idle', 'attack', 'jump', 'custom'].includes(String(value.actionType)) &&
        typeof value.fps === 'number' &&
        Number.isFinite(value.fps) &&
        value.fps > 0
      : value.purpose === 'create_character' &&
        ((value.characterId === null && value.outfitId === null && value.selectedAt === null) ||
          (isNonEmptyString(value.characterId) &&
            isNonEmptyString(value.outfitId) &&
            isNonEmptyString(value.selectedAt)))

  if (
    value.purpose === 'create_character' &&
    value.status === 'completed' &&
    value.characterId === null
  ) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    isNonEmptyString(value.projectId) &&
    targetIsValid &&
    isMember(value.driver, WORKFLOW_DRIVERS) &&
    isMember(value.status, WORKFLOW_RUN_STATUSES) &&
    isNullableString(value.prompt) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  )
}

/**
 * 持久化读取采用“失败即忽略”策略：一条损坏数据不能阻止应用启动。
 * 这不是默默修复错误；无法证明合法的 Run 不进入内存，避免错误状态被继续推进。
 */
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

/** SSR/测试环境没有 window，隐私模式也可能拒绝 localStorage，因此存储能力必须可降级。 */
function resolveBrowserStorage(): WorkflowRunStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 运行、版本和步骤都要跨刷新稳定引用，所以不使用数组下标或时间戳充当 ID。 */
function createRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is required to create a WorkflowRun')
  }
  return globalThis.crypto.randomUUID()
}

/**
 * 创建 WorkflowRun Store。
 *
 * 内存快照是当前会话的权威状态，localStorage 仅用于刷新恢复。
 * 所以存储写入失败时不回滚内存：用户当前页面仍可继续工作，
 * 但刷新恢复能力已降级。未来接入后端持久化时，应替换适配器而不改变业务模型。
 */
export function createWorkflowRunStore(
  options: CreateWorkflowRunStoreOptions = {},
): WorkflowRunStore {
  const storage = options.storage === undefined ? resolveBrowserStorage() : options.storage
  const createId = options.createId ?? createRandomId
  const now = options.now ?? (() => new Date().toISOString())
  const runs = new Map(readPersistedRuns(storage).map((run) => [run.id, run] as const))
  const listeners = new Map<string, Set<WorkflowRunListener>>()
  const listListeners = new Set<WorkflowRunListListener>()

  const snapshotList = () => [...runs.values()].map((run) => structuredClone(run))

  const store: WorkflowRunStore = {
    create(input) {
      // create 只在用户真正发起任务时调用：
      // 选好角色后进入动作区域不创建空 Run，点击“生成动作”才创建 add_action。
      const createdAt = now()
      const runId = createId()
      const revisionId = createId()
      // 初始时只激活第一步，后续步骤等待前置条件通过。
      const steps = WORKFLOW_STEP_ORDERS[input.purpose].map((type, index) => ({
        id: createId(),
        type,
        status: index === 0 ? ('active' as const) : ('locked' as const),
        taskId: null,
        candidateTaskIds: [],
        submissionId: null,
        error: null,
        referenceStepIds: [],
      }))
      const base = {
        id: runId,
        projectId: input.projectId,
        purpose: input.purpose,
        driver: input.driver,
        status: 'active' as const,
        currentRevisionId: revisionId,
        revisions: [
          {
            id: revisionId,
            basedOnRevisionId: null,
            restartStepId: null,
            status: 'active' as const,
            steps,
            generationStatus: 'not_started' as const,
            exportStatus: 'not_exported' as const,
            createdAt,
          },
        ],
        prompt: input.prompt?.trim() || null,
        createdAt,
        updatedAt: createdAt,
      }
      const run: WorkflowRun =
        input.purpose === 'create_character'
          ? { ...base, purpose: input.purpose, characterId: null, outfitId: null, selectedAt: null }
          : {
              ...base,
              purpose: input.purpose,
              characterId: input.characterId,
              outfitId: input.outfitId,
              actionId: createId(),
              actionName: input.actionName.trim(),
              actionType: input.actionType,
              fps: input.fps,
            }

      // 统一走 save 以复用运行时校验、持久化和订阅通知，避免 create 产生特例状态。
      store.save(run)
      return structuredClone(run)
    },
    get(runId) {
      const run = runs.get(runId)
      return run ? structuredClone(run) : null
    },
    list: snapshotList,
    save(run) {
      if (!isWorkflowRun(run)) throw new TypeError('Invalid WorkflowRun snapshot')
      // 内外都使用深拷贝，防止调用方在 save/get 后继续修改对象，绕过校验篡改 Store。
      const saved = structuredClone(run)
      runs.set(saved.id, saved)

      const persisted: PersistedWorkflowRuns = {
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [...runs.values()],
      }
      try {
        storage?.setItem(WORKFLOW_RUN_STORAGE_KEY, JSON.stringify(persisted))
      } catch {
        // 持久化失败不撤销已经写入的当前会话状态，只降级刷新恢复能力。
      }

      for (const listener of listeners.get(saved.id) ?? []) {
        try {
          // 每个订阅者获得独立副本，一个页面不能通过修改参数影响另一个页面。
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

  return store
}
