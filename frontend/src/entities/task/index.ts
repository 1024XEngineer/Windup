/**
 * 异步任务实体，与 WorkflowRun 的页面节点是两回事。
 *
 * 任务粒度 = 前端可见的一个异步步骤，而不是内部某次模型调用。
 * 任务生命周期不等于工作流节点状态，两者只由 WorkflowStep.taskId 单向关联：
 * 步骤记得自己发起过哪个任务，任务不认识步骤。
 */

/** 后端异步任务状态；pending 表示已提交但尚未执行。 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * MS2 前端需要展示和恢复的三类异步步骤。
 * 完整动画内部可包含视频生成、截帧和多次图像处理，但对前端仍是一个 Task。
 */
export type TaskType = 'character_template' | 'first_frame' | 'complete_animation'

/**
 * 创建、查询和断线恢复都使用的完整任务快照。
 * TType 在调用边界已知时保留精确任务类型；按 ID 恢复时使用默认值，等待运行时解析后再收窄。
 */
export interface Task<TType extends TaskType = TaskType> {
  /** 后端生成的任务 ID，是查询状态和订阅事件的唯一标识。 */
  id: string
  /** 后端 task_type 对应的领域判别字段，不接受任意字符串。 */
  type: TType
  /** 后端任务当前状态；它不会直接改变工作流节点状态。 */
  status: TaskStatus
  /** 失败原因，status 为 failed 时有值。completed 不表示工作流节点已通过。 */
  error: string | null
  /** 任务产出；契约冻结前保持 unknown，避免调用方依赖猜测结构。 */
  result: unknown
}

/** 每条事件携带同类型 Task 的完整状态，taskId 对应 Task.id。 */
export interface TaskEvent<TType extends TaskType = TaskType> extends Omit<Task<TType>, 'id'> {
  taskId: Task['id']
}

/** Task 对应的一组后端接口。服务端没有取消能力，因此这里不声明 cancel。 */
export interface TaskApis {
  /**
   * 按所属项目和后端 Task ID 读取最新快照。
   * projectId 不能从 taskId 推导；后端查询接口要求两者同时传入。
   */
  get(projectId: string, taskId: Task['id']): Promise<Task>
  /**
   * 订阅后必须立即发送一次最新完整快照，随后再发送状态变化；任务已经终止也必须发送。
   * 该语义关闭 get/create 与开始监听之间的终态竞态。
   */
  subscribe(projectId: string, taskId: Task['id'], onEvent: (event: TaskEvent) => void): () => void
}
