import type {
  CharacterTemplateGenerationInput,
  CharacterTemplateGenerationResult,
} from '../generation'
import type { MediaReference } from '../media'
import type { Task } from '../task'
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

export { WORKFLOW_STEP_ORDER } from './constants'

/** Quick Start 与手动工作流只改变输入方式，共用同一种运行模型。 */
export type WorkflowDriver = (typeof WORKFLOW_DRIVERS)[number]

/** 创建 WorkflowRun 时要完成的用户意图。 */
export type WorkflowRunPurpose = (typeof WORKFLOW_PURPOSES)[number]

/**
 * 流程步骤类型的唯一标准顺序；它不是后端 Workflow 或 Execution 定义。
 * 某个 Revision 已进入执行线的步骤顺序，由 WorkflowRevision.steps 的数组位置表达。
 */
/** 前端流程步骤类型，与 WORKFLOW_STEP_ORDER 的成员保持一致。 */
export type WorkflowStepType = (typeof WORKFLOW_STEP_ORDER)[number]

/**
 * 步骤的可用性和执行结果；不直接复用后端任务状态。
 * locked/available 表示尚未执行，active 表示当前页面阶段，passed/failed 表示结果。
 */
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number]

/**
 * 单个版本的生命周期。
 * abandoned 表示停止沿用但仍保留为历史。
 */
export type WorkflowRevisionStatus = (typeof WORKFLOW_REVISION_STATUSES)[number]

/**
 * 整次流程的汇总状态。
 * interrupted 只表示用户主动停止自动推进：历史仍保留且可只读查看，它不等于 failed 或 completed。
 * 后端 Task 是否真正停止是独立问题；当前纵切不提供重启操作。
 */
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number]

/** 当前版本在生成阶段的汇总状态；素材准备期间为 not_started。 */
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]

/** 当前版本在导出阶段的汇总状态。 */
export type ExportStatus = (typeof EXPORT_STATUSES)[number]

interface WorkflowStepBase {
  /** 只用于编排和页面定位，不作为业务 ID 发送给后端。 */
  id: string
  status: WorkflowStepStatus
  /**
   * 本步骤已提交、结果尚未写回 output 的生成任务 ID；没有在途任务时为 null。
   * 它由前端随 WorkflowRun 一起维护，据此查回在途任务的状态，因而不会在同一次
   * 前端运行中重复发起生成。是否写入浏览器存储属于前端实现，不形成后端契约。
   * 任务本身不认识步骤，反向关联不存在。
   */
  taskId: Task['id'] | null
  /**
   * 前端开始提交、但后端 taskId 尚未返回时的本地尝试标识。
   * 它非 null 而 taskId 为 null 时不能重复提交；若页面在这个窗口刷新，
   * Controller 会把本地 Run 标为失败。它不是后端字段，也不冒充幂等键。
   */
  submissionId: string | null
  /** 步骤失败后供页面解释原因；未失败时必须为 null。 */
  error: string | null
  /** 该步骤沿用或依赖的步骤 ID，用于版本来源追踪，不代表后端执行依赖。 */
  referenceStepIds: string[]
}

/** 角色资料步骤保存的输入；参考媒体为空表示仅使用文字描述。 */
export interface CharacterSetupStepInput {
  description: string
  referenceMedia: readonly MediaReference[]
}

export interface CharacterSetupWorkflowStep extends WorkflowStepBase {
  type: 'character-setup'
  input: CharacterSetupStepInput | null
  output: null
}

export interface CharacterTemplateWorkflowStep extends WorkflowStepBase {
  type: 'character-template'
  /** 发起任务前为 null；提交时保存实际发送给 GenerationApis 的输入快照。 */
  input: CharacterTemplateGenerationInput | null
  output: CharacterTemplateGenerationResult | null
}

type RemainingWorkflowStepType = Exclude<WorkflowStepType, 'character-setup' | 'character-template'>

interface RemainingWorkflowStep extends WorkflowStepBase {
  type: RemainingWorkflowStepType
  /** 候选选择及后五步尚未实现，输入输出等对应纵切开始时再收窄。 */
  input: unknown
  output: unknown
}

/**
 * 一个 Revision 中已经进入执行线的流程步骤。
 * 前两个执行步骤已冻结输入输出；候选选择及后五步进入对应纵切时再收窄，
 * 不提前猜页面尚未产生的数据形状。
 */
export type WorkflowStep =
  | CharacterSetupWorkflowStep
  | CharacterTemplateWorkflowStep
  | RemainingWorkflowStep

/**
 * 一次页面执行版本；当前版本会推进，从旧步骤重开则追加新版本。
 *
 * 当前本地存储版本只接受单条执行线：revisions 恒为一个成员，
 * basedOnRevisionId 与 restartStepId 恒为 null。「从历史步骤重开并保留旧版本」
 * 尚未进入产品定义；实现时需要同步升级存储版本和迁移规则。
 */
export interface WorkflowRevision {
  id: string
  /** 首次创建的版本没有来源，因此为 null。 */
  basedOnRevisionId: string | null
  /** 在来源版本中选择的重启步骤 ID；非重启创建的版本为 null。 */
  restartStepId: string | null
  status: WorkflowRevisionStatus
  /**
   * 当前版本固定保存全部八步；数组位置是步骤顺序的唯一来源。
   * 完整步骤类型顺序以 WORKFLOW_STEP_ORDER 为准。
   */
  steps: WorkflowStep[]
  generationStatus: GenerationStatus
  exportStatus: ExportStatus
  createdAt: string
}

/**
 * 一次由前端推进的页面流程。
 * 步骤推进和运行状态都由前端管理；后端不读取、不推进、也不持久化 WorkflowRun。
 * 后端只处理生成任务，并在用户最终确认时持久化角色与动作资产。
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

export { createWorkflowRunStore } from './store'
export type { CreateWorkflowRunStoreOptions, WorkflowRunStore } from './store'
