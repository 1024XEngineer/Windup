import {
  WORKFLOW_NODE_ORDER,
  type CreateWorkflowRunInput,
  type WorkflowCommand,
  type WorkflowNode,
  type WorkflowRevision,
  type WorkflowRun,
} from '../model/types'
import { loadRun, newId, saveRun } from './store'

function node(
  type: WorkflowNode['type'],
  status: WorkflowNode['status'],
  input: unknown,
): WorkflowNode {
  return {
    id: newId('node'),
    type,
    order: 0,
    status,
    input,
    output: null,
    referenceNodeIds: [],
    qualityFailureCount: 0,
  }
}

/** AI 入口跳过资产设置直接进生成，手动入口从资产设置开始。 */
function initialRevision(driver: WorkflowRun['driver'], prompt: string | null): WorkflowRevision {
  const asset = node('asset', driver === 'ai' ? 'passed' : 'active', { prompt })
  const nodes =
    driver === 'ai'
      ? [
          asset,
          {
            ...node('generation', 'active', { prompt }),
            order: 1,
            referenceNodeIds: [asset.id],
          },
        ]
      : [asset]

  return {
    id: newId('revision'),
    basedOnRevisionId: null,
    restartNodeId: null,
    status: 'active',
    nodes,
    generationStatus: 'in_progress',
    exportStatus: 'not_exported',
    playtestStatus: 'not_tested',
    createdAt: new Date().toISOString(),
  }
}

export function createLocalRun(input: CreateWorkflowRunInput): WorkflowRun {
  const prompt = input.prompt?.trim() || null
  const revision = initialRevision(input.driver, prompt)
  return saveRun({
    id: newId('run'),
    projectId: input.projectId,
    characterId: null,
    driver: input.driver,
    status: 'active',
    currentRevisionId: revision.id,
    revisions: [revision],
    prompt,
  })
}

/** MS2 页面推进状态机；真实生成、审核和导出结果未来由独立能力 Adapter 驱动。 */
export function advanceLocalRun(runId: WorkflowRun['id'], command: WorkflowCommand): WorkflowRun {
  const run = loadRun(runId)
  if (!run) throw new Error(`工作流 ${runId} 不存在`)
  if (!canSubmit(run, command)) throw new Error(`工作流 ${runId} 当前不允许命令 ${command.kind}`)

  if (command.kind === 'record-playtest') {
    return saveRun({
      ...run,
      revisions: run.revisions.map((item) =>
        item.id === command.revisionId ? { ...item, playtestStatus: command.status } : item,
      ),
    })
  }

  if (command.kind === 'restart-from-node') {
    const revision = restartRevision(revisionOf(run, command.sourceRevisionId)!, command.nodeId)
    return saveRun({
      ...run,
      status: 'active',
      currentRevisionId: revision.id,
      revisions: [...run.revisions, revision],
    })
  }

  const current = currentRevision(run)

  if (command.kind === 'set-export-status') {
    const exportNode = current.nodes.find((item) => item.type === 'export')!
    const updated = replaceNode(current, exportNode.id, (item) => ({
      ...item,
      status:
        command.status === 'exported'
          ? 'passed'
          : command.status === 'failed'
            ? 'failed'
            : item.status,
    }))
    const exported = command.status === 'exported'
    return saveRun(
      replaceRevision(
        run,
        {
          ...updated,
          exportStatus: command.status,
          status: exported ? 'completed' : updated.status,
        },
        exported ? 'completed' : run.status,
      ),
    )
  }

  if (command.kind === 'record-quality-result') {
    return saveRun(applyQualityResult(run, current, command.nodeId, command.passed, command.report))
  }

  if (command.kind === 'fail-node') {
    const failed = replaceNode(current, command.nodeId, (item) => ({
      ...item,
      status: 'failed',
      output: { error: command.error },
    }))
    return saveRun(replaceRevision(run, { ...failed, status: 'failed' }, 'failed'))
  }

  const completed = replaceNode(current, command.nodeId, (item) => ({
    ...item,
    status: 'passed',
    output: command.output ?? null,
  }))
  return saveRun(replaceRevision(run, appendNextNode(completed, nodeOf(completed, command.nodeId))))
}

