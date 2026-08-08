import type { CreateWorkflowRunInput, WorkflowNode, WorkflowRun } from './index'

/**
 * WorkflowRun 持久化契约。
 *
 * 持久化走服务端 API，所有方法均为异步。前端不保留 localStorage 副本，
 * 也不提供 subscribe / subscribeAll——状态变更由前端逻辑自身驱动。
 *
 * 后端 API 契约（对齐 commit 4246389b）
 * --------------------------------
 * POST   /workflow-runs       创建执行记录
 * GET    /workflow-runs/{id}   获取执行记录（含 nodes JSONB）
 * PATCH  /workflow-runs/{id}   全量更新（含 nodes）
 * DELETE /workflow-runs/{id}   软删除
 *
 * 后端只做存储，不感知节点结构。前端 WorkflowRun 的完整状态（除 id / projectId 外）
 * 序列化到后端 nodes 字段。id/projectId 映射为后端顶层 id/project_id。
 */
export interface WorkflowRunStore {
  /** 创建一条新的 WorkflowRun，返回服务端持久化后的完整快照。 */
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  /** 按 ID 读取 WorkflowRun 最新快照；不存在时返回 null。 */
  get(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  /** 按已关联的 Character ID 查找唯一绑定的 WorkflowRun（客户端过滤）。 */
  getByCharacter(characterId: string): Promise<WorkflowRun | null>
  /** 列出当前项目下的全部 WorkflowRun。 */
  list(projectId?: string): Promise<WorkflowRun[]>
  /** 保存 WorkflowRun 最新状态到服务端。 */
  save(run: WorkflowRun): Promise<void>
  /** 删除 WorkflowRun；HTTP 实现对应后端软删除。 */
  remove(runId: WorkflowRun['id']): Promise<void>
}

export interface CreateWorkflowRunStoreOptions {
  /**
   * HTTP 客户端，提供 fetch 方法。
   * 不传时使用仅内存存储（测试友好）。
   */
  api?: { fetch(input: RequestInfo, init?: RequestInit): Promise<unknown> }
}

// ── 序列化 ─────────────────────────────────────────────────────────────────

/** 后端 WorkflowRun 响应形状（nodes JSONB 透传）。 */
interface BackendWorkflowRun {
  id: number
  project_id: number
  nodes: Record<string, unknown>[]
  status: string
  version: number
}

interface StoredRunMetadata {
  characterId: string | null
  outfitId: string | null
  purpose: WorkflowRun['purpose']
  status: WorkflowRun['status']
  generationStatus: WorkflowRun['generationStatus']
  exportStatus: WorkflowRun['exportStatus']
  prompt: string | null
  createdAt: string
}

const RUN_METADATA_FIELD = '__workflowRun'

function toRunMetadata(run: WorkflowRun): StoredRunMetadata {
  return {
    characterId: run.characterId,
    outfitId: run.outfitId,
    purpose: run.purpose,
    status: run.status,
    generationStatus: run.generationStatus,
    exportStatus: run.exportStatus,
    prompt: run.prompt,
    createdAt: run.createdAt,
  }
}

/**
 * 后端的 nodes 数组直接保存真实图节点，不再套 root/steps。
 * 运行级字段临时附在首个真实节点的保留字段上；后端正式提供顶层字段后可平移出去。
 */
function toStoredNodes(run: WorkflowRun): Record<string, unknown>[] {
  return run.nodes.map((node, index) =>
    index === 0
      ? { ...structuredClone(node), [RUN_METADATA_FIELD]: toRunMetadata(run) }
      : (structuredClone(node) as unknown as Record<string, unknown>),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripRunMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const { [RUN_METADATA_FIELD]: _metadata, ...node } = value
  return node
}

const WORKFLOW_NODE_TYPES = new Set([
  'character-setup',
  'character-template',
  'action-first-frame',
  'action-generation-method',
  'action-full-frame',
  'review',
])
const WORKFLOW_NODE_STATUSES = new Set(['locked', 'active', 'passed', 'failed'])

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isValidActionInput(value: unknown): boolean {
  if (value === null) return true
  return (
    isRecord(value) &&
    value.type === 'character_action' &&
    typeof value.projectId === 'string' &&
    typeof value.characterId === 'string' &&
    typeof value.outfitId === 'string' &&
    typeof value.actionType === 'string' &&
    isNullableString(value.firstFrameUrl) &&
    isNullableString(value.prompt) &&
    isStringArray(value.referenceMedia) &&
    typeof value.numFrames === 'number'
  )
}

function isValidActionOutput(value: unknown): boolean {
  if (value === null) return true
  return (
    isRecord(value) &&
    value.type === 'character_action' &&
    typeof value.actionType === 'string' &&
    Array.isArray(value.frames) &&
    value.frames.every(
      (frame) =>
        isRecord(frame) &&
        typeof frame.index === 'number' &&
        typeof frame.imageUrl === 'string' &&
        (frame.durationMs === null || typeof frame.durationMs === 'number'),
    )
  )
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    !WORKFLOW_NODE_TYPES.has(String(value.type)) ||
    !WORKFLOW_NODE_STATUSES.has(String(value.status)) ||
    !isStringArray(value.dependsOnNodeIds) ||
    !isNullableString(value.taskId) ||
    !isNullableString(value.submissionId) ||
    !isNullableString(value.error) ||
    !('input' in value) ||
    !('output' in value) ||
    !(
      value.deletedAt === undefined ||
      value.deletedAt === null ||
      typeof value.deletedAt === 'string'
    )
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
      (value.input === null || isRecord(value.input)) &&
      (value.output === null ||
        (isRecord(value.output) &&
          value.output.type === 'character_image' &&
          isStringArray(value.output.imageUrls)))
    )
  }
  if (value.type === 'action-first-frame' || value.type === 'action-full-frame') {
    return isValidActionInput(value.input) && isValidActionOutput(value.output)
  }
  if (value.type === 'action-generation-method') {
    return (
      value.output === null &&
      (value.input === null ||
        (isRecord(value.input) &&
          (value.input.method === 'video-cropping' || value.input.method === '3d-to-2d')))
    )
  }
  return value.type === 'review' && value.input === null && value.output === null
}

