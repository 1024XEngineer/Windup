import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'
import { fetchWorkflowRun } from './api/get-workflow-run'
import type { TaskEvent } from './model/task'
import type { WorkflowRun } from './model/types'

export { createWorkflowRun } from './api/create-workflow-run'
export { fetchWorkflowRun } from './api/get-workflow-run'
export { submitWorkflowCommand } from './api/submit-workflow-command'
export { workflowRunKeys } from './model/queries'
export {
  canEnterNode,
  canImportToPlaytest,
  canRestartFromNode,
  canSubmitCommand,
  getCurrentNode,
  getCurrentRevision,
  getFirstAccessibleNodeType,
  getNode,
  getNodeByType,
  getRevision,
  isWorkflowNodeType,
  listRevisionHistory,
  nextNodeType,
} from './model/selectors'
export { WORKFLOW_NODE_ORDER } from './model/types'
export type { Task, TaskEvent, TaskStatus } from './model/task'
export type {
  CreateWorkflowRunInput,
  ExportStatus,
  GenerationStatus,
  PlaytestStatus,
  WorkflowCommand,
  WorkflowCommandKind,
  WorkflowDriver,
  WorkflowLocation,
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowNodeType,
  WorkflowRevision,
  WorkflowRevisionStatus,
  WorkflowRun,
  WorkflowRunStatus,
} from './model/types'

/** 任务流协议尚未冻结，调用会明确失败而不是伪造进度。 */
export function subscribeTask(_taskId: string, _onEvent: (event: TaskEvent) => void): () => void {
  throw new Error('subscribeTask 的 SSE 协议尚未与后端确定，暂不可调用')
}

export function useWorkflowRun(runId: string): AsyncState<WorkflowRun> {
  return useAsync(() => fetchWorkflowRun(runId), [runId])
}
