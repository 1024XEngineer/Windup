import { canSubmitCommand, getCurrentRevision, getRevision, nextNodeType } from '../model/selectors'
import {
  WORKFLOW_NODE_ORDER,
  type WorkflowCommand,
  type WorkflowNode,
  type WorkflowRevision,
  type WorkflowRun,
} from '../model/types'
import { loadRun, newId, saveRun } from './local-store'

/** 所有 WorkflowRun 状态变化只经过这一命令入口。 */
export async function submitWorkflowCommand(
  runId: string,
  command: WorkflowCommand,
): Promise<WorkflowRun> {
  const run = loadRun(runId)
  if (!run) throw new Error(`工作流 ${runId} 不存在`)
  if (!canSubmitCommand(run, command)) {
    throw new Error(`工作流 ${runId} 当前不允许命令 ${command.kind}`)
  }

  if (command.kind === 'record-playtest') {
    return saveRun(updateRevision(run, command.revisionId, (revision) => ({
      ...revision,
      playtestStatus: command.status,
    })))
  }

  if (command.kind === 'restart-from-node') {
    const source = getRevision(run, command.sourceRevisionId)!
    const revision = restartRevision(source, command.nodeId)
    return saveRun({
      ...run,
      status: 'active',
      currentRevisionId: revision.id,
      revisions: [...run.revisions, revision],
    })
  }

  const current = getCurrentRevision(run)

  if (command.kind === 'set-export-status') {
    const exportNode = current.nodes.find((node) => node.type === 'export')!
    const withExportStatus = replaceNode(current, exportNode.id, (node) => ({
      ...node,
      status:
        command.status === 'exported'
          ? 'passed'
          : command.status === 'failed'
            ? 'failed'
            : node.status,
    }))
    const updated = replaceRevision(run, {
      ...withExportStatus,
      exportStatus: command.status,
      status: command.status === 'exported' ? 'completed' : withExportStatus.status,
    })
    return saveRun({
      ...updated,
      status: command.status === 'exported' ? 'completed' : updated.status,
    })
  }

  if (command.kind === 'record-quality-result') {
    return saveRun(applyQualityResult(run, current, command.nodeId, command.passed, command.report))
  }

  if (command.kind === 'fail-node') {
    const updated = replaceNode(current, command.nodeId, (node) => ({
      ...node,
      status: 'failed',
      output: { error: command.error },
    }))
    return saveRun(replaceRevision(run, { ...updated, status: 'failed' }, 'failed'))
  }

  const completed = replaceNode(current, command.nodeId, (node) => ({
    ...node,
    status: 'passed',
    output: command.output ?? null,
  }))
  const sourceNode = completed.nodes.find((node) => node.id === command.nodeId)!
  const advanced = appendNextNode(completed, sourceNode)
  return saveRun(replaceRevision(run, advanced))
}

function applyQualityResult(
  run: WorkflowRun,
  revision: WorkflowRevision,
  nodeId: string,
  passed: boolean,
  report: unknown,
): WorkflowRun {
  if (passed) {
    const completed = replaceNode(revision, nodeId, (node) => ({
      ...node,
      status: 'passed',
      output: report ?? null,
    }))
    const sourceNode = completed.nodes.find((node) => node.id === nodeId)!
    return replaceRevision(run, {
      ...appendNextNode(completed, sourceNode),
      generationStatus: 'completed',
    })
  }

  let failureCount = 0
  const failed = replaceNode(revision, nodeId, (node) => {
    failureCount = node.qualityFailureCount + 1
    return {
      ...node,
      qualityFailureCount: failureCount,
      status: failureCount >= 2 ? 'failed' : 'active',
      output: report ?? null,
    }
  })
  if (failureCount < 2) return replaceRevision(run, failed)
  return replaceRevision(
    run,
    { ...failed, generationStatus: 'failed', status: 'failed' },
    'failed',
  )
}

function restartRevision(source: WorkflowRevision, nodeId: string): WorkflowRevision {
  const selectedIndex = source.nodes.findIndex((node) => node.id === nodeId)
  if (selectedIndex < 0) throw new Error(`版本 ${source.id} 不包含节点 ${nodeId}`)

  const nodes = source.nodes.slice(0, selectedIndex + 1).map((sourceNode, index) => ({
    ...sourceNode,
    id: newId('node'),
    order: index,
    status: index === selectedIndex ? ('active' as const) : ('passed' as const),
    output: index === selectedIndex ? null : sourceNode.output,
    referenceNodeIds: [...sourceNode.referenceNodeIds, sourceNode.id],
    qualityFailureCount: index === selectedIndex ? 0 : sourceNode.qualityFailureCount,
  }))
  const selectedType = nodes.at(-1)!.type
  const selectedOrder = WORKFLOW_NODE_ORDER.indexOf(selectedType)
  const candidateOrder = WORKFLOW_NODE_ORDER.indexOf('candidate')

  return {
    id: newId('revision'),
    basedOnRevisionId: source.id,
    restartNodeId: nodeId,
    status: 'active',
    nodes,
    generationStatus: selectedOrder <= candidateOrder ? 'in_progress' : source.generationStatus,
    exportStatus: 'not_exported',
    playtestStatus: 'not_tested',
    createdAt: new Date().toISOString(),
  }
}

function appendNextNode(revision: WorkflowRevision, source: WorkflowNode): WorkflowRevision {
  const type = nextNodeType(source.type)
  if (!type) return revision
  return {
    ...revision,
    nodes: [
      ...revision.nodes,
      {
        id: newId('node'),
        type,
        order: source.order + 1,
        status: 'active',
        input: null,
        output: null,
        referenceNodeIds: [source.id],
        qualityFailureCount: 0,
      },
    ],
  }
}

function replaceNode(
  revision: WorkflowRevision,
  nodeId: string,
  update: (node: WorkflowNode) => WorkflowNode,
): WorkflowRevision {
  return {
    ...revision,
    nodes: revision.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
  }
}

function replaceRevision(
  run: WorkflowRun,
  revision: WorkflowRevision,
  status: WorkflowRun['status'] = run.status,
): WorkflowRun {
  return {
    ...run,
    status,
    revisions: run.revisions.map((item) => (item.id === revision.id ? revision : item)),
  }
}

function updateRevision(
  run: WorkflowRun,
  revisionId: string,
  update: (revision: WorkflowRevision) => WorkflowRevision,
): WorkflowRun {
  return {
    ...run,
    revisions: run.revisions.map((revision) =>
      revision.id === revisionId ? update(revision) : revision,
    ),
  }
}
