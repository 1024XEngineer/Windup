import type { CreateWorkflowRunInput, WorkflowRun } from './types'

/** 页面可使用的只读流程端口。 */
export interface WorkflowRunReader {
  /** 按运行 ID 读取流程；不存在时返回 null。 */
  get(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
}

/** WorkflowRun 的完整异步存取契约；只在 app 装配和 Application 用例内部使用。 */
export interface WorkflowRunRepository extends WorkflowRunReader {
  /** 创建新的前端流程。 */
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  /** 保存已经由上层用例完成合法状态转换的流程快照。 */
  save(run: WorkflowRun): Promise<void>
}
