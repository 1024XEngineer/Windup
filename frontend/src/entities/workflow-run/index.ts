import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'
import { fetchWorkflowRun } from './orchestration/get-workflow-run'
import type { WorkflowRun } from './model/types'

export { createWorkflowRun } from './orchestration/create-workflow-run'
export { fetchWorkflowRun } from './orchestration/get-workflow-run'
export { submitWorkflowCommand } from './orchestration/submit-workflow-command'
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
export type { WorkflowTaskLink } from './model/task-link'
export type {
  CreateWorkflowRunInput,
  ExportStatus,
  GenerationStatus,
  PlaytestStatus,
  WorkflowCommand,
  WorkflowCommandKind,
  WorkflowDriver,
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowNodeType,
  WorkflowRevision,
  WorkflowRevisionStatus,
  WorkflowRun,
  WorkflowRunStatus,
} from './model/types'

export function useWorkflowRun(runId: string): AsyncState<WorkflowRun> {
  return useAsync(() => fetchWorkflowRun(runId), [runId])
}
