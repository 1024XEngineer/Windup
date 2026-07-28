import { loadRun, newId, saveRun } from './store'
import { NODE_ORDER, type CommandDto, type NodeDto, type RevisionDto, type RunDto } from './types'

/** 工作流状态机。entities 的同名规则只是客户端预判，以这里为准。 */
export function advanceRun(runId: string, command: CommandDto): RunDto {
  const run = loadRun(runId)
  if (!run) throw new Error(`工作流 ${runId} 不存在`)
  if (!canSubmit(run, command)) throw new Error(`工作流 ${runId} 当前不允许命令 ${command.kind}`)

  if (command.kind === 'record-playtest') {
    return saveRun({
      ...run,
      revisions: run.revisions.map((item) =>
        item.id === command.revision_id ? { ...item, playtest_status: command.status } : item,
      ),
    })
  }

  if (command.kind === 'restart-from-node') {
    const revision = restartRevision(revisionOf(run, command.source_revision_id)!, command.node_id)
    return saveRun({
      ...run,
      status: 'active',
      current_revision_id: revision.id,
      revisions: [...run.revisions, revision],
    })
  }

  const current = currentRevision(run)

  if (command.kind === 'set-export-status') {
    const exportNode = current.nodes.find((node) => node.type === 'export')!
    const updated = replaceNode(current, exportNode.id, (node) => ({
      ...node,
      status:
        command.status === 'exported'
          ? 'passed'
          : command.status === 'failed'
            ? 'failed'
            : node.status,
    }))
    const exported = command.status === 'exported'
    return saveRun(
      replaceRevision(
        run,
        {
          ...updated,
          export_status: command.status,
          status: exported ? 'completed' : updated.status,
        },
        exported ? 'completed' : run.status,
      ),
    )
  }

  if (command.kind === 'record-quality-result') {
    return saveRun(
      applyQualityResult(run, current, command.node_id, command.passed, command.report),
    )
  }

  if (command.kind === 'fail-node') {
    const failed = replaceNode(current, command.node_id, (node) => ({
      ...node,
      status: 'failed',
      output: { error: command.error },
    }))
    return saveRun(replaceRevision(run, { ...failed, status: 'failed' }, 'failed'))
  }

  const completed = replaceNode(current, command.node_id, (node) => ({
    ...node,
    status: 'passed',
    output: command.output ?? null,
  }))
  return saveRun(
    replaceRevision(run, appendNextNode(completed, nodeOf(completed, command.node_id))),
  )
}

function canSubmit(run: RunDto, command: CommandDto): boolean {
  if (command.kind === 'record-playtest') {
    return revisionOf(run, command.revision_id)?.generation_status === 'completed'
  }

  if (command.kind === 'restart-from-node') {
    const node = revisionOf(run, command.source_revision_id)?.nodes.find(
      (item) => item.id === command.node_id,
    )
    return Boolean(node && node.status !== 'locked' && node.status !== 'available')
  }

  const revision = currentRevision(run)
  if (revision.status === 'abandoned') return false

  if (command.kind === 'set-export-status') {
    const exportNode = revision.nodes.find((node) => node.type === 'export')
    return revision.generation_status === 'completed' && exportNode?.status === 'active'
  }

  const node = revision.nodes.find((item) => item.id === command.node_id)
  if (!node || node.status !== 'active') return false
  if (command.kind === 'record-quality-result') return node.type === 'candidate'
  if (command.kind === 'complete-node') return node.type !== 'candidate'
  return true
}

function applyQualityResult(
  run: RunDto,
  revision: RevisionDto,
  nodeId: string,
  passed: boolean,
  report: unknown,
): RunDto {
  if (passed) {
    const completed = replaceNode(revision, nodeId, (node) => ({
      ...node,
      status: 'passed',
      output: report ?? null,
    }))
    return replaceRevision(run, {
      ...appendNextNode(completed, nodeOf(completed, nodeId)),
      generation_status: 'completed',
    })
  }

  let failureCount = 0
  const failed = replaceNode(revision, nodeId, (node) => {
    failureCount = node.quality_failure_count + 1
    return {
      ...node,
      quality_failure_count: failureCount,
      status: failureCount >= 2 ? 'failed' : 'active',
      output: report ?? null,
    }
  })
  if (failureCount < 2) return replaceRevision(run, failed)
  return replaceRevision(
    run,
    { ...failed, generation_status: 'failed', status: 'failed' },
    'failed',
  )
}

/** 从某节点重开：保留该节点及之前的前缀作为参考，后续执行线不带过来。 */
function restartRevision(source: RevisionDto, nodeId: string): RevisionDto {
  const selectedIndex = source.nodes.findIndex((node) => node.id === nodeId)
  if (selectedIndex < 0) throw new Error(`版本 ${source.id} 不包含节点 ${nodeId}`)

  const nodes = source.nodes.slice(0, selectedIndex + 1).map((node, index) => ({
    ...node,
    id: newId('node'),
    order: index,
    status: index === selectedIndex ? ('active' as const) : ('passed' as const),
    output: index === selectedIndex ? null : node.output,
    reference_node_ids: [...node.reference_node_ids, node.id],
    quality_failure_count: index === selectedIndex ? 0 : node.quality_failure_count,
  }))
  const selectedOrder = NODE_ORDER.indexOf(nodes.at(-1)!.type)

  return {
    id: newId('revision'),
    based_on_revision_id: source.id,
    restart_node_id: nodeId,
    status: 'active',
    nodes,
    generation_status:
      selectedOrder <= NODE_ORDER.indexOf('candidate') ? 'in_progress' : source.generation_status,
    export_status: 'not_exported',
    playtest_status: 'not_tested',
    created_at: new Date().toISOString(),
  }
}

function appendNextNode(revision: RevisionDto, source: NodeDto): RevisionDto {
  const type = NODE_ORDER[NODE_ORDER.indexOf(source.type) + 1]
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
        reference_node_ids: [source.id],
        quality_failure_count: 0,
      },
    ],
  }
}

function revisionOf(run: RunDto, revisionId: string): RevisionDto | null {
  return run.revisions.find((revision) => revision.id === revisionId) ?? null
}

function currentRevision(run: RunDto): RevisionDto {
  const revision = revisionOf(run, run.current_revision_id)
  if (!revision) throw new Error(`工作流 ${run.id} 缺少当前版本 ${run.current_revision_id}`)
  return revision
}

function nodeOf(revision: RevisionDto, nodeId: string): NodeDto {
  return revision.nodes.find((node) => node.id === nodeId)!
}

function replaceNode(
  revision: RevisionDto,
  nodeId: string,
  update: (node: NodeDto) => NodeDto,
): RevisionDto {
  return {
    ...revision,
    nodes: revision.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
  }
}

function replaceRevision(
  run: RunDto,
  revision: RevisionDto,
  status: RunDto['status'] = run.status,
): RunDto {
  return {
    ...run,
    status,
    revisions: run.revisions.map((item) => (item.id === revision.id ? revision : item)),
  }
}
