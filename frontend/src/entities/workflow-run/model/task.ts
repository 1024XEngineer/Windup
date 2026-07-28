import type { WorkflowNode, WorkflowRevision, WorkflowRun } from './types'

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
/**
 * 后端异步任务的候选状态集合。
 * queued 等待执行，running 正在执行，succeeded/failed 是成功或失败终态；最终取值以后端契约为准。
 */
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
  /**
   * 任务产出（如生成出的图 URL）。
   * 保持 unknown 而不是先猜一个形状：猜错会让调用方写出依赖假结构的代码。
   */
  result: unknown
}

/** SSE 每条事件携带完整状态，taskId 对应 Task.id。 */
export interface TaskEvent extends Omit<Task, 'id'> {
  /** 发生变化的后端任务 ID。 */
  taskId: Task['id']
}

/** 前端编排关联；后端 Task 不需要认识 WorkflowRun、Revision 或页面节点。 */
export interface WorkflowTaskLink {
  /** 被关联的后端任务 ID。 */
  taskId: Task['id']
  /** 接收任务结果的前端 WorkflowRun ID。 */
  runId: WorkflowRun['id']
  /** 发起任务时所在的前端版本 ID，避免结果写入后来创建的新版本。 */
  revisionId: WorkflowRevision['id']
  /** 发起任务的前端节点 ID，用于把结果映射回正确页面阶段。 */
  nodeId: WorkflowNode['id']
}
