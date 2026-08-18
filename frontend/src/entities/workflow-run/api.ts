import { ApiError, createApiClient, getApiAccessToken } from '@/shared/api'
import type {
  ActionFirstFrameWorkflowNode,
  ActionFullFrameWorkflowNode,
  ActionGenerationMethodWorkflowNode,
  CharacterSetupWorkflowNode,
  CharacterTemplateWorkflowNode,
  ReviewWorkflowNode,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunApis,
} from './index'
import {
  WORKFLOW_GENERATION_ROLES,
  WORKFLOW_NODE_PHASES,
  WORKFLOW_NODE_STATUSES,
  WORKFLOW_RUN_STORAGE_STATUSES,
} from './constants'

/** 当前 WorkflowRun 已被其他请求更新，调用方需要重新读取后再继续修改。 */
export class WorkflowRunConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkflowRunConflictError'
  }
}

interface WorkflowRunDto {
  id: number
  project_id: number
  nodes: unknown[]
  status: string
  version: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMember<T extends string>(value: unknown, members: readonly T[]): value is T {
  return typeof value === 'string' && members.includes(value as T)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isGenerationRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.taskId === 'string' &&
    value.taskId.length > 0 &&
    isMember(value.role, WORKFLOW_GENERATION_ROLES)
  )
}

function hasValidCommonNodeFields(value: Record<string, unknown>): boolean {
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    !isMember(value.status, WORKFLOW_NODE_STATUSES) ||
    !isMember(value.phase, WORKFLOW_NODE_PHASES) ||
    !Array.isArray(value.dependsOnNodeIds) ||
    !value.dependsOnNodeIds.every((id) => typeof id === 'string' && id.length > 0) ||
    new Set(value.dependsOnNodeIds).size !== value.dependsOnNodeIds.length ||
    !Array.isArray(value.generations) ||
    !value.generations.every(isGenerationRef) ||
    !isNullableString(value.error) ||
    !(
      value.deletedAt === undefined ||
      value.deletedAt === null ||
      (typeof value.deletedAt === 'string' && value.deletedAt.trim().length > 0)
    )
  ) {
    return false
  }
  if (value.status === 'passed' ? value.phase !== 'completed' : value.phase === 'completed') {
    return false
  }
  return value.status === 'failed'
    ? typeof value.error === 'string' && value.error.trim().length > 0
    : value.error === null
}

function hasOnlyGenerationRole(value: Record<string, unknown>, role: string | null): boolean {
  if (!Array.isArray(value.generations)) return false
  if (role === null) return value.generations.length === 0
  const refs = value.generations.filter(isRecord)
  return (
    refs.length === value.generations.length &&
    refs.every((reference) => reference.role === role) &&
    new Set(refs.map((reference) => reference.taskId)).size === refs.length
  )
}

function hasValidCharacterInput(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    (value.name === undefined ||
      value.name === null ||
      (typeof value.name === 'string' &&
        value.name.trim().length > 0 &&
        value.name.length <= 20)) &&
    (value.characterId === undefined || isNullableString(value.characterId)) &&
    typeof value.prompt === 'string' &&
    Array.isArray(value.referenceMedia) &&
    value.referenceMedia.every((item) => typeof item === 'string')
  )
}

function hasValidActionInput(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.outfitId === 'string' &&
    value.outfitId.length > 0 &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.type === 'string' &&
    value.type.length > 0 &&
    isNullableString(value.prompt) &&
    typeof value.fps === 'number' &&
    Number.isFinite(value.fps) &&
    value.fps > 0
  )
}

function isCharacterSetupNode(value: unknown): value is CharacterSetupWorkflowNode {
  return (
    isRecord(value) &&
    value.type === 'character-setup' &&
    hasValidCommonNodeFields(value) &&
    ['configuring', 'completed'].includes(String(value.phase)) &&
    hasValidCharacterInput(value.input) &&
    hasOnlyGenerationRole(value, null)
  )
}

function isCharacterTemplateNode(value: unknown): value is CharacterTemplateWorkflowNode {
  return (
    isRecord(value) &&
    value.type === 'character-template' &&
    hasValidCommonNodeFields(value) &&
    ['ready', 'generating', 'selecting', 'completed'].includes(String(value.phase)) &&
    hasOnlyGenerationRole(value, 'character_template') &&
    isNullableString(value.selectedImageUrl) &&
    (value.phase !== 'completed' ||
      (typeof value.selectedImageUrl === 'string' && value.selectedImageUrl.length > 0))
  )
}

function isActionFirstFrameNode(value: unknown): value is ActionFirstFrameWorkflowNode {
  return (
    isRecord(value) &&
    value.type === 'action-first-frame' &&
    hasValidCommonNodeFields(value) &&
    ['configuring', 'generating', 'selecting', 'completed'].includes(String(value.phase)) &&
    hasValidActionInput(value.input) &&
    hasOnlyGenerationRole(value, 'first_frame') &&
    isNullableString(value.selectedFirstFrameUrl) &&
    (value.phase !== 'completed' ||
      (typeof value.selectedFirstFrameUrl === 'string' && value.selectedFirstFrameUrl.length > 0))
  )
}

