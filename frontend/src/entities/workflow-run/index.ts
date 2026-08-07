import type {
  Generation,
  CharacterImageGenerationInput,
  CharacterImageOutput,
  CharacterActionGenerationInput,
  CharacterActionOutput,
} from '../generation'
import type { MediaReference } from '../media'
import {
  EXPORT_STATUSES,
  GENERATION_STATUSES,
  WORKFLOW_PURPOSES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_NODE_ORDER,
  WORKFLOW_NODE_STATUSES,
} from './constants'

export { WORKFLOW_NODE_ORDER } from './constants'

/** 创建 WorkflowRun 时要完成的用户意图。 */
export type WorkflowRunPurpose = (typeof WORKFLOW_PURPOSES)[number]

/** 前端流程节点类型，与 WORKFLOW_NODE_ORDER 的成员保持一致。 */
export type WorkflowNodeType = (typeof WORKFLOW_NODE_ORDER)[number]

/**
 * 节点的可用性和执行结果；不直接复用后端任务状态。
 * locked/available 表示尚未执行，active 表示当前页面阶段，passed/failed 表示结果。
 */
export type WorkflowNodeStatus = (typeof WORKFLOW_NODE_STATUSES)[number]

/**
 * 整次流程的汇总状态。
 * interrupted 只表示用户主动停止自动推进，不等于 failed 或 completed。
 */
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number]

/** 生成阶段的汇总状态；素材准备期间为 not_started。 */
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]

/** 导出阶段的汇总状态。 */
export type ExportStatus = (typeof EXPORT_STATUSES)[number]

interface WorkflowNodeBase {
  /** 只用于编排和页面定位，不作为业务 ID 发送给后端。 */
  id: string
  status: WorkflowNodeStatus
  /**
   * 本节点已提交、结果尚未写回 output 的生成任务 ID；没有在途任务时为 null。
   * 任务本身不认识节点，反向关联不存在。
   */
  taskId: Generation['id'] | null
  /**
   * 前端开始提交、但后端 taskId 尚未返回时的本地尝试标识。
   * 它非 null 而 taskId 为 null 时不能重复提交。
   */
  submissionId: string | null
  /** 节点失败后供页面解释原因；未失败时必须为 null。 */
  error: string | null
}

/** 角色资料节点保存的输入；参考媒体为空表示仅使用文字描述。 */
export interface CharacterSetupNodeInput {
  description: string
  referenceMedia: readonly MediaReference[]
}

export interface CharacterSetupWorkflowNode extends WorkflowNodeBase {
  type: 'character-setup'
  input: CharacterSetupNodeInput | null
  output: null
}

export interface CharacterTemplateWorkflowNode extends WorkflowNodeBase {
  type: 'character-template'
  /** 发起任务前为 null；提交时保存实际发送给 GenerationApis 的输入快照。 */
  input: CharacterImageGenerationInput | null
  output: CharacterImageOutput | null
}

/** 首帧生成节点：生成单帧角色动作候选。 */
export interface ActionFirstFrameWorkflowNode extends WorkflowNodeBase {
  type: 'action-first-frame'
  input: CharacterActionGenerationInput | null
  output: CharacterActionOutput | null
}

/** 完整帧率生成节点：基于首帧生成完整动画。 */
export interface ActionFullFrameWorkflowNode extends WorkflowNodeBase {
  type: 'action-full-frame'
  input: CharacterActionGenerationInput | null
  output: CharacterActionOutput | null
}

type RemainingWorkflowNodeType = Exclude<
  WorkflowNodeType,
  'character-setup' | 'character-template' | 'action-first-frame' | 'action-full-frame'
>

interface RemainingWorkflowNode extends WorkflowNodeBase {
  type: RemainingWorkflowNodeType
  /** 审核的具体输入输出在对应纵切中继续收窄。 */
  input: unknown
  output: unknown
}

/**
 * 执行线中的流程节点。
 * 前四个执行节点已冻结输入输出；后续进入对应纵切时再收窄。
 */
export type WorkflowNode =
  | CharacterSetupWorkflowNode
  | CharacterTemplateWorkflowNode
  | ActionFirstFrameWorkflowNode
  | ActionFullFrameWorkflowNode
  | RemainingWorkflowNode

/**
 * 一次由前端推进的页面流程。
 *
 * 后端采用树状纯存储模型，不提供回退或版本历史能力。用户从旧节点重做时，
 * 前端直接覆盖当前节点结果，不保留被废弃结果的历史链路。
 * 一个 Character 复用同一条 Run；新增动作不会创建第二条 Run。
 */
export interface WorkflowRun {
  id: string
  projectId: string
  /** 已关联的 Character ID；角色尚未创建或确认时为 null。 */
  characterId: string | null
  /** 已有角色加动作时的目标造型；新建角色时为 null。 */
  outfitId: string | null
  /** 建立这条 Run 时的根意图；后续追加动作不会把 create_character 改写为 add_action。 */
  purpose: WorkflowRunPurpose
  status: WorkflowRunStatus
  /**
   * 当前执行线中的节点。前三个节点串行推进，之后可随时追加 action-generation / review
   * 成对节点。多个 action-generation 可并发——互不阻塞。数组位置是节点顺序的唯一来源。
   */
  nodes: WorkflowNode[]
  generationStatus: GenerationStatus
  exportStatus: ExportStatus
  /** Quick Start 的规范化提示词；空白输入或手动模式无提示词时为 null。 */
  prompt: string | null
  createdAt: string
}

/**
 * @deprecated WorkflowRevision 已合并到 WorkflowRun，直接用 WorkflowRun。
 */
export type WorkflowRevision = WorkflowRun

/** 创建 WorkflowRun 的共享字段。 */
interface CreateWorkflowRunInputBase {
  projectId: string
  /** Quick Start 的自然语言需求；提交时去除首尾空白，空字符串按 null 保存。 */
  prompt?: string
}

/**
 * 创建 WorkflowRun 的输入。
 * add_action 分支把已有角色、造型、母版和基准帧设为必填。
 */
export type CreateWorkflowRunInput = CreateWorkflowRunInputBase &
  (
    | {
        purpose: 'create_character'
        characterId?: never
        outfitId?: never
        characterTemplateUrl?: never
        baseFrameUrls?: never
      }
    | {
        purpose: 'add_action'
        characterId: string
        outfitId: string
        characterTemplateUrl: string
        baseFrameUrls: readonly string[]
      }
  )

export { createWorkflowRunStore } from './store'
export type { CreateWorkflowRunStoreOptions, WorkflowRunStore } from './store'
