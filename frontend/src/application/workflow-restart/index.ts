import type { WorkflowNode, WorkflowRun } from '@/entities'

/** 从已存在节点重新开始时的输入契约。 */
export interface RestartWorkflowNodeInput {
  run: WorkflowRun
  sourceRevisionId: string
  node: WorkflowNode
}

/**
 * 只负责基于历史节点创建新的执行线。
 * 在途 attempt 必须先由 ProductionEnginePort 使其失效并尽力请求后端取消；
 * 从 interrupted 历史重启成功后，新执行线可使 WorkflowRun 回到 active，旧 Revision 仍保留。
 * 流程快照的保存由该用例内部协调 Repository。
 */
export interface WorkflowRestartPort {
  restart(input: RestartWorkflowNodeInput): Promise<WorkflowRun>
}
