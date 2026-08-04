/**
 * WorkflowController Feature 公开入口。
 *
 * pages 只从这里获取创作流程命令，不直接依赖 Controller 内部文件。
 */

export { createWorkflowController } from './controller'
export type {
  CreateWorkflowControllerOptions,
  WorkflowController,
  WorkflowControllerSnapshot,
} from './controller'
