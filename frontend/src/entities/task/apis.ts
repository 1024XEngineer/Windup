/**
 * 服务端异步 Task 的最小查询接口。
 *
 * 当前后端事件、取消与重试合同尚未冻结，因此只保留按 ID 获取快照的方法，不提前
 * 创建 EventSource、轮询器或两套实现。
 */
import type { Task } from './types'

/** 异步任务查询 API；取消和事件传输形式等待后端合同。 */
export interface TaskAPIs {
  /** 读取某个异步任务的最新服务端快照。 */
  get(taskId: Task['id']): Promise<Task>
}
