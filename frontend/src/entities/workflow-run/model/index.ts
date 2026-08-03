/**
 * WorkflowRun 领域模型的子目录入口。
 *
 * 本目录只定义“WorkflowRun 是什么”：业务词汇、步骤模板、Run/Revision/Step
 * 类型以及创建输入。它不知道 localStorage、订阅者或页面，因此可被
 * Store、Controller 和页面共同依赖，而不产生反向依赖。
 */

export {
  ACTION_FIRST_FRAME_CANDIDATE_COUNT,
  CHARACTER_CANDIDATE_COUNT,
  WORKFLOW_STEP_ORDERS,
} from './constants'
export type {
  CreateWorkflowRunInput,
  ExportStatus,
  GenerationStatus,
  WorkflowDriver,
  WorkflowRevision,
  WorkflowRevisionStatus,
  WorkflowRun,
  WorkflowRunPurpose,
  WorkflowRunStatus,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowStepType,
} from './types'
