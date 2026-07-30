/**
 * WorkflowRun 业务资源的服务端持久化接口。
 *
 * 后端负责创建、读取和保存完整业务资源；“下一步是什么”和“重启后清理哪些步骤”
 * 仍由前端 WorkflowController 决定。这里不提供 Controller 的替代实现。
 */
import type { CreateWorkflowRunInput, WorkflowRun } from './types'

/** WorkflowRun 持久化对应的服务端 API，不包含步骤推进规则。 */
export interface WorkflowRunAPIs {
  /** 创建并由后端分配稳定 ID 的 WorkflowRun。 */
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  /** 按运行 ID 读取包含 Revision 和 Step 的完整资源。 */
  get(runId: WorkflowRun['id']): Promise<WorkflowRun>
  /** 提交前端 Controller 已推进后的完整 WorkflowRun 状态。 */
  update(run: WorkflowRun): Promise<WorkflowRun>
}