function parseWorkflowNodes(values: unknown): WorkflowRun['nodes'] {
  if (!Array.isArray(values)) throw new Error('WorkflowRun 节点数据无效：nodes 不是数组')
  return values.map((value, index) => {
    if (!isWorkflowNode(value)) throw new Error(`WorkflowRun 节点数据无效：第 ${index + 1} 项`)
    return structuredClone(value)
  })
}

function inferMetadata(nodes: WorkflowRun['nodes']): StoredRunMetadata {
  const visibleNodes = nodes.filter((node) => !node.deletedAt)
  const setup = visibleNodes.find((node) => node.type === 'character-setup')
  let characterId: string | null = null
  let outfitId: string | null = null
  for (const node of visibleNodes) {
    if (
      (node.type === 'action-first-frame' || node.type === 'action-full-frame') &&
      node.input !== null
    ) {
      characterId = node.input.characterId
      outfitId = node.input.outfitId
      break
    }
  }
  const failed = visibleNodes.some((node) => node.status === 'failed')
  const completed =
    visibleNodes.length > 0 && visibleNodes.every((node) => node.status === 'passed')
  const hasGeneration = visibleNodes.some((node) => node.taskId !== null || node.output !== null)
  return {
    characterId,
    outfitId,
    purpose: 'create_character',
    status: failed ? 'failed' : completed ? 'completed' : 'active',
    generationStatus: failed
      ? 'failed'
      : completed
        ? 'completed'
        : hasGeneration
          ? 'in_progress'
          : 'not_started',
    exportStatus: 'not_exported',
    prompt: setup?.input?.description?.trim() || null,
    createdAt: new Date().toISOString(),
  }
}

/** 从后端响应重建前端 WorkflowRun，并兼容早期 root + nodes 快照。 */
function fromBackend(b: BackendWorkflowRun, cachedMetadata?: StoredRunMetadata): WorkflowRun {
  const first = Array.isArray(b.nodes) ? b.nodes[0] : undefined
  if (isRecord(first) && Array.isArray(first.nodes)) {
    return {
      id: String(b.id),
      projectId: typeof first.projectId === 'string' ? first.projectId : String(b.project_id),
      characterId: typeof first.characterId === 'string' ? first.characterId : null,
      outfitId: typeof first.outfitId === 'string' ? first.outfitId : null,
      purpose: (first.purpose as WorkflowRun['purpose']) ?? 'create_character',
      status: (first.status as WorkflowRun['status']) ?? 'active',
      nodes: parseWorkflowNodes(first.nodes),
      generationStatus:
        (first.generationStatus as WorkflowRun['generationStatus']) ?? 'not_started',
      exportStatus: (first.exportStatus as WorkflowRun['exportStatus']) ?? 'not_exported',
      prompt: typeof first.prompt === 'string' ? first.prompt : null,
      createdAt: typeof first.createdAt === 'string' ? first.createdAt : new Date().toISOString(),
    }
  }

  const nodes = parseWorkflowNodes(
    Array.isArray(b.nodes) ? b.nodes.filter(isRecord).map(stripRunMetadata) : b.nodes,
  )
  const storedMetadata =
    isRecord(first) && isRecord(first[RUN_METADATA_FIELD])
      ? (first[RUN_METADATA_FIELD] as unknown as StoredRunMetadata)
      : undefined
  const metadata = storedMetadata ?? cachedMetadata ?? inferMetadata(nodes)
  return {
    id: String(b.id),
    projectId: String(b.project_id),
    ...metadata,
    nodes,
  }
}

