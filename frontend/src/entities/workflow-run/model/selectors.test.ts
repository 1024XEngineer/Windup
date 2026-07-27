import { describe, expect, it } from 'vitest'

import {
  canEnterNode,
  canImportToPlaytest,
  canRestartFromNode,
  canSubmitCommand,
  getCurrentNode,
  getCurrentRevision,
  getFirstAccessibleNodeType,
  getNodeByType,
  isWorkflowNodeType,
  nextNodeType,
} from './selectors'
import type { WorkflowNode, WorkflowRevision, WorkflowRun } from './types'

function node(
  id: string,
  type: WorkflowNode['type'],
  status: WorkflowNode['status'],
  order: number,
): WorkflowNode {
  return {
    id,
    type,
    status,
    order,
    input: null,
    output: null,
    referenceNodeIds: [],
    qualityFailureCount: 0,
  }
}

function revision(overrides: Partial<WorkflowRevision> = {}): WorkflowRevision {
  return {
    id: 'revision-1',
    basedOnRevisionId: null,
    restartNodeId: null,
    status: 'active',
    nodes: [node('asset-1', 'asset', 'passed', 0), node('generation-1', 'generation', 'active', 1)],
    generationStatus: 'in_progress',
    exportStatus: 'not_exported',
    playtestStatus: 'not_tested',
    createdAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  }
}

function run(current: WorkflowRevision = revision(), history: WorkflowRevision[] = []): WorkflowRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    characterId: null,
    driver: 'ai',
    status: 'active',
    currentRevisionId: current.id,
    revisions: [...history, current],
    prompt: '像素小骑士',
  }
}

describe('WorkflowRun selectors', () => {
  it('读取当前版本、当前节点和首个可访问节点', () => {
    const value = run()
    expect(getCurrentRevision(value).id).toBe('revision-1')
    expect(getCurrentNode(value)?.id).toBe('generation-1')
    expect(getFirstAccessibleNodeType(getCurrentRevision(value))).toBe('generation')
    expect(getNodeByType(getCurrentRevision(value), 'asset')?.status).toBe('passed')
  })

  it('只允许进入当前执行线上已经存在的节点', () => {
    const value = run()
    expect(canEnterNode(value, 'revision-1', 'asset')).toBe(true)
    expect(canEnterNode(value, 'revision-1', 'generation')).toBe(true)
    expect(canEnterNode(value, 'revision-1', 'candidate')).toBe(false)
  })

  it('已经存在的节点允许作为重新开始位置', () => {
    const value = run()
    expect(canRestartFromNode(value, 'revision-1', 'asset-1')).toBe(true)
    expect(canRestartFromNode(value, 'revision-1', 'missing')).toBe(false)
  })

  it('候选节点只能提交质量门禁结果，不能直接标记完成', () => {
    const candidateRevision = revision({
      nodes: [
        node('asset-1', 'asset', 'passed', 0),
        node('generation-1', 'generation', 'passed', 1),
        node('candidate-1', 'candidate', 'active', 2),
      ],
    })
    const value = run(candidateRevision)
    expect(
      canSubmitCommand(value, {
        kind: 'record-quality-result',
        nodeId: 'candidate-1',
        passed: true,
      }),
    ).toBe(true)
    expect(
      canSubmitCommand(value, { kind: 'complete-node', nodeId: 'candidate-1' }),
    ).toBe(false)
  })

  it('只有系统质检通过的版本可以导入核验台', () => {
    const value = run(revision({ generationStatus: 'completed' }))
    expect(canImportToPlaytest(value, 'revision-1')).toBe(true)
    expect(canImportToPlaytest(run(), 'revision-1')).toBe(false)
  })

  it('节点顺序和类型判断保持稳定', () => {
    expect(nextNodeType('asset')).toBe('generation')
    expect(nextNodeType('export')).toBeNull()
    expect(isWorkflowNodeType('review')).toBe(true)
    expect(isWorkflowNodeType('unknown')).toBe(false)
  })
})
