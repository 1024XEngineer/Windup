/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'

import type { WorkflowRevision, WorkflowRun } from '@/entities'
import type { HistoryController } from './index'
import { HistoryPage } from './index'

const NOW = '2026-08-04T10:00:00.000Z'

function revision(id: string, options: Partial<WorkflowRevision> = {}): WorkflowRevision {
  return {
    id,
    basedOnRevisionId: null,
    restartStepId: null,
    status: 'active',
    steps: [
      {
        id: `${id}-setup`,
        type: 'character-setup',
        status: 'passed',
        taskId: null,
        candidateTaskIds: [],
        submissionId: null,
        error: null,
        referenceStepIds: [],
      },
      {
        id: `${id}-template`,
        type: 'character-template',
        status: 'active',
        taskId: 'generation-1',
        candidateTaskIds: [],
        submissionId: null,
        error: null,
        referenceStepIds: [],
      },
    ],
    generationStatus: 'in_progress',
    exportStatus: 'not_exported',
    createdAt: NOW,
    ...options,
  }
}

type PendingCharacterRun = Extract<WorkflowRun, { purpose: 'create_character'; characterId: null }>

function run(id: string, options: Partial<PendingCharacterRun> = {}): WorkflowRun {
  const current = revision(`${id}-revision`)
  const base: PendingCharacterRun = {
    id,
    projectId: 'project-1',
    purpose: 'create_character',
    driver: 'manual',
    status: 'active',
    currentRevisionId: current.id,
    revisions: [current],
    prompt: `任务 ${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    characterId: null,
    outfitId: null,
    selectedAt: null,
  }
  return { ...base, ...options }
}

function controller(initial: WorkflowRun[] = []): HistoryController & {
  emit(items: WorkflowRun[]): void
  unsubscribe: ReturnType<typeof vi.fn>
} {
  let listener: ((runs: WorkflowRun[]) => void) | null = null
  const unsubscribe = vi.fn()
  return {
    listWorkflows: vi.fn(() => initial),
    subscribeAll: vi.fn((nextListener) => {
      listener = nextListener
      return unsubscribe
    }),
    emit(items) {
      listener?.(items)
    },
    unsubscribe,
  }
}

function renderHistory(testController: HistoryController, path = '/projects/project-1/history') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/projects/:projectId/history"
          element={<HistoryPage controller={testController} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('HistoryPage', () => {
  it('只展示当前项目，并按更新时间从新到旧排列', () => {
    const older = run('older-run', { updatedAt: '2026-08-03T10:00:00.000Z' })
    const newer = run('newer-run', { updatedAt: '2026-08-04T11:00:00.000Z' })
    const anotherProject = run('foreign-run', { projectId: 'project-2' })
    const testController = controller([older, anotherProject, newer])

    renderHistory(testController)

    const cards = screen.getAllByTestId('history-run')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]!).getByText('任务 newer-run')).toBeTruthy()
    expect(within(cards[1]!).getByText('任务 older-run')).toBeTruthy()
    expect(screen.queryByText('任务 foreign-run')).toBeNull()
    expect(testController.listWorkflows).toHaveBeenCalledWith('project-1')
  })

  it('区分四种 Run 状态，并为活动与终态提供不同操作文案', () => {
    renderHistory(
      controller([
        run('active-run'),
        run('paused-run', { status: 'interrupted' }),
        run('failed-run', { status: 'failed' }),
        run('done-run', { status: 'completed' }),
      ]),
    )

    expect(screen.getByRole('heading', { name: '进行中' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '已中断' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '失败' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: '继续任务' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: '查看记录' })).toHaveLength(2)
  })

  it('展开 Run 后展示 Revision 来源与步骤状态', () => {
    const first = revision('revision-1', { status: 'abandoned' })
    const second = revision('revision-2', {
      basedOnRevisionId: first.id,
      restartStepId: 'character-template',
      status: 'active',
    })
    const item = run('restarted-run', {
      currentRevisionId: second.id,
      revisions: [first, second],
    })

    renderHistory(controller([item]))
    fireEvent.click(screen.getByText('查看 2 个版本'))

    expect(screen.getByText('首次执行')).toBeTruthy()
    expect(screen.getByText('基于版本 revision，从 角色候选生成 重开')).toBeTruthy()
    expect(screen.getAllByText('角色设定')).toHaveLength(2)
    expect(screen.getAllByText('已通过')).toHaveLength(2)
  })

  it('响应全局订阅但继续按项目过滤，并在卸载时取消订阅', () => {
    const testController = controller([])
    const view = renderHistory(testController)
    expect(screen.getByText('还没有创作记录')).toBeTruthy()

    act(() => {
      testController.emit([run('arrived-run'), run('foreign-run', { projectId: 'project-2' })])
    })
    expect(screen.getByText('任务 arrived-run')).toBeTruthy()
    expect(screen.queryByText('任务 foreign-run')).toBeNull()

    view.unmount()
    expect(testController.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('无效 currentRevisionId 不会让页面崩溃，而是标出待修复记录', () => {
    renderHistory(controller([run('broken-run', { currentRevisionId: 'missing-revision' })]))

    expect(
      screen.getByText('当前版本 missing-revision 不存在，这条记录需要修复后才能继续。'),
    ).toBeTruthy()
  })

  it('读取失败时展示原始错误，不伪造空历史', () => {
    const testController = controller([])
    vi.mocked(testController.listWorkflows).mockImplementation(() => {
      throw new Error('历史服务暂不可用')
    })

    renderHistory(testController)

    expect(screen.getByRole('alert').textContent).toContain('历史服务暂不可用')
    expect(screen.queryByText('还没有创作记录')).toBeNull()
  })
})
