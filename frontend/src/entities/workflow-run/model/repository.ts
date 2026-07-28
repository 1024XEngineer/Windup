import type { CreateWorkflowRunInput, WorkflowCommand, WorkflowRun } from './types'

/** WorkflowRun 是前端编排模型；仓库端口不表达 HTTP 或后端资源。 */
export interface WorkflowRunRepository {
  create(input: CreateWorkflowRunInput): WorkflowRun
  get(runId: WorkflowRun['id']): WorkflowRun | null
  submit(runId: WorkflowRun['id'], command: WorkflowCommand): WorkflowRun
}
