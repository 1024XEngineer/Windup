import type { Generation } from '../generation'
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

export type WorkflowDriver = (typeof WORKFLOW_DRIVERS)[number]
export type WorkflowRunPurpose = (typeof WORKFLOW_PURPOSES)[number]
export type WorkflowStepType = (typeof WORKFLOW_STEP_ORDER)[number]
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number]
export type WorkflowRevisionStatus = (typeof WORKFLOW_REVISION_STATUSES)[number]
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number]
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]
export type ExportStatus = (typeof EXPORT_STATUSES)[number]

/** 一次流程步骤的可恢复快照，不包含页面显示状态。 */
export interface WorkflowStep {
  /** 只用于前端编排和定位，不发送给后端。 */
  id: string
  type: WorkflowStepType
  status: WorkflowStepStatus
  input: unknown
  output: unknown
  /** 已提交但尚未写回结果的生成任务。 */
  taskId: Generation['id'] | null
  /** 请求已开始但后端任务 ID 尚未返回时的本地防重标识。 */
  submissionId: string | null
  /** 失败步骤必须提供原因，其他状态必须为 null。 */
  error: string | null
  /** 新版本沿用的历史步骤，用于解释版本来源。 */
  referenceStepIds: string[]
}

/** 一次可回看的流程版本。重开历史步骤时追加新版本，不覆盖旧版本。 */
export interface WorkflowRevision {
  id: string
  basedOnRevisionId: string | null
  restartStepId: string | null
  status: WorkflowRevisionStatus
  steps: WorkflowStep[]
  generationStatus: GenerationStatus
  exportStatus: ExportStatus
  createdAt: string
}

/** 一次前端创作流程，后端不读取、推进或持久化该结构。 */
export interface WorkflowRun {
  id: string
  projectId: string
  characterId: string | null
  outfitId: string | null
  purpose: WorkflowRunPurpose
  driver: WorkflowDriver
  status: WorkflowRunStatus
  /** 当前可继续编辑的版本，必须存在于 revisions 中。 */
  currentRevisionId: string
  /** 按创建时间排列；历史版本只读，重开时追加新版本。 */
  revisions: WorkflowRevision[]
  prompt: string | null
}

interface CreateWorkflowRunInputBase {
  projectId: string
  driver: WorkflowDriver
  prompt?: string
}

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
