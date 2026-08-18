import type { ActionType } from '../character'
import type { Generation } from '../generation'
import type { MediaReference } from '../media'
import type { Paged, PageQuery } from '@/shared/pagination'
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

/** 动作资产的生产路线；3D 转 2D 接口尚未提供，但选择必须随 WorkflowRun 落库。 */
export type ActionGenerationMethod = 'video-cropping' | '3d-to-2d'

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
  /**
   * 已发布资产被用户删除的时间。节点仍保留生成输入、任务引用与审核历史；
   * 旧数据没有该字段时视为未删除。
   */
  deletedAt?: string | null
}

export interface WorkflowCharacterInput {
  /** 用户填写或后端提取的最终角色名称；旧数据可以没有该字段。 */
  name?: string | null
  /**
   * 当前节点图所属的 Character。后端只原样持久化 nodes，因此前端用它在项目列表中定位角色的唯一 Run。
   * 旧 Run 可能没有该字段；读取方必须兼容未绑定状态。
   */
  characterId?: string | null
  prompt: string
  referenceMedia: readonly MediaReference[]
}

/** 角色资料卡片；只保存用户输入，不承担图片生成。 */
export interface CharacterSetupWorkflowNode extends WorkflowNodeBase {
  type: 'character-setup'
  phase: 'configuring' | 'completed'
  input: WorkflowCharacterInput
}

/** 角色母版卡片；生成候选图并保存用户最终确认的母版。 */
export interface CharacterTemplateWorkflowNode extends WorkflowNodeBase {
  type: 'character-template'
  phase: 'ready' | 'generating' | 'selecting' | 'completed'
  selectedImageUrl: string | null
}

export interface WorkflowActionInput {
  outfitId: string
  name: string
  type: ActionType
  prompt: string | null
  fps: number
}

/** Action 的首帧卡片；每个 Action 都必须有一份独立输入和确认结果。 */
export interface ActionFirstFrameWorkflowNode extends WorkflowNodeBase {
  type: 'action-first-frame'
  phase: 'configuring' | 'generating' | 'selecting' | 'completed'
  input: WorkflowActionInput
  selectedFirstFrameUrl: string | null
}

/** 首帧确认后选择完整动画的生产路线。 */
export interface ActionGenerationMethodWorkflowNode extends WorkflowNodeBase {
  type: 'action-generation-method'
  phase: 'selecting' | 'completed'
  method: ActionGenerationMethod | null
}

/** 基于已确认首帧生成完整动画。 */
export interface ActionFullFrameWorkflowNode extends WorkflowNodeBase {
  type: 'action-full-frame'
  phase: 'ready' | 'generating' | 'completed'
}

/** 只负责核验完整动画；审核通过不等于下载或导出。 */
export interface ReviewWorkflowNode extends WorkflowNodeBase {
  type: 'review'
  phase: 'reviewing' | 'completed'
}

/** 工作流图中的真实节点。前端和后端统一使用 node，不再保留 step 或假 root。 */
export type WorkflowNode =
  | CharacterSetupWorkflowNode
  | CharacterTemplateWorkflowNode
  | ActionFirstFrameWorkflowNode
  | ActionGenerationMethodWorkflowNode
  | ActionFullFrameWorkflowNode
  | ReviewWorkflowNode

/**
 * 一次制作流程的持久化容器。Quick Start 与 Workflow Editor 只是不同界面；
 * 两者读取和推进同一份节点图。
 */
export interface WorkflowRun {
  id: string
  projectId: string
  /** 后端乐观锁版本；更新时原样回传，保存成功后使用响应中的新版本。 */
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
  /** 后端只返回未软删除的运行记录。 */
  listByProject?(projectId: string, query?: PageQuery): Promise<Paged<WorkflowRun>>
  get(id: WorkflowRun['id']): Promise<WorkflowRun>
  update(run: WorkflowRun): Promise<WorkflowRun>
  remove(id: WorkflowRun['id']): Promise<void>
}

export { WorkflowRunConflictError, workflowRunApis } from './api'
