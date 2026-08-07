import { ApiError, createApiClient, getApiAccessToken } from '@/shared/api'
import type {
  ActionWorkflowNode,
  CharacterWorkflowNode,
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
    !isNullableString(value.error)
  ) {
    return false
  }
  return value.status === 'failed'
    ? typeof value.error === 'string' && value.error.trim().length > 0
    : value.error === null
}

function isCharacterNode(value: unknown): value is CharacterWorkflowNode {
  if (!isRecord(value) || value.type !== 'character' || !hasValidCommonNodeFields(value)) {
    return false
  }
  if (
    ![
      'configuring_character',
      'generating_character_candidates',
      'selecting_character',
      'completed',
    ].includes(String(value.phase)) ||
    !isRecord(value.input)
  ) {
    return false
  }
  return (
    typeof value.input.prompt === 'string' &&
    Array.isArray(value.input.referenceMedia) &&
    value.input.referenceMedia.every((item) => typeof item === 'string') &&
    isNullableString(value.selectedImageUrl) &&
    (value.phase !== 'completed' ||
      (typeof value.selectedImageUrl === 'string' && value.selectedImageUrl.length > 0))
  )
}

function isActionNode(value: unknown): value is ActionWorkflowNode {
  if (!isRecord(value) || value.type !== 'action' || !hasValidCommonNodeFields(value)) return false
  if (
    ![
      'configuring_action',
      'generating_action_candidates',
      'selecting_action_frame',
      'generating_animation',
      'reviewing_animation',
      'completed',
    ].includes(String(value.phase)) ||
    !isRecord(value.input)
  ) {
    return false
  }
  return (
    typeof value.input.outfitId === 'string' &&
    value.input.outfitId.length > 0 &&
    typeof value.input.name === 'string' &&
    value.input.name.length > 0 &&
    typeof value.input.type === 'string' &&
    value.input.type.length > 0 &&
    isNullableString(value.input.prompt) &&
    typeof value.input.fps === 'number' &&
    Number.isFinite(value.input.fps) &&
    value.input.fps > 0 &&
    isNullableString(value.selectedFirstFrameUrl) &&
    (value.phase !== 'completed' ||
      (typeof value.selectedFirstFrameUrl === 'string' && value.selectedFirstFrameUrl.length > 0))
  )
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  return isCharacterNode(value) || isActionNode(value)
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

/** 精确对应后端已公开的 CRUD；不声明尚未提供的列表或按 Character 查询。 */
export const workflowRunApis: WorkflowRunApis = {
  async create(input) {
    return mapWorkflowRun(
      await getApiClient().request<WorkflowRunDto>('/workflow-runs', {
        method: 'POST',
        json: { project_id: toBackendId(input.projectId, 'projectId'), nodes: input.nodes },
      }),
    )
  },
  async get(id) {
    return mapWorkflowRun(
      await getApiClient().request<WorkflowRunDto>(`/workflow-runs/${encodeURIComponent(id)}`),
    )
  },
  async update(run) {
    return mapWorkflowRun(
      await getApiClient().request<WorkflowRunDto>(`/workflow-runs/${encodeURIComponent(run.id)}`, {
        method: 'PATCH',
        json: { nodes: run.nodes, status: run.storageStatus },
      }),
    )
  },
  async remove(id) {
    await getApiClient().request<null>(`/workflow-runs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
}
