import type { WorkflowRevision, WorkflowRun } from './types'

/**
 * 异步任务契约，与 WorkflowRun 节点是两回事。
 *
 * 任务粒度 = 一次耗时较久的大模型调用：生成母版、生成一个动作（含 8 帧，算 1 个
 * 任务而非 1+8）、重生成某一帧，各是一个任务。一个 workflow 关联多个任务，
 * 任务进度不等于工作流节点本身，所以进度回调给的是 TaskEvent。
 *
 * 下面只是事件形状的候选，**传输协议尚未与后端确定**，四项缺口：
 * SSE 端点路径、事件名与分帧格式、`result` 的具体结构、断线重连与补发策略。
 * 协议定下来之前 subscribeTask 不可调用，见其函数注释。
 */
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** 创建、查询和断线恢复都使用的完整任务快照。 */
export interface Task {
  id: string
  runId: WorkflowRun['id']
  revisionId: WorkflowRevision['id']
  status: TaskStatus
  /** 0–100。后端给不出就是 null，界面显示不确定进度。 */
  progress: number | null
  /** 失败原因，status 为 failed 时有值。 */
  error: string | null
  /**
   * 任务产出（如生成出的图 URL）。
   * 保持 unknown 而不是先猜一个形状：猜错会让调用方写出依赖假结构的代码。
   */
  result: unknown
}

/** SSE 每条事件携带完整状态，taskId 对应 Task.id。 */
export interface TaskEvent extends Omit<Task, 'id'> {
  taskId: Task['id']
}