function isActionFullFrameNode(value: unknown): value is ActionFullFrameWorkflowNode {
  return (
    isRecord(value) &&
    value.type === 'action-full-frame' &&
    hasValidCommonNodeFields(value) &&
    ['ready', 'generating', 'completed'].includes(String(value.phase)) &&
    hasOnlyGenerationRole(value, 'complete_animation')
  )
}

function isActionGenerationMethodNode(value: unknown): value is ActionGenerationMethodWorkflowNode {
  return (
    isRecord(value) &&
    value.type === 'action-generation-method' &&
    hasValidCommonNodeFields(value) &&
    ['selecting', 'completed'].includes(String(value.phase)) &&
    hasOnlyGenerationRole(value, null) &&
    (value.method === null || value.method === 'video-cropping' || value.method === '3d-to-2d') &&
    (value.phase !== 'completed' || value.method !== null)
  )
}

function isReviewNode(value: unknown): value is ReviewWorkflowNode {
  return (
    isRecord(value) &&
    value.type === 'review' &&
    hasValidCommonNodeFields(value) &&
    ['reviewing', 'completed'].includes(String(value.phase)) &&
    hasOnlyGenerationRole(value, null)
  )
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  return (
    isCharacterSetupNode(value) ||
    isCharacterTemplateNode(value) ||
    isActionFirstFrameNode(value) ||
    isActionGenerationMethodNode(value) ||
    isActionFullFrameNode(value) ||
    isReviewNode(value)
  )
}

function isAcyclicNodeGraph(nodes: readonly WorkflowNode[]): boolean {
  const nodeIds = new Set(nodes.map((node) => node.id))
  if (nodeIds.size !== nodes.length) return false
  if (
    nodes.some(
      (node) =>
        node.dependsOnNodeIds.includes(node.id) ||
        node.dependsOnNodeIds.some((dependencyId) => !nodeIds.has(dependencyId)),
    )
  ) {
    return false
  }

  const dependencies = new Map(nodes.map((node) => [node.id, node.dependsOnNodeIds]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(nodeId: string): boolean {
    if (visited.has(nodeId)) return true
    if (visiting.has(nodeId)) return false
    visiting.add(nodeId)
    for (const dependencyId of dependencies.get(nodeId) ?? []) {
      if (!visit(dependencyId)) return false
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return true
  }

  return nodes.every((node) => visit(node.id))
}

function isWorkflowNodeGraph(value: unknown): value is WorkflowNode[] {
  return Array.isArray(value) && value.every(isWorkflowNode) && isAcyclicNodeGraph(value)
}

function invalidResponse(data: unknown): never {
  throw new ApiError('后端 WorkflowRun 响应格式无效', {
    kind: 'invalid-response',
    data,
  })
}

function mapWorkflowRun(dto: WorkflowRunDto): WorkflowRun {
  if (
    !isRecord(dto) ||
    !Number.isSafeInteger(dto.id) ||
    dto.id <= 0 ||
    !Number.isSafeInteger(dto.project_id) ||
    dto.project_id <= 0 ||
    !isWorkflowNodeGraph(dto.nodes) ||
    !isMember(dto.status, WORKFLOW_RUN_STORAGE_STATUSES) ||
    !Number.isSafeInteger(dto.version) ||
    dto.version < 1
  ) {
    return invalidResponse(dto)
  }
  return {
    id: String(dto.id),
    projectId: String(dto.project_id),
    version: dto.version,
    storageStatus: dto.status,
    nodes: structuredClone(dto.nodes),
  }
}

function toBackendId(value: string, field: string): number {
  const parsed = Number(value)
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  throw new TypeError(`${field} 必须是正整数 ID`)
}

function getApiClient() {
  return createApiClient({ getAccessToken: getApiAccessToken })
}

/** 精确对应后端已公开的 CRUD 与项目内分页列表；不声明尚未提供的按 Character 查询。 */
export const workflowRunApis: WorkflowRunApis & Required<Pick<WorkflowRunApis, 'listByProject'>> = {
  async create(input) {
    return mapWorkflowRun(
      await getApiClient().request<WorkflowRunDto>('/workflow-runs', {
        method: 'POST',
        json: { project_id: toBackendId(input.projectId, 'projectId'), nodes: input.nodes },
      }),
    )
  },
  async listByProject(projectId, query = {}) {
    const result = await getApiClient().requestList<WorkflowRunDto>('/workflow-runs', {
      query: {
        project_id: toBackendId(projectId, 'projectId'),
        page: query.page,
        page_size: query.pageSize,
      },
    })
    return { ...result, items: result.items.map(mapWorkflowRun) }
  },
  async get(id) {
    return mapWorkflowRun(
      await getApiClient().request<WorkflowRunDto>(`/workflow-runs/${encodeURIComponent(id)}`),
    )
  },
  async update(run) {
    try {
      return mapWorkflowRun(
        await getApiClient().request<WorkflowRunDto>(
          `/workflow-runs/${encodeURIComponent(run.id)}`,
          {
            method: 'PATCH',
            json: { nodes: run.nodes, status: run.storageStatus, version: run.version },
          },
        ),
      )
    } catch (cause) {
      if (cause instanceof ApiError && cause.kind === 'business' && cause.code === 409) {
        throw new WorkflowRunConflictError(cause.message, { cause })
      }
      throw cause
    }
  },
  async remove(id) {
    await getApiClient().request<null>(`/workflow-runs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
}
