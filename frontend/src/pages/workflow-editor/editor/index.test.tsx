// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { WORKFLOW_NODE_ORDER } from '@/entities'
import type { WorkflowRun } from '@/entities'
import { WorkflowEditor } from './index'
import type { WorkflowEditorServices } from './index'

afterEach(cleanup)

describe('WorkflowEditor', () => {
  it('把候选选择保留为生成与人工审核之间的独立阶段', () => {
    render(
      <WorkflowEditor
        runId="run-1"
        activeStage="template-candidate"
        services={createEditorServices(null)}
      />,
    )

    const stages = within(screen.getByRole('region', { name: '工作流阶段' })).getAllByRole(
      'listitem',
    )

    expect(stages).toHaveLength(8)
    expect(stages.map((stage) => stage.textContent)).toEqual([
      '1角色设置等待恢复',
      '2角色模板等待恢复',
      '3母版选择路由定位',
      '4动作设置等待恢复',
      '5动作首帧等待恢复',
      '6完整动画等待恢复',
      '7人工审核等待恢复',
      '8导出等待恢复',
    ])
    expect(screen.queryByText('系统质检')).toBeNull()
  })

  it('通过只读 Repository 恢复后端持久化的 WorkflowRun', async () => {
    const run = createRun()
    const services = createEditorServices(run)

    render(<WorkflowEditor runId={run.id} activeStage="character-setup" services={services} />)

    expect(await screen.findByText('手动制作 · 新建角色')).toBeTruthy()
    expect(screen.getByText('当前阶段：角色设置')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '完成当前步骤' }))
    expect(await screen.findByText('当前阶段：角色模板')).toBeTruthy()
  })
})

function createRun(): WorkflowRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    characterId: null,
    outfitId: null,
    purpose: 'create_character',
    driver: 'manual',
    status: 'active',
    currentRevisionId: 'revision-1',
    prompt: null,
    revisions: [
      {
        id: 'revision-1',
        basedOnRevisionId: null,
        restartNodeId: null,
        status: 'active',
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        createdAt: '2026-07-29T00:00:00.000Z',
        nodes: WORKFLOW_NODE_ORDER.map((type, index) => ({
          id: `node-${index + 1}`,
          type,
          status: index === 0 ? 'active' : 'locked',
          input: null,
          output: null,
          referenceNodeIds: [],
        })),
      },
    ],
  }
}

function createEditorServices(initialRun: WorkflowRun | null): WorkflowEditorServices {
  let run = initialRun
  return {
    workflowRuns: {
      async get() {
        return run
      },
    },
    workflowController: {
      async advance() {
        if (!run) throw new Error('工作流不存在')
        const revision = run.revisions[0]
        if (!revision) return run
        run = {
          ...run,
          revisions: [
            {
              ...revision,
              nodes: revision.nodes.map((node, index) => ({
                ...node,
                status: index === 0 ? 'passed' : index === 1 ? 'active' : node.status,
              })),
            },
          ],
        }
        return run
      },
      async runToCompletion() {
        if (!run) throw new Error('工作流不存在')
        return run
      },
    },
    productionEngine: {
      async generate() {
        throw new Error('测试未调用生成能力')
      },
      async cancelAttempt() {},
    },
    workflowRestart: {
      async restart() {
        if (!run) throw new Error('工作流不存在')
        return run
      },
    },
    imageUpload: {
      async upload() {
        throw new Error('测试未调用上传能力')
      },
    },
  }
}
