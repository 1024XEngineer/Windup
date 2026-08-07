import type { ActionType } from '../character'
import type { Generation } from '../generation'
import type { MediaReference } from '../media'
import {
  WORKFLOW_GENERATION_ROLES,
  WORKFLOW_NODE_PHASES,
  WORKFLOW_NODE_STATUSES,
  WORKFLOW_NODE_TYPES,
  WORKFLOW_RUN_STORAGE_STATUSES,
} from './constants'

export type WorkflowRunStorageStatus = (typeof WORKFLOW_RUN_STORAGE_STATUSES)[number]
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number]
export type WorkflowNodeStatus = (typeof WORKFLOW_NODE_STATUSES)[number]
export type WorkflowNodePhase = (typeof WORKFLOW_NODE_PHASES)[number]
export type WorkflowGenerationRole = (typeof WORKFLOW_GENERATION_ROLES)[number]

/** 一个节点对后端 GenerationTask 的引用；节点可关联零个、一个或多个任务。 */
export interface WorkflowGenerationRef {
  taskId: Generation['id']
  role: WorkflowGenerationRole
}

interface WorkflowNodeBase {
  id: string
  type: WorkflowNodeType
  status: WorkflowNodeStatus
  phase: WorkflowNodePhase
  /**
   * 本节点的直接前置节点 ID。空数组表示图的入口；多个 ID 表示汇合依赖。
   * 边随节点一起存入后端 nodes JSON，不能再用数组位置猜测连线。
   */
  dependsOnNodeIds: string[]
  generations: WorkflowGenerationRef[]
  error: string | null
}

export interface WorkflowCharacterInput {
  prompt: string
  referenceMedia: readonly MediaReference[]
}

/** 角色节点内部完成资料填写、候选图生成和候选确认。 */
export interface CharacterWorkflowNode extends WorkflowNodeBase {
  type: 'character'
  input: WorkflowCharacterInput
  selectedImageUrl: string | null
}

export interface WorkflowActionInput {
  outfitId: string
  name: string
  type: ActionType
  prompt: string | null
  fps: number
}

/** 一个 Action 对应一个节点；共同依赖同一节点的多个 Action 可以并行。 */
export interface ActionWorkflowNode extends WorkflowNodeBase {
  type: 'action'
  input: WorkflowActionInput
  selectedFirstFrameUrl: string | null
}

/** 工作流图中的真实节点。前端和后端统一使用 node，不再保留 step 或假 root。 */
export type WorkflowNode = CharacterWorkflowNode | ActionWorkflowNode

/**
 * 一次制作流程的持久化容器。Quick Start 与 Workflow Editor 只是不同界面；
 * 两者读取和推进同一份节点图。
 */
export interface WorkflowRun {
  id: string
  projectId: string
  /** 后端乐观版本号，每次 PATCH 后使用响应中的新值。 */
  version: number
  /** 后端资源状态，仅表示正常或软删除。 */
  storageStatus: WorkflowRunStorageStatus
  /** 真实节点图；节点间的边由 dependsOnNodeIds 表达。 */
  nodes: WorkflowNode[]
}

export interface CreateWorkflowRunInput {
  projectId: string
  nodes: WorkflowNode[]
}

export interface WorkflowRunApis {
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  get(id: WorkflowRun['id']): Promise<WorkflowRun>
  update(run: WorkflowRun): Promise<WorkflowRun>
  remove(id: WorkflowRun['id']): Promise<void>
}

export { workflowRunApis } from './api'
