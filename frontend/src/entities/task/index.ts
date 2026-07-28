/**
 * 异步任务实体，与 WorkflowRun 的页面节点是两回事。
 *
 * 任务粒度 = 一次耗时较久的后端能力调用。任务进度不等于工作流节点进度，
 * WorkflowRun 只通过单独的 WorkflowTaskLink 记录两者关系。
 */

/** 后端异步任务的候选状态集合；最终取值以后端契约为准。 */
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** 创建、查询和断线恢复都使用的完整任务快照。 */
export interface Task {
  /** 后端生成的任务 ID，是查询状态和订阅事件的唯一标识。 */
  id: string
  /** 后端任务当前状态；它不会直接改变 WorkflowNodeStatus。 */
  status: TaskStatus
  /** 0–100。后端给不出就是 null，界面显示不确定进度。 */
  progress: number | null
  /** 失败原因，status 为 failed 时有值。 */
  error: string | null
  /** 任务产出；契约冻结前保持 unknown，避免调用方依赖猜测结构。 */
  result: unknown
}

/** SSE 每条事件携带完整状态，taskId 对应 Task.id。 */
export interface TaskEvent extends Omit<Task, 'id'> {
  /** 发生变化的后端任务 ID。 */
  taskId: Task['id']
}

/**
 * 任务流协议尚未冻结，调用会明确失败而不是伪造进度。
 * 待确定 SSE 端点、事件格式、result 形状和断线恢复策略后再提供实现。
 */
export function subscribeTask(
  _taskId: Task['id'],
  _onEvent: (event: TaskEvent) => void,
): () => void {
  throw new Error('subscribeTask 的 SSE 协议尚未与后端确定，暂不可调用')
}