// ── 内存存储（测试/过渡期） ──────────────────────────────────────────────────

function createInMemoryStore(): WorkflowRunStore {
  const runs = new Map<string, WorkflowRun>()

  return {
    async create(input) {
      const run: WorkflowRun = {
        id: `run-${runs.size + 1}`,
        projectId: input.projectId,
        characterId: 'characterId' in input ? (input.characterId as string) : null,
        outfitId: 'outfitId' in input ? (input.outfitId as string) : null,
        purpose: input.purpose,
        status: 'active',
        nodes: [],
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        prompt: input.prompt ?? null,
        createdAt: new Date().toISOString(),
      }
      runs.set(run.id, structuredClone(run))
      return structuredClone(run)
    },

    async get(runId) {
      const run = runs.get(runId)
      return run ? structuredClone(run) : null
    },

    async getByCharacter(characterId) {
      for (const run of runs.values()) {
        if (run.characterId === characterId) return structuredClone(run)
      }
      return null
    },

    async list(projectId) {
      return [...runs.values()]
        .filter((run) => !projectId || run.projectId === projectId)
        .map((run) => structuredClone(run))
    },

    async save(run) {
      runs.set(run.id, structuredClone(run))
    },

    async remove(runId) {
      runs.delete(runId)
    },
  }
}

// ── HTTP 存储 ──────────────────────────────────────────────────────────────

function isNotFoundError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 404
}

/**
 * 创建 WorkflowRunStore。
 * 传入 api 时走 HTTP 持久化（对齐后端 /workflow-runs 接口），
 * 否则使用仅内存存储（用于测试和过渡期）。
 */
export function createWorkflowRunStore(
  options: CreateWorkflowRunStoreOptions = {},
): WorkflowRunStore {
  const api = options.api
  if (!api) return createInMemoryStore()
  const metadataCache = new Map<WorkflowRun['id'], StoredRunMetadata>()

  /** 后端通用响应包装：Response<T> { code, message, data: T } */
  function _unwrap<T>(response: unknown): T {
    const r = response as { data?: T }
    if (r.data !== undefined) return r.data
    return response as T
  }

  return {
    async create(input) {
      const response = await api.fetch('/workflow-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: Number(input.projectId),
          nodes: [],
        }),
      })
      const backend = _unwrap(response) as BackendWorkflowRun
      const metadata: StoredRunMetadata = {
        characterId: 'characterId' in input ? (input.characterId ?? null) : null,
        outfitId: 'outfitId' in input ? (input.outfitId ?? null) : null,
        purpose: input.purpose,
        status: 'active',
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        prompt: input.prompt?.trim() || null,
        createdAt: new Date().toISOString(),
      }
      const run = fromBackend(backend, metadata)
      metadataCache.set(run.id, metadata)
      return run
    },

    async get(runId) {
      try {
        const response = await api.fetch(`/workflow-runs/${runId}`)
        const backend = _unwrap(response) as BackendWorkflowRun
        const run = fromBackend(backend, metadataCache.get(String(backend.id)))
        metadataCache.set(run.id, toRunMetadata(run))
        return run
      } catch (cause) {
        if (isNotFoundError(cause)) return null
        throw cause
      }
    },

    async getByCharacter(characterId) {
      try {
        // 后端无 characterId 查询参数，先全量拉取再客户端过滤。
        const runs = await api.fetch('/workflow-runs')
        const all = (_unwrap(runs) as BackendWorkflowRun[]).map((backend) =>
          fromBackend(backend, metadataCache.get(String(backend.id))),
        )
        return all.find((r) => r.characterId === characterId) ?? null
      } catch (cause) {
        if (isNotFoundError(cause)) return null
        throw cause
      }
    },

    async list(projectId) {
      const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
      const response = await api.fetch(`/workflow-runs${query}`)
      const items = _unwrap(response) as BackendWorkflowRun[]
      return items.map((backend) => fromBackend(backend, metadataCache.get(String(backend.id))))
    },

    async save(run) {
      await api.fetch(`/workflow-runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: toStoredNodes(run),
          status: 'active',
        }),
      })
      metadataCache.set(run.id, toRunMetadata(run))
    },

    async remove(runId) {
      await api.fetch(`/workflow-runs/${runId}`, { method: 'DELETE' })
      metadataCache.delete(runId)
    },
  }
}
