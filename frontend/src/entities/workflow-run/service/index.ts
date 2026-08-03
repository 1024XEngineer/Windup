/**
 * WorkflowRun 可执行用例的子目录入口。
 *
 * model 只定义数据，store 只管快照，service 负责组合真实 Character/Generation
 * 端口完成角色和动作任务。页面应调用这些用例，不自行改写 Run。
 */

export { createWorkflowRunService } from './workflow-run-service'
export type {
  ActionFirstFrameCandidateBatch,
  CharacterCandidateBatch,
  CharacterCandidateConfirmationApis,
  ConfirmCharacterSelectionInput,
  ConfirmActionFirstFrameInput,
  CreateWorkflowRunServiceOptions,
  PublishActionResult,
  StartActionRunInput,
  StartCharacterRunInput,
  WorkflowRunService,
} from './workflow-run-service'