function canSubmit(run: WorkflowRun, command: WorkflowCommand): boolean {
  if (command.kind === 'record-playtest') {
    return revisionOf(run, command.revisionId)?.generationStatus === 'completed'
  }

  if (command.kind === 'restart-from-node') {
    const selected = revisionOf(run, command.sourceRevisionId)?.nodes.find(
      (item) => item.id === command.nodeId,
    )
    return Boolean(selected && selected.status !== 'locked' && selected.status !== 'available')
  }

  const revision = currentRevision(run)
  if (revision.status === 'abandoned') return false

  if (command.kind === 'set-export-status') {
    const exportNode = revision.nodes.find((item) => item.type === 'export')
    return revision.generationStatus === 'completed' && exportNode?.status === 'active'
  }

  const selected = revision.nodes.find((item) => item.id === command.nodeId)
  if (!selected || selected.status !== 'active') return false
  if (command.kind === 'record-quality-result') return selected.type === 'candidate'
  if (command.kind === 'complete-node') return selected.type !== 'candidate'
  return true
}

function applyQualityResult(
  run: WorkflowRun,
  revision: WorkflowRevision,
  nodeId: string,
  passed: boolean,
  report: unknown,
): WorkflowRun {
  if (passed) {
    const completed = replaceNode(revision, nodeId, (item) => ({
      ...item,
      status: 'passed',
      output: report ?? null,
    }))
    return replaceRevision(run, {
      ...appendNextNode(completed, nodeOf(completed, nodeId)),
      generationStatus: 'completed',
    })
  }

  let failureCount = 0
  const failed = replaceNode(revision, nodeId, (item) => {
    failureCount = item.qualityFailureCount + 1
    return {
      ...item,
      qualityFailureCount: failureCount,
      status: failureCount >= 2 ? 'failed' : 'active',
      output: report ?? null,
    }
  })
  if (failureCount < 2) return replaceRevision(run, failed)
  return replaceRevision(run, { ...failed, generationStatus: 'failed', status: 'failed' }, 'failed')
}

/** 从某节点重开：保留该节点及之前的前缀作为参考，后续执行线不带过来。 */
function restartRevision(source: WorkflowRevision, nodeId: string): WorkflowRevision {
  const selectedIndex = source.nodes.findIndex((item) => item.id === nodeId)
  if (selectedIndex < 0) throw new Error(`版本 ${source.id} 不包含节点 ${nodeId}`)

  const nodes = source.nodes.slice(0, selectedIndex + 1).map((item, index) => ({
    ...item,
    id: newId('node'),
    order: index,
    status: index === selectedIndex ? ('active' as const) : ('passed' as const),
    output: index === selectedIndex ? null : item.output,
    referenceNodeIds: [...item.referenceNodeIds, item.id],
    qualityFailureCount: index === selectedIndex ? 0 : item.qualityFailureCount,
  }))
  const selectedOrder = WORKFLOW_NODE_ORDER.indexOf(nodes.at(-1)!.type)

  return {
    id: newId('revision'),
    basedOnRevisionId: source.id,
    restartNodeId: nodeId,
    status: 'active',
    nodes,
    generationStatus:
      selectedOrder <= WORKFLOW_NODE_ORDER.indexOf('candidate')
        ? 'in_progress'
        : source.generationStatus,
    exportStatus: 'not_exported',
    playtestStatus: 'not_tested',
    createdAt: new Date().toISOString(),
  }
}

function appendNextNode(revision: WorkflowRevision, source: WorkflowNode): WorkflowRevision {
  const type = WORKFLOW_NODE_ORDER[WORKFLOW_NODE_ORDER.indexOf(source.type) + 1]
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

function revisionOf(run: WorkflowRun, revisionId: string): WorkflowRevision | null {
  return run.revisions.find((item) => item.id === revisionId) ?? null
}

function currentRevision(run: WorkflowRun): WorkflowRevision {
  const revision = revisionOf(run, run.currentRevisionId)
  if (!revision) throw new Error(`工作流 ${run.id} 缺少当前版本 ${run.currentRevisionId}`)
  return revision
}

function nodeOf(revision: WorkflowRevision, nodeId: string): WorkflowNode {
  return revision.nodes.find((item) => item.id === nodeId)!
}

function replaceNode(
  revision: WorkflowRevision,
  nodeId: string,
  update: (node: WorkflowNode) => WorkflowNode,
): WorkflowRevision {
  return {
    ...revision,
    nodes: revision.nodes.map((item) => (item.id === nodeId ? update(item) : item)),
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
