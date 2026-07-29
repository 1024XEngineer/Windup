/** Quick Start 的自然语言输入；具体参数规划由未来 Agent 实现。 */
export interface QuickStartRequest {
  prompt: string
  referenceImage?: File
}

/** Quick Start 启动后返回的最小身份信息。 */
export interface QuickStartSession {
  projectId: string
  runId: string
}

/** 会话页所需的只读状态；不向 Quick Start UI 暴露 Revision 或完整节点树。 */
export interface QuickStartSessionSnapshot extends QuickStartSession {
  status: WorkflowRunStatus
  currentStage: WorkflowNodeType | null
}

/** Quick Start 用例边界；页面不持有 Planner，Preview Mock 与生产 Adapter 均由 app 组合层注入。 */
export interface QuickStartPort {
  start(request: QuickStartRequest): Promise<QuickStartSession>
  /** 查询自动创作会话状态，供独立页面恢复、轮询和控制中断按钮。 */
  getSession(runId: QuickStartSession['runId']): Promise<QuickStartSessionSnapshot>
  /**
   * 中断调用后，前端必须立即停止 Agent 后续自动决策，并通过制作引擎使当前精确 attempt 失效。
   * 在途提交与已创建 Task 的远端取消只是尽力请求；迟到结果仍必须丢弃。
   * 未来用例还应将 WorkflowRun 记为 interrupted 并保留历史；它不等于 failed 或 completed。
   * 该边界不直接操作 Workflow 节点，也不承诺终止已运行的后端计算。
   */
  interrupt(runId: QuickStartSession['runId']): Promise<void>
}
import type { WorkflowNodeType, WorkflowRunStatus } from '@/entities'
