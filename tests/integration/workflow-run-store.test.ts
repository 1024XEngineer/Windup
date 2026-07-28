import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

function createWriteRejectingStorage(snapshot: string): Storage {
  const values = new Map([['windup.workflow-runs.v1', snapshot]])
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
}

function createStorageWithRuns(runs: Record<string, unknown>): Storage {
  const storage = createMemoryStorage()
  storage.setItem('windup.workflow-runs.v1', JSON.stringify(runs))
  return storage
}

function persistedRun(id: string) {
  const revisionId = `revision-${id}`
  return {
    id,
    projectId: 'project-from-storage',
    characterId: null,
    driver: 'manual',
    status: 'active',
    currentRevisionId: revisionId,
    revisions: [
      {
        id: revisionId,
        basedOnRevisionId: null,
        restartNodeId: null,
        status: 'active',
        nodes: [
          {
            id: `node-${id}`,
            type: 'asset',
            order: 0,
            status: 'active',
            input: { prompt: null },
            output: null,
            referenceNodeIds: [],
            qualityFailureCount: 0,
          },
        ],
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        playtestStatus: 'not_tested',
        createdAt: '2026-07-28T00:00:00.000Z',
      },
    ],
    prompt: null,
  }
}

function withoutProjectId(id: string): Record<string, unknown> {
  const run: Record<string, unknown> = { ...persistedRun(id) }
  delete run.projectId
  return run
}

function withoutRevisionNodes(id: string) {
  const run = persistedRun(id)
  const revision: Record<string, unknown> = { ...run.revisions[0] }
  delete revision.nodes
  return { ...run, revisions: [revision] }
}

describe('entities/workflow-run Revision 契约', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('手动流程在进入生成节点前明确标记为尚未开始', async () => {
    let manual = await createWorkflowRun({ projectId: 'manual-not-started', driver: 'manual' })

    expect(getCurrentRevision(manual).generationStatus).toBe('not_started')
    manual = await submitWorkflowCommand(manual.id, {
      kind: 'complete-node',
      nodeId: getCurrentNode(manual)!.id,
    })
    expect(getCurrentNode(manual)?.type).toBe('generation')
    expect(getCurrentRevision(manual).generationStatus).toBe('in_progress')

    const quickStart = await createWorkflowRun({
      projectId: 'quick-start-in-progress',
      driver: 'ai',
      prompt: '骑士',
    })
    expect(getCurrentRevision(quickStart).generationStatus).toBe('in_progress')
  })

  it('从素材节点重启时生成状态回到尚未开始', async () => {
    let run = await createWorkflowRun({ projectId: 'manual-restart', driver: 'manual' })
    run = await submitWorkflowCommand(run.id, {
      kind: 'complete-node',
      nodeId: getCurrentNode(run)!.id,
    })
    const source = getCurrentRevision(run)
    const asset = getNodeByType(source, 'asset')!
    const generation = getNodeByType(source, 'generation')!

    run = await submitWorkflowCommand(run.id, {
      kind: 'restart-from-node',
      sourceRevisionId: source.id,
      nodeId: asset.id,
    })
    expect(getCurrentNode(run)?.type).toBe('asset')
    expect(getCurrentRevision(run).generationStatus).toBe('not_started')

    run = await submitWorkflowCommand(run.id, {
      kind: 'restart-from-node',
      sourceRevisionId: source.id,
      nodeId: generation.id,
    })
    expect(getCurrentNode(run)?.type).toBe('generation')
    expect(getCurrentRevision(run).generationStatus).toBe('in_progress')
  })

  it('用同一个 runId 持久化并取回同一版本', async () => {
    const created = await createWorkflowRun({ projectId: 'project-1', driver: 'manual' })
    const loaded = await fetchWorkflowRun(created.id)
    expect(loaded.id).toBe(created.id)
    expect(loaded.currentRevisionId).toBe(created.currentRevisionId)

    const stored = JSON.parse(localStorage.getItem('windup.workflow-runs.v1') ?? '{}')
    expect(stored[created.id]).toEqual(created)
  })

  it('localStorage 写入失败后仍读取本次会话的最新工作流', async () => {
    await createWorkflowRun({ projectId: 'old-project', driver: 'manual' })
    const oldSnapshot = localStorage.getItem('windup.workflow-runs.v1')!
    vi.stubGlobal('localStorage', createWriteRejectingStorage(oldSnapshot))

    const created = await createWorkflowRun({ projectId: 'new-project', driver: 'manual' })
    const loaded = await fetchWorkflowRun(created.id)

    expect(loaded.id).toBe(created.id)
    expect(loaded.currentRevisionId).toBe(created.currentRevisionId)
  })

  it('randomUUID 缺失时使用 getRandomValues 创建工作流 ID', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint8Array) => {
        values.fill(7)
        return values
      },
    })

    const run = await createWorkflowRun({ projectId: 'project-random-values', driver: 'manual' })

    expect(run.id).toMatch(/^run-/)
    expect(getCurrentRevision(run).id).toMatch(/^revision-/)
    expect(getCurrentNode(run)?.id).toMatch(/^node-/)
  })

  it('Web Crypto 不可用时仍能创建不重复的工作流 ID', async () => {
    vi.stubGlobal('crypto', undefined)

    const first = await createWorkflowRun({ projectId: 'project-fallback-1', driver: 'manual' })
    const second = await createWorkflowRun({ projectId: 'project-fallback-2', driver: 'manual' })

    expect(first.id).toMatch(/^run-/)
    expect(second.id).toMatch(/^run-/)
    expect(second.id).not.toBe(first.id)
  })

  it('缺失字段、非法枚举或错误引用的损坏记录不会被读取', async () => {
    const invalidDriver = persistedRun('run-invalid-driver')
    const missingNodes = withoutRevisionNodes('run-missing-nodes')
    const invalidNodeStatus = persistedRun('run-invalid-node-status')
    const missingCurrentRevision = persistedRun('run-missing-current-revision')
    const mismatchedMapValue = persistedRun('run-map-value')

    const cases: Array<[lookupId: string, record: unknown]> = [
      ['run-missing-project', withoutProjectId('run-missing-project')],
      ['run-invalid-driver', { ...invalidDriver, driver: 'robot' }],
      ['run-missing-nodes', missingNodes],
      [
        'run-invalid-node-status',
        {
          ...invalidNodeStatus,
          revisions: [
            {
              ...invalidNodeStatus.revisions[0],
              nodes: [{ ...invalidNodeStatus.revisions[0].nodes[0], status: 'unknown' }],
            },
          ],
        },
      ],
      [
        'run-missing-current-revision',
        { ...missingCurrentRevision, currentRevisionId: 'revision-does-not-exist' },
      ],
      ['run-map-key', mismatchedMapValue],
    ]

    for (const [lookupId, record] of cases) {
      vi.stubGlobal('localStorage', createStorageWithRuns({ [lookupId]: record }))
      await expect(fetchWorkflowRun(lookupId)).rejects.toThrow(/不存在/)
    }
  })

  it('过滤损坏记录时仍保留同一快照中的合法记录', async () => {
    const valid = persistedRun('run-valid-sibling')
    vi.stubGlobal(
      'localStorage',
      createStorageWithRuns({
        'run-invalid-sibling': withoutProjectId('run-invalid-sibling'),
        [valid.id]: valid,
      }),
    )

    await expect(fetchWorkflowRun('run-invalid-sibling')).rejects.toThrow(/不存在/)
    await expect(fetchWorkflowRun(valid.id)).resolves.toMatchObject({
      id: valid.id,
      currentRevisionId: valid.currentRevisionId,
    })
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
