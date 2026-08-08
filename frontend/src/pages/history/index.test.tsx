/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'

import type { WorkflowRun } from '@/entities'
import type { WorkflowHistoryReader } from './index'
import { HistoryPage } from './index'

function node(
  id: string,
  status: 'locked' | 'active' | 'passed' | 'failed',
): WorkflowRun['nodes'][number] {
  // #107 合并前 main 仍是两节点联合类型；JSON 水合模拟后端即将返回的六节点契约。
  return JSON.parse(
    JSON.stringify({
      id,
      type: 'character-setup',
      status,
      phase: status === 'passed' ? 'completed' : 'configuring',
      dependsOnNodeIds: [],
      generations: [],
      error: status === 'failed' ? '生成失败' : null,
      input: { prompt: '像素骑士', referenceMedia: [] },
    }),
  ) as WorkflowRun['nodes'][number]
}

function run(id: string, projectId: string, nodes: WorkflowRun['nodes']): WorkflowRun {
  return { id, projectId, version: 3, storageStatus: 'active', nodes }
}

function reader(items: WorkflowRun[] = []): WorkflowHistoryReader {
  return { listByProject: vi.fn(async () => items) }
}

function renderHistory(source: WorkflowHistoryReader, path = '/projects/project-1/history') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectId/history" element={<HistoryPage reader={source} />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('HistoryPage', () => {
  it('只展示当前项目，并直接读取 WorkflowRun 节点图', async () => {
    const source = reader([
      run('active-run', 'project-1', [node('setup', 'active')]),
      run('foreign-run', 'project-2', [node('setup', 'passed')]),
    ])

    renderHistory(source)

    const card = await screen.findByTestId('history-run')
    expect(within(card).getByText('工作流 active-r')).toBeTruthy()
    expect(screen.queryByText('工作流 foreign-')).toBeNull()
    expect(source.listByProject).toHaveBeenCalledWith('project-1')
  })

  it('从节点状态派生进行中、失败和完成，不引入 Run 状态字段', async () => {
    renderHistory(
      reader([
        run('active-run', 'project-1', [node('setup', 'active')]),
        run('failed-run', 'project-1', [node('setup', 'failed')]),
        run('done-run', 'project-1', [node('setup', 'passed')]),
      ]),
    )

    expect(await screen.findByRole('heading', { name: '进行中' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '失败' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: '继续任务' })).toHaveLength(2)
    expect(screen.getByRole('link', { name: '查看记录' })).toBeTruthy()
  })

  it('读取失败时展示错误，不伪装为空历史', async () => {
    const source: WorkflowHistoryReader = {
      listByProject: vi.fn(async () => {
        throw new Error('历史接口暂不可用')
      }),
    }

    renderHistory(source)

    expect((await screen.findByRole('alert')).textContent).toContain('历史接口暂不可用')
    expect(screen.queryByText('还没有创作记录')).toBeNull()
  })

  it('展示动作资产生成方式节点的人类可读名称', async () => {
    const methodNode = JSON.parse(
      JSON.stringify({
        id: 'method-1',
        type: 'action-generation-method',
        status: 'active',
        phase: 'selecting',
        dependsOnNodeIds: [],
        generations: [],
        error: null,
        method: null,
      }),
    ) as WorkflowRun['nodes'][number]

    renderHistory(reader([run('route-run', 'project-1', [methodNode])]))

    expect(await screen.findByText('资产生成方式')).toBeTruthy()
  })

  it('空列表说明仍在等待后端列表接口', async () => {
    renderHistory(reader())
    expect(await screen.findByText('还没有创作记录')).toBeTruthy()
    expect(screen.getByText('History 暂未接入产品入口；后端列表接口确定后再启用。')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '新建创作任务' })).toBeNull()
  })
})
