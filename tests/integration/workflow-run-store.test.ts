import { beforeEach, describe, expect, it } from 'vitest'

import {
  canImportToPlaytest,
  createWorkflowRun,
  fetchWorkflowRun,
  getCurrentNode,
  getCurrentRevision,
  getNodeByType,
  getRevision,
  submitWorkflowCommand,
} from '@/entities'

describe('entities/workflow-run Revision 契约', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear()
  })

  it('Quick Start 和手动入口创建同一种 WorkflowRun', async () => {
    const ai = await createWorkflowRun({
      projectId: 'quick-start',
      driver: 'ai',
      prompt: '像素小骑士',
    })
    const manual = await createWorkflowRun({ projectId: 'project-1', driver: 'manual' })

    expect(getCurrentNode(ai)?.type).toBe('generation')
    expect(getNodeByType(getCurrentRevision(ai), 'asset')?.status).toBe('passed')
    expect(getCurrentNode(manual)?.type).toBe('asset')
    expect(ai.revisions).toHaveLength(1)
    expect(manual.revisions).toHaveLength(1)
  })

  it('用同一个 runId 持久化并取回同一版本', async () => {
    const created = await createWorkflowRun({ projectId: 'project-1', driver: 'manual' })
    const loaded = await fetchWorkflowRun(created.id)
    expect(loaded.id).toBe(created.id)
    expect(loaded.currentRevisionId).toBe(created.currentRevisionId)
  })

  it('生成完成后进入质量门禁，连续失败两次才阻断', async () => {
    let run = await createWorkflowRun({ projectId: 'quick-start', driver: 'ai', prompt: '骑士' })
    const generation = getCurrentNode(run)!
    run = await submitWorkflowCommand(run.id, {
      kind: 'complete-node',
      nodeId: generation.id,
      output: { jobId: 'job-1' },
    })
    const candidate = getCurrentNode(run)!

    run = await submitWorkflowCommand(run.id, {
      kind: 'record-quality-result',
      nodeId: candidate.id,
      passed: false,
      report: { reason: '抖动' },
    })
    expect(getCurrentNode(run)?.qualityFailureCount).toBe(1)
    expect(getCurrentNode(run)?.status).toBe('active')

    run = await submitWorkflowCommand(run.id, {
      kind: 'record-quality-result',
      nodeId: candidate.id,
      passed: false,
      report: { reason: '轮廓断裂' },
    })
    expect(getNodeByType(getCurrentRevision(run), 'candidate')?.status).toBe('failed')
    expect(getCurrentRevision(run).generationStatus).toBe('failed')
    expect(run.status).toBe('failed')
  })

  it('质量门禁通过后形成可导入 Playtest 的历史版本', async () => {
    let run = await createWorkflowRun({ projectId: 'quick-start', driver: 'ai', prompt: '骑士' })
    run = await submitWorkflowCommand(run.id, {
      kind: 'complete-node',
      nodeId: getCurrentNode(run)!.id,
    })
    run = await submitWorkflowCommand(run.id, {
      kind: 'record-quality-result',
      nodeId: getCurrentNode(run)!.id,
      passed: true,
      report: { passed: true },
    })

    expect(getCurrentRevision(run).generationStatus).toBe('completed')
    expect(getCurrentNode(run)?.type).toBe('review')
    expect(canImportToPlaytest(run, run.currentRevisionId)).toBe(true)
  })

  it('导出必须进入 export 节点，不能绕过 review', async () => {
    let run = await createWorkflowRun({ projectId: 'quick-start', driver: 'ai', prompt: '骑士' })
    run = await submitWorkflowCommand(run.id, {
      kind: 'complete-node',
      nodeId: getCurrentNode(run)!.id,
    })
    run = await submitWorkflowCommand(run.id, {
      kind: 'record-quality-result',
      nodeId: getCurrentNode(run)!.id,
      passed: true,
    })

    await expect(
      submitWorkflowCommand(run.id, { kind: 'set-export-status', status: 'exported' }),
    ).rejects.toThrow(/不允许命令/)

    run = await submitWorkflowCommand(run.id, {
      kind: 'complete-node',
      nodeId: getCurrentNode(run)!.id,
    })
    expect(getCurrentNode(run)?.type).toBe('export')

    run = await submitWorkflowCommand(run.id, {
      kind: 'set-export-status',
      status: 'exported',
    })
    expect(getCurrentRevision(run).exportStatus).toBe('exported')
    expect(getNodeByType(getCurrentRevision(run), 'export')?.status).toBe('passed')
  })

  it('从历史节点重启会保留前缀引用并移除后续执行线', async () => {
    let run = await createWorkflowRun({ projectId: 'quick-start', driver: 'ai', prompt: '骑士' })
    run = await submitWorkflowCommand(run.id, {
      kind: 'complete-node',
      nodeId: getCurrentNode(run)!.id,
    })
    run = await submitWorkflowCommand(run.id, {
      kind: 'record-quality-result',
      nodeId: getCurrentNode(run)!.id,
      passed: true,
    })
    const sourceRevision = getCurrentRevision(run)
    const generationNode = getNodeByType(sourceRevision, 'generation')!

    run = await submitWorkflowCommand(run.id, {
      kind: 'restart-from-node',
      sourceRevisionId: sourceRevision.id,
      nodeId: generationNode.id,
    })
    const restarted = getCurrentRevision(run)

    expect(run.revisions).toHaveLength(2)
    expect(restarted.basedOnRevisionId).toBe(sourceRevision.id)
    expect(restarted.nodes.map((node) => node.type)).toEqual(['asset', 'generation'])
    expect(getCurrentNode(run)?.type).toBe('generation')
    expect(getNodeByType(restarted, 'generation')?.referenceNodeIds).toContain(generationNode.id)
    expect(getRevision(run, sourceRevision.id)?.nodes.map((node) => node.type)).toEqual([
      'asset',
      'generation',
      'candidate',
      'review',
    ])
  })

  it('不存在的工作流明确报错', async () => {
    await expect(fetchWorkflowRun('run-does-not-exist')).rejects.toThrow()
  })
})
