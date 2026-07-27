/**
 * 一次工作流的运行数据，后端持久化，这份是投影。
 * 两个入口共用同一份数据，只差一个 driver 字段。
 */

/** UI 文案叫「AI 快捷创作」「节点工作流」，代码里用这两个词。 */
export type WorkflowDriver = 'ai' | 'manual'

/** 会调生成能力的步骤在后端对应一个 generation 任务。 */
export type WorkflowStepType =
  | 'generate-template'
  | 'confirm-template'
  | 'add-action'
  | 'generate-action'
  | 'review'

export type WorkflowStepStatus = 'pending' | 'running' | 'done' | 'failed'

export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  status: WorkflowStepStatus
  /** 添加/生成动作时有值。 */
  actionId: number | null
  /** 异步任务 id，前端用 SSE 取结果。 */
  taskId: string | null
}

export type WorkflowRunStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed'

export interface WorkflowRun {
  id: string
  projectId: number
  /** 建出角色前为 null。 */
  characterId: number | null
  driver: WorkflowDriver
  status: WorkflowRunStatus
  currentStepId: string | null
  steps: WorkflowStep[]
}

export interface CreateWorkflowRunInput {
  projectId: number
  driver: WorkflowDriver
  /** AI 驱动时用户输入的那句话。 */
  prompt?: string
}

/** 工作流上可以发生的事，不区分是用户点的还是 AI 推的。 */
export type WorkflowCommand =
  | { kind: 'generate-template'; description: string; referenceImageUrl?: string }
  | { kind: 'confirm-template' }
  | { kind: 'add-action'; name: string; source: 'preset' | 'custom' | 'template'; templateId?: number }
  | { kind: 'generate-action'; actionId: number }
  | { kind: 'reject-frame'; actionId: number; frameIndex: number }
  | { kind: 'finish' }

export type WorkflowCommandKind = WorkflowCommand['kind']

/** 退回一帧后要跳回编辑器的哪个位置。 */
export interface WorkflowLocation {
  runId: string
  stepId: string
  actionId: number
  frameIndex: number
}
