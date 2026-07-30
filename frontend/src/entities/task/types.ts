/**
 * 服务端异步 Task 的前端快照类型。
 *
 * Task 与一次 Generation 关联，回答“服务端工作执行到哪里”；WorkflowStep 则回答
 * “产品流程走到哪里”。两者生命周期不同，不能合并成同一个概念。
 */
import type { Generation } from '../generation'

/** 当前已确认的最小任务生命周期。 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

/** 服务端异步任务快照，不等同于 WorkflowStep。 */
export interface Task {
  /** 服务端任务标识。 */
  id: string
  /** 该任务服务于哪一条 Generation 业务记录。 */
  generationId: Generation['id']
  status: TaskStatus
  result: unknown
  /** 失败信息；非失败状态下为 null。 */
  error: string | null
}
