import type { Task } from '../../task'
import type { WorkflowNode, WorkflowRevision, WorkflowRun } from './types'

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
