import type { Task } from '../task'

/** Quick Start 与手动工作流只改变输入方式，共用同一种运行模型。 */
export type WorkflowDriver = 'ai' | 'manual'

/** 创建 WorkflowRun 时要完成的用户意图。 */
export type WorkflowRunPurpose = 'create_character' | 'add_action'

/**
 * 流程步骤类型的唯一标准顺序；它不是后端 Workflow 或 Execution 定义。
 * 某个 Revision 已进入执行线的步骤顺序，由 WorkflowRevision.nodes 的数组位置表达。
 */
export const WORKFLOW_STEP_ORDER = [
  'character-setup',
  'character-template',
  'template-candidate',
  'action-setup',
  'first-frame',
  'complete-animation',
  'review',
  'export',
] as const

/** 前端流程步骤类型，与 WORKFLOW_STEP_ORDER 的成员保持一致。 */
export type WorkflowStepType = (typeof WORKFLOW_STEP_ORDER)[number]

/**
 * 步骤的可用性和执行结果；不直接复用后端任务状态。
 * locked/available 表示尚未执行，active 表示当前页面阶段，passed/failed 表示结果。
 */
export type WorkflowStepStatus = 'locked' | 'available' | 'active' | 'passed' | 'failed'

/**
 * 单个版本的生命周期。
 * abandoned 表示停止沿用但仍保留为历史。
 */
export type WorkflowRevisionStatus = 'active' | 'completed' | 'failed' | 'abandoned'

/**
 * 整次流程的汇总状态。
 * interrupted 只表示用户主动停止自动推进：历史仍保留且可只读查看，它不等于 failed 或 completed。
 * 后端 Task 是否真正停止是独立问题；从历史重启成功后可重新进入 active。
 */
export type WorkflowRunStatus = 'active' | 'interrupted' | 'completed' | 'failed'

/** 当前版本在生成阶段的汇总状态；素材准备期间为 not_started。 */
export type GenerationStatus = 'not_started' | 'in_progress' | 'completed' | 'failed'

/** 当前版本在导出阶段的汇总状态。 */
export type ExportStatus = 'not_exported' | 'exporting' | 'exported' | 'failed'

/**
 * 一个 Revision 中已经进入执行线的流程步骤。
 * 步骤自身不重复保存顺序；其在 nodes 中的数组位置就是该版本的执行顺序。
 */
export interface WorkflowStep {
  /** 只用于编排和页面定位，不作为业务 ID 发送给后端。 */
  id: string
  type: WorkflowStepType
  status: WorkflowStepStatus
  /** 进入步骤时保存的输入快照。 */
  input: unknown
  /** 步骤完成后的结果或引用；尚无结果时为 null。 */
  output: unknown
  /**
   * 本步骤已提交、结果尚未写回 output 的生成任务 ID；没有在途任务时为 null。
   * 它随 WorkflowRun 一起持久化，页面重开后据此查回在途任务的状态，
   * 因而不会重复发起同一次生成。任务本身不认识步骤，反向关联不存在。
   */
  taskId: Task['id'] | null
  /** 该步骤沿用或依赖的步骤 ID，用于版本来源追踪，不代表后端执行依赖。 */
  referenceStepIds: string[]
}

/** 一次页面执行版本；当前版本会推进，从旧步骤重开则追加新版本。 */
export interface WorkflowRevision {
  id: string
  /** 首次创建的版本没有来源，因此为 null。 */
  basedOnRevisionId: string | null
  /** 在来源版本中选择的重启步骤 ID；非重启创建的版本为 null。 */
  restartStepId: string | null
  status: WorkflowRevisionStatus
  /**
   * 已进入当前执行线的步骤；数组位置是该版本步骤顺序的唯一来源。
   * 尚未推进到的后续步骤可以不存在；完整步骤类型顺序以 WORKFLOW_STEP_ORDER 为准。
   */
  steps: WorkflowStep[]
  generationStatus: GenerationStatus
  exportStatus: ExportStatus
  createdAt: string
}

/**
 * 一次由前端推进的页面流程。
 * 步骤怎么走由前端决定；WorkflowRun 本身由后端持久化，前端通过 WorkflowRunApis 读写。
 */
export interface WorkflowRun {
  id: string
  projectId: string
  /** 已关联的 Character ID；角色尚未创建或确认时为 null。 */
  characterId: string | null
  /** 已有角色加动作时的目标造型；新建角色时为 null。 */
  outfitId: string | null
  purpose: WorkflowRunPurpose
  driver: WorkflowDriver
  status: WorkflowRunStatus
  /** 当前可编辑版本 ID；必须能在 revisions 中找到。 */
  currentRevisionId: string
  /** 按创建顺序保存的全部版本；历史版本保留用于只读查看和重启。 */
  revisions: WorkflowRevision[]
  /** Quick Start 的规范化提示词；空白输入或手动模式无提示词时为 null。 */
  prompt: string | null
}

/** 两种入口共享的创建字段。 */
interface CreateWorkflowRunInputBase {
  projectId: string
  driver: WorkflowDriver
  /** Quick Start 的自然语言需求；提交时去除首尾空白，空字符串按 null 保存。 */
  prompt?: string
}

/**
 * 创建 WorkflowRun 的输入。
 * add_action 分支把已有角色、造型、母版和基准帧设为必填，避免创建无法恢复的半成品运行。
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

/** WorkflowRun 对应的一组后端接口；只负责存取，不负责推进。 */
export interface WorkflowRunApis {
  get(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  /** 保存已由 WorkflowController 完成合法状态转换的流程快照。 */
  save(run: WorkflowRun): Promise<void>
}
