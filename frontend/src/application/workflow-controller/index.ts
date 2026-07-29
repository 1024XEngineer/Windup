import type { WorkflowRun } from '@/entities'

/**
 * Quick Start Agent 和手动 Workflow Editor 共用的界面无关推进边界。
 * 手动模式一次推进一步，Quick Start 连续调用同一逻辑到终点。
 */
export interface WorkflowControllerPort {
  advance(runId: WorkflowRun['id']): Promise<WorkflowRun>
  runToCompletion(runId: WorkflowRun['id']): Promise<WorkflowRun>
}
