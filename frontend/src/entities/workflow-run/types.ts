/**
 * WorkflowRun、Revision 与 Step 的共享数据合同。
 *
 * Quick Start 和 Workflow Editor 使用同一种流程数据，只在交互展示和驱动方式上
 * 不同。前端负责节点推进规则，后端负责持久化；本文件只描述数据，不实现状态机。
 */
/** Quick Start 与手动编辑器共享数据模型，只改变交互方式。 */
export type WorkflowDriver = 'ai' | 'manual'
/** WorkflowRun 本次要完成的顶层业务目标。 */
export type WorkflowRunPurpose = 'create_character' | 'add_action'

/** 当前确认的页面步骤；数组位置表达实际执行顺序。 */
export type WorkflowStepType =
  | 'character_setup'
  | 'character_template'
  | 'character_template_selection'
  | 'action_setup'
  | 'first_frame'
  | 'complete_animation'
  | 'review'
  | 'export'

export type WorkflowStepStatus = 'locked' | 'active' | 'completed' | 'failed'
/** Revision 的生命周期；重启产生新 Revision 后旧分支可以标记 abandoned。 */
export type WorkflowRevisionStatus = 'active' | 'completed' | 'failed' | 'abandoned'
/** 整条 WorkflowRun 的可见状态；interrupted 表示自动流程已被用户中断。 */
export type WorkflowRunStatus = 'active' | 'interrupted' | 'completed' | 'failed'

/** Workflow Controller 操作的最小步骤数据。 */
export interface WorkflowStep {
  /** Step 的稳定标识，用于更新和从指定步骤重启。 */
  id: string
  /** Step 的业务种类，不直接等同于后端 Task 类型。 */
  type: WorkflowStepType
  /** 当前 Revision 中该 Step 的执行状态。 */
  status: WorkflowStepStatus
  /** 进入步骤时保存的数据；具体业务类型由该步骤的调用方解释。 */
  data: unknown
}

/** 从历史步骤重新开始时追加 Revision，旧 Revision 保持只读。 */
export interface WorkflowRevision {
  /** Revision 自身标识。 */
  id: string
  /** 首个版本为 null；重启生成的新版本指向来源版本。 */
  basedOnRevisionId: WorkflowRevision['id'] | null
  /** 从哪个历史 Step 重启；非重启创建的版本为 null。 */
  restartStepId: WorkflowStep['id'] | null
  /** 指向唯一 active Step；Revision 已完成或失败且不可继续时为 null。 */
  currentStepId: WorkflowStep['id'] | null
  status: WorkflowRevisionStatus
  steps: WorkflowStep[]
  /** ISO 8601 创建时间。 */
  createdAt: string
}

/** 前端维护步骤状态，服务端负责持久化该业务资源。 */
export interface WorkflowRun {
  /** WorkflowRun 稳定业务标识。 */
  id: string
  /** 所有 WorkflowRun 都归属真实 Project，包括 Quick Start 自动创建的项目。 */
  projectId: string
  /** 创建角色早期允许为空；角色建立后写入。 */
  characterId: string | null
  /** 创建具体造型前允许为空；加动作流程必须提供。 */
  outfitId: string | null
  purpose: WorkflowRunPurpose
  driver: WorkflowDriver
  status: WorkflowRunStatus
  /** revisions 中当前可继续推进的版本标识。 */
  currentRevisionId: WorkflowRevision['id']
  /** 保留历史只读版本，支持回看和从历史步骤重新开始。 */
  revisions: WorkflowRevision[]
  /** Quick Start 的自然语言目标或手动流程补充说明。 */
  prompt: string | null
}

/** 创建不同 WorkflowRun 共同需要的字段。 */
interface CreateWorkflowRunInputBase {
  projectId: string
  driver: WorkflowDriver
  prompt?: string
}

/** 创建角色与给既有 Outfit 加动作两种入口的判别联合。 */
export type CreateWorkflowRunInput = CreateWorkflowRunInputBase &
  (
    | {
        purpose: 'create_character'
      }
    | {
        purpose: 'add_action'
        characterId: string
        outfitId: string
        characterTemplateUrl: string
        baseFrameUrls: readonly string[]
      }
  )
