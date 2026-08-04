// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ActionFirstFrameCandidateBatch,
  ActionReviewResult,
  CharacterCandidateBatch,
  PublishActionResult,
  WorkflowRun,
} from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'
import { WorkflowEditorPage } from '.'

afterEach(cleanup)

describe('WorkflowEditorPage', () => {
  it('明确提示真实 Controller 尚未装配', () => {
    renderEditor('/workflow-editor')

    expect(screen.getByRole('heading', { name: '工作流编辑器' })).toBeTruthy()
    expect(screen.getByText('工作流服务尚未装配')).toBeTruthy()
  })

  it('从空画布创建角色任务并展示四张候选', async () => {
    const batch = characterCandidates()
    const controller = createController({ startCharacter: vi.fn().mockResolvedValue(batch) })
    const onRunCreated = vi.fn()
    renderEditor('/workflow-editor', controller, { onRunCreated })

    fireEvent.change(screen.getByLabelText('项目 ID'), { target: { value: 'project-7' } })
    fireEvent.change(screen.getByLabelText('角色描述'), {
      target: { value: ' 红发机械师 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成角色候选' }))

    await screen.findByRole('button', { name: '选择角色候选 1' })
    expect(controller.startCharacter).toHaveBeenCalledWith({
      projectId: 'project-7',
      prompt: '红发机械师',
      driver: 'manual',
    })
    expect(onRunCreated).toHaveBeenCalledWith('run-character')
    expect(screen.getAllByRole('button', { name: /选择角色候选/ })).toHaveLength(4)
  })

  it('刷新后通过 Controller 恢复候选并确认角色', async () => {
    const batch = characterCandidates()
    const completed = characterRun('completed')
    const controller = createController({
      resume: vi.fn().mockResolvedValue({ phase: 'character-candidates', ...batch }),
      confirmCharacter: vi.fn().mockResolvedValue(completed),
    })
    renderEditor('/workflow-editor/run-character', controller)

    const candidate = await screen.findByRole('button', { name: '选择角色候选 2' })
    fireEvent.click(candidate)
    fireEvent.click(screen.getByRole('button', { name: '确认角色形象' }))

    await screen.findByRole('button', { name: '添加后续节点' })
    expect(controller.resume).toHaveBeenCalledWith('run-character')
    expect(controller.confirmCharacter).toHaveBeenCalledWith({
      runId: 'run-character',
      selectedImageUrl: 'https://img.test/character-2.png',
    })
  })

  it('母版加号只展示合法动作，并创建独立动作任务', async () => {
    const completed = characterRun('completed')
    const actionBatch = actionCandidates()
    const controller = createController({
      resume: vi.fn().mockResolvedValue({ phase: 'terminal', run: completed }),
      startAction: vi.fn().mockResolvedValue(actionBatch),
    })
    const onRunCreated = vi.fn()
    renderEditor('/workflow-editor/run-character', controller, { onRunCreated })

    fireEvent.click(await screen.findByRole('button', { name: '添加后续节点' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.queryByText('连接任意节点')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '行走动作' }))
    fireEvent.change(screen.getByLabelText('动作描述'), {
      target: { value: ' 步伐轻快，身体稳定 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成动作首帧' }))

    await screen.findByRole('button', { name: '选择动作首帧 1' })
    expect(controller.startAction).toHaveBeenCalledWith({
      projectId: 'project-7',
      characterId: 'character-7',
      outfitId: 'outfit-7',
      actionName: '行走',
      actionType: 'walk',
      prompt: '步伐轻快，身体稳定',
      fps: 8,
      driver: 'manual',
    })
    expect(onRunCreated).toHaveBeenCalledWith('run-action')
  })

  it('确认首帧会直接生成完整动画并进入审核', async () => {
    const batch = actionCandidates()
    const review = actionReview()
    const controller = createController({
      resume: vi.fn().mockResolvedValue({
        phase: 'action-first-frame-candidates',
        ...batch,
      }),
      confirmActionFirstFrame: vi.fn().mockResolvedValue(review),
    })
    renderEditor('/workflow-editor/run-action', controller)

    fireEvent.click(await screen.findByRole('button', { name: '选择动作首帧 3' }))
    fireEvent.click(screen.getByRole('button', { name: '确认首帧并生成完整动画' }))

    await screen.findByRole('heading', { name: '动画审核' })
    expect(controller.confirmActionFirstFrame).toHaveBeenCalledWith({
      runId: 'run-action',
      selectedImageUrl: 'https://img.test/first-frame-3.png',
    })
    expect(screen.getAllByRole('img', { name: /动画帧/ })).toHaveLength(3)
  })

  it('审核通过后使用 Controller 返回的稳定 ID 打开 Playtest', async () => {
    const review = actionReview()
    const published = publishResult()
    const controller = createController({
      resume: vi.fn().mockResolvedValue({ phase: 'action-review', ...review }),
      approveAction: vi.fn().mockResolvedValue(published),
    })
    const onOpenPlaytest = vi.fn()
    renderEditor('/workflow-editor/run-action', controller, { onOpenPlaytest })

    fireEvent.click(await screen.findByRole('button', { name: '审核通过并打开 Playtest' }))

    await waitFor(() => expect(onOpenPlaytest).toHaveBeenCalledWith(published))
    expect(controller.approveAction).toHaveBeenCalledWith('run-action')
  })

  it('生成请求进行中禁用重复提交', async () => {
    let resolveBatch!: (batch: CharacterCandidateBatch) => void
    const pending = new Promise<CharacterCandidateBatch>((resolve) => {
      resolveBatch = resolve
    })
    const controller = createController({ startCharacter: vi.fn().mockReturnValue(pending) })
    renderEditor('/workflow-editor', controller)

    fireEvent.change(screen.getByLabelText('项目 ID'), { target: { value: 'project-7' } })
    fireEvent.change(screen.getByLabelText('角色描述'), { target: { value: '机械师' } })
    const submit = screen.getByRole('button', { name: '生成角色候选' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(controller.startCharacter).toHaveBeenCalledTimes(1)
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    resolveBatch(characterCandidates())
    await screen.findByRole('button', { name: '选择角色候选 1' })
  })

  it('恢复失败后可以在原地址重试', async () => {
    const batch = characterCandidates()
    const controller = createController({
      resume: vi
        .fn()
        .mockRejectedValueOnce(new Error('任务服务暂时不可用'))
        .mockResolvedValueOnce({ phase: 'character-candidates', ...batch }),
    })
    renderEditor('/workflow-editor/run-character', controller)

    expect((await screen.findByRole('alert')).textContent).toContain('任务服务暂时不可用')
    fireEvent.click(screen.getByRole('button', { name: '重新恢复' }))

    await screen.findByRole('button', { name: '选择角色候选 1' })
    expect(controller.resume).toHaveBeenCalledTimes(2)
  })
})

interface RenderOptions {
  onRunCreated?(runId: string): void
  onOpenPlaytest?(result: PublishActionResult): void
}

function renderEditor(
  initialEntry: string,
  controller?: WorkflowController,
  options: RenderOptions = {},
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/workflow-editor"
          element={<WorkflowEditorPage controller={controller} {...options} />}
        />
        <Route
          path="/workflow-editor/:runId"
          element={<WorkflowEditorPage controller={controller} {...options} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function createController(
  overrides: Partial<WorkflowController> = {},
): WorkflowController & Record<keyof WorkflowController, ReturnType<typeof vi.fn>> {
  const controller = {
    startCharacter: vi.fn(),
    confirmCharacter: vi.fn(),
    startAction: vi.fn(),
    confirmActionFirstFrame: vi.fn(),
    approveAction: vi.fn(),
    interrupt: vi.fn(),
    getWorkflow: vi.fn().mockReturnValue(null),
    listWorkflows: vi.fn().mockReturnValue([]),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    subscribeAll: vi.fn().mockReturnValue(() => undefined),
    resume: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
  return controller as WorkflowController &
    Record<keyof WorkflowController, ReturnType<typeof vi.fn>>
}

function characterCandidates(): CharacterCandidateBatch {
  return {
    run: characterRun('active'),
    generationId: 'generation-character',
    candidates: [1, 2, 3, 4].map((index) => `https://img.test/character-${index}.png`),
  }
}

function actionCandidates(): ActionFirstFrameCandidateBatch {
  return {
    run: actionRun('first-frame-candidate'),
    candidateTaskIds: ['task-1', 'task-2', 'task-3', 'task-4'],
    candidates: [1, 2, 3, 4].map((index) => `https://img.test/first-frame-${index}.png`),
  }
}

function actionReview(): ActionReviewResult {
  return {
    run: actionRun('review'),
    generationId: 'generation-animation',
    frames: [1, 2, 3].map((index) => ({ imageUrl: `https://img.test/frame-${index}.png` })),
  }
}

function publishResult(): PublishActionResult {
  return {
    run: actionRun('completed'),
    character: {
      id: 'character-7',
      projectId: 'project-7',
      outfits: [],
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
    characterId: 'character-7',
    outfitId: 'outfit-7',
    actionId: 'action-7',
  }
}

function characterRun(status: 'active' | 'completed'): WorkflowRun {
  const steps = ['character-setup', 'character-template', 'template-candidate'] as const
  return {
    id: 'run-character',
    projectId: 'project-7',
    purpose: 'create_character',
    driver: 'manual',
    status,
    currentRevisionId: 'revision-character',
    revisions: [
      {
        id: 'revision-character',
        basedOnRevisionId: null,
        restartStepId: null,
        status: status === 'completed' ? 'completed' : 'active',
        steps: steps.map((type, index) => ({
          id: `step-character-${index}`,
          type,
          status: status === 'completed' ? 'passed' : index === 2 ? 'active' : 'passed',
          taskId: type === 'character-template' ? 'generation-character' : null,
          candidateTaskIds: [],
          submissionId: null,
          error: null,
          referenceStepIds: [],
        })),
        generationStatus: 'completed',
        exportStatus: 'not_exported',
        createdAt: '2026-08-04T00:00:00.000Z',
      },
    ],
    prompt: '红发机械师',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    characterId: status === 'completed' ? 'character-7' : null,
    outfitId: status === 'completed' ? 'outfit-7' : null,
    selectedAt: status === 'completed' ? '2026-08-04T00:01:00.000Z' : null,
  } as WorkflowRun
}

function actionRun(
  phase: 'first-frame-candidate' | 'review' | 'completed',
): Extract<WorkflowRun, { purpose: 'add_action' }> {
  const types = [
    'action-setup',
    'first-frame',
    'first-frame-candidate',
    'complete-animation',
    'review',
    'export',
  ] as const
  const activeIndex = phase === 'first-frame-candidate' ? 2 : phase === 'review' ? 4 : -1
  return {
    id: 'run-action',
    projectId: 'project-7',
    purpose: 'add_action',
    driver: 'manual',
    status: phase === 'completed' ? 'completed' : 'active',
    currentRevisionId: 'revision-action',
    revisions: [
      {
        id: 'revision-action',
        basedOnRevisionId: null,
        restartStepId: null,
        status: phase === 'completed' ? 'completed' : 'active',
        steps: types.map((type, index) => ({
          id: `step-action-${index}`,
          type,
          status:
            phase === 'completed'
              ? 'passed'
              : index < activeIndex
                ? 'passed'
                : index === activeIndex
                  ? 'active'
                  : 'locked',
          taskId: type === 'complete-animation' ? 'generation-animation' : null,
          candidateTaskIds: type === 'first-frame' ? ['task-1', 'task-2', 'task-3', 'task-4'] : [],
          submissionId: null,
          error: null,
          referenceStepIds: [],
        })),
        generationStatus: phase === 'completed' ? 'completed' : 'in_progress',
        exportStatus: phase === 'completed' ? 'exported' : 'not_exported',
        createdAt: '2026-08-04T00:00:00.000Z',
      },
    ],
    prompt: '步伐轻快，身体稳定',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    characterId: 'character-7',
    outfitId: 'outfit-7',
    actionId: 'action-7',
    actionName: '行走',
    actionType: 'walk',
    fps: 8,
  }
}
