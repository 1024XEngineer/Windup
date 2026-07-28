import type { CreateWorkflowRunInput, WorkflowCommand, WorkflowRun } from './types'

/** WorkflowRun 是前端编排模型；仓库端口不表达 HTTP 或后端资源。 */
export interface WorkflowRunRepository {
  /** 创建并持久化一个新的前端流程。 */
  create(input: CreateWorkflowRunInput): WorkflowRun
  /** 按前端运行 ID 读取流程；不存在时返回 null。 */
  get(runId: WorkflowRun['id']): WorkflowRun | null
  /** 校验并应用本地编排命令，然后返回更新后的完整流程。 */
  submit(runId: WorkflowRun['id'], command: WorkflowCommand): WorkflowRun
}
