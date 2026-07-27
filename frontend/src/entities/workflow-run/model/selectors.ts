import {
  WORKFLOW_NODE_ORDER,
  type WorkflowCommand,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowRevision,
  type WorkflowRun,
} from './types'

export function getRevision(run: WorkflowRun, revisionId: string): WorkflowRevision | null {
  return run.revisions.find((revision) => revision.id === revisionId) ?? null
}

export function getCurrentRevision(run: WorkflowRun): WorkflowRevision {
  const revision = getRevision(run, run.currentRevisionId)
  if (!revision) throw new Error(`工作流 ${run.id} 缺少当前版本 ${run.currentRevisionId}`)
  return revision
}

export function listRevisionHistory(run: WorkflowRun): WorkflowRevision[] {
  return [...run.revisions].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function getNode(
  run: WorkflowRun,
  revisionId: string,
  nodeId: string,
): WorkflowNode | null {
  return getRevision(run, revisionId)?.nodes.find((node) => node.id === nodeId) ?? null
}

export function getNodeByType(
  revision: WorkflowRevision,
  type: WorkflowNodeType,
): WorkflowNode | null {
  return revision.nodes.find((node) => node.type === type) ?? null
}

export function getCurrentNode(run: WorkflowRun): WorkflowNode | null {
  return getCurrentRevision(run).nodes.find((node) => node.status === 'active') ?? null
}

export function getFirstAccessibleNodeType(revision: WorkflowRevision): WorkflowNodeType {
  return (
    revision.nodes.find((node) => node.status === 'active')?.type ??
    revision.nodes.at(-1)?.type ??
    WORKFLOW_NODE_ORDER[0]
  )
}

export function canEnterNode(
  run: WorkflowRun,
  revisionId: string,
  type: WorkflowNodeType,
): boolean {
  const node = getRevision(run, revisionId)?.nodes.find((item) => item.type === type)
  return node?.status === 'active' || node?.status === 'passed' || node?.status === 'failed'
}

export function canRestartFromNode(
  run: WorkflowRun,
  revisionId: string,
  nodeId: string,
): boolean {
  const revision = getRevision(run, revisionId)
  const node = revision?.nodes.find((item) => item.id === nodeId)
  return Boolean(revision && node && node.status !== 'locked' && node.status !== 'available')
}

export function canSubmitCommand(run: WorkflowRun, command: WorkflowCommand): boolean {
  if (command.kind === 'record-playtest') {
    return getRevision(run, command.revisionId)?.generationStatus === 'completed'
  }

  if (command.kind === 'restart-from-node') {
    return canRestartFromNode(run, command.sourceRevisionId, command.nodeId)
  }

  const revision = getCurrentRevision(run)
  if (revision.status === 'abandoned') return false

  if (command.kind === 'set-export-status') {
    const exportNode = getNodeByType(revision, 'export')
    return revision.generationStatus === 'completed' && exportNode?.status === 'active'
  }

  const node = revision.nodes.find((item) => item.id === command.nodeId)
  if (!node || node.status !== 'active') return false
  if (command.kind === 'record-quality-result') return node.type === 'candidate'
  if (command.kind === 'complete-node') return node.type !== 'candidate'
  return true
}

export function canImportToPlaytest(run: WorkflowRun, revisionId: string): boolean {
  return getRevision(run, revisionId)?.generationStatus === 'completed'
}

export function nextNodeType(type: WorkflowNodeType): WorkflowNodeType | null {
  const index = WORKFLOW_NODE_ORDER.indexOf(type)
  return WORKFLOW_NODE_ORDER[index + 1] ?? null
}

export function isWorkflowNodeType(value: string | undefined): value is WorkflowNodeType {
  return WORKFLOW_NODE_ORDER.includes(value as WorkflowNodeType)
}
