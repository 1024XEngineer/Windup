// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

import {
  createWorkflowRunStore,
  type Generation,
  type GenerationApis,
  type GenerationEvent,
  type GenerationInput,
  type WorkflowRun,
  type WorkflowStep,
} from '@/entities'
import { createWorkflowController } from '@/features/workflow-controller'
import { QuickStartPage } from '.'
import { createQuickStartService } from './service'
import type { QuickStartService } from './service'

afterEach(cleanup)

interface HarnessOptions {
  prepareProject?: (
    prompt: string,
  ) => Promise<{ id: string; spriteSize: { width: number; height: number } }>
  createGeneration?: GenerationApis['create']
  nextStepError?: Error
}

function createHarness(options: HarnessOptions = {}) {
  const store = createWorkflowRunStore({ storage: null })
  const taskListeners = new Map<string, (event: GenerationEvent) => void>()

  const createGeneration: GenerationApis['create'] =
    options.createGeneration ??
    (async <T extends GenerationInput>(input: T) =>
      ({
        id: 'task-1',
        projectId: input.projectId,
        type: input.type,
        status: 'pending',
        result: null,
        error: null,
      }) as Generation<T['type']>)

  const generationApis: GenerationApis = {
    create: createGeneration,
    get: vi.fn(async (_projectId, taskId) => ({
      id: taskId,
      projectId: _projectId,
      type: 'character_template' as const,
      status: 'pending' as const,
      result: null,
      error: null,
    })),
    subscribe: vi.fn((projectId, taskId, onEvent) => {
      taskListeners.set(`${projectId}:${taskId}`, onEvent)
      onEvent({
        taskId,
        type: 'character_template',
        status: 'pending',
        result: null,
        error: null,
      })
      return () => {
        taskListeners.delete(`${projectId}:${taskId}`)
      }
    }),
  }

  const controller = createWorkflowController({
    store,
    generationApis,
    createId: (scope) =>
      scope === 'run' ? 'run-1' : scope === 'revision' ? 'revision-1' : 'submission-1',
    now: () => '2026-07-31T03:30:00.000Z',
  })
  if (options.nextStepError) {
    controller.nextStep = vi.fn(async () => {
      throw options.nextStepError
    })
  }
  const prepareProject =
    options.prepareProject ??
    vi.fn(async (_prompt: string) => ({ id: ' project-1 ', spriteSize: { width: 64, height: 64 } }))
  const service = createQuickStartService({ controller, prepareProject })

  return {
    prepareProject,
    service,
    store,
    emit(event: GenerationEvent) {
      const listener = taskListeners.get(`project-1:${event.taskId}`)
      if (!listener) throw new Error(`Missing listener for task ${event.taskId}`)
      listener(event)
    },
  }
}

function currentStep(run: WorkflowRun, type: WorkflowStep['type']) {
  return run.revisions[0]?.steps.find((step) => step.type === type)
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="当前路径">{location.pathname + location.search}</output>
}

function renderQuickStart(
  service: ReturnType<typeof createHarness>['service'] | QuickStartService,
  initialEntry = '/quick-start',
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/quick-start"
          element={
            <>
              <QuickStartPage service={service} />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/quick-start/:runId"
          element={
            <>
              <QuickStartPage service={service} />
              <LocationProbe />
            </>
          }
        />
        <Route path="/workflow-editor/:runId" element={<h1>工作流画布</h1>} />
        <Route path="/playtest/:characterId/:outfitId" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function submitPrompt(prompt: string) {
  fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: prompt } })
  fireEvent.click(screen.getByRole('button', { name: '开始生成' }))
}

describe('QuickStartPage', () => {
  it('creates one WorkflowRun and starts character-template without leaving Quick Start', async () => {
    const harness = createHarness()
    renderQuickStart(harness.service)

    await submitPrompt('  一位提着风灯的像素守夜人  ')

    await screen.findAllByText('正在生成角色图')
    expect(screen.getByLabelText('当前路径').textContent).toBe('/quick-start/run-1')
    expect(screen.queryByRole('heading', { name: '工作流画布' })).toBeNull()

    const run = harness.store.get('run-1')
    expect(run?.projectId).toBe('project-1')
    expect(run?.prompt).toBe('一位提着风灯的像素守夜人')
    expect(currentStep(run!, 'character-setup')?.status).toBe('passed')
    expect(currentStep(run!, 'character-template')).toMatchObject({
      status: 'active',
      taskId: 'task-1',
    })
  })

  it('does not create an orphan WorkflowRun when Project preparation fails', async () => {
    const harness = createHarness({
      prepareProject: vi.fn(async () => {
        throw new Error('项目服务暂不可用')
      }),
    })
    renderQuickStart(harness.service)

    await submitPrompt('像素守夜人')

    expect(await screen.findByText('项目服务暂不可用')).toBeTruthy()
    expect(harness.store.get('run-1')).toBeNull()
    expect(screen.getByLabelText('当前路径').textContent).toBe('/quick-start')
  })

  it('shows the saved WorkflowRun failure when generation submission fails', async () => {
    const harness = createHarness({
      createGeneration: vi.fn(async () => {
        throw new Error('生成服务未连接')
      }),
    })
    renderQuickStart(harness.service)

    await submitPrompt('像素守夜人')

    await screen.findByText('生成服务未连接')
    expect(screen.getByLabelText('当前路径').textContent).toBe('/quick-start/run-1')
    expect(harness.store.get('run-1')?.status).toBe('failed')
    expect(currentStep(harness.store.get('run-1')!, 'character-template')?.status).toBe('failed')
  })

  it('does not hide an unexpected Controller failure behind an active WorkflowRun', async () => {
    const harness = createHarness({
      nextStepError: new Error('流程内部异常'),
    })
    renderQuickStart(harness.service)

    await submitPrompt('像素守夜人')

    expect(await screen.findByText('流程内部异常')).toBeTruthy()
    expect(screen.getByLabelText('当前路径').textContent).toBe('/quick-start')
    expect(harness.store.get('run-1')?.status).toBe('active')
  })

  it('lets an uploaded template submit a blank action description and supports removing it', async () => {
    const uploadedRun = completedActionRun()
    const startWithUploadedTemplate = vi.fn(async () => uploadedRun)
    const service: QuickStartService = {
      unavailableReason: null,
      start: vi.fn(),
      startAction: vi.fn(),
      startWithUploadedTemplate,
      continueWithUploadedTemplate: vi.fn(),
      getWorkflow: vi.fn(() => uploadedRun),
      subscribe: vi.fn(() => () => undefined),
      resume: vi.fn(async () => uploadedRun),
      interrupt: vi.fn(() => uploadedRun),
      confirmCandidate: vi.fn(),
      approveReview: vi.fn(async () => uploadedRun),
      getCharacterInfo: vi.fn(() => ({ characterId: '25', outfitId: 'outfit-25-default' })),
      resolveCharacterInfo: vi.fn(),
    }
    renderQuickStart(service)
    const submit = screen.getByRole('button', { name: '开始生成' })
    const file = new File(['image'], 'hero.png', { type: 'image/png' })

    expect((submit as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('上传角色母版'), { target: { files: [file] } })
    expect(screen.getByText('hero.png')).toBeTruthy()
    expect(screen.getByText(/动作描述（可选）/)).toBeTruthy()
    expect((submit as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '移除图片' }))
    expect(screen.queryByText('hero.png')).toBeNull()
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('上传角色母版'), { target: { files: [file] } })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(startWithUploadedTemplate).toHaveBeenCalledWith(file, '', expect.any(AbortSignal)),
    )
  })

  it('renders matching task candidates on the same run without advancing the unfinished step', async () => {
    const harness = createHarness()
    renderQuickStart(harness.service)
    await submitPrompt('像素守夜人')
    await screen.findAllByText('正在生成角色图')

    harness.emit({
      taskId: 'task-1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        images: [{ url: 'https://example.com/watchman.png' }],
      },
      error: null,
    })

    await screen.findAllByText('角色图已生成')
    expect(screen.getByRole('img', { name: '角色图候选 1' }).getAttribute('src')).toBe(
      'https://example.com/watchman.png',
    )
    expect(screen.getByLabelText('当前路径').textContent).toBe('/quick-start/run-1')

    const run = harness.store.get('run-1')
    expect(currentStep(run!, 'character-template')?.status).toBe('passed')
    expect(currentStep(run!, 'template-candidate')?.status).toBe('active')
  })

  it('动作生成完成后自动发布一次并进入统一 Playtest 工作台', async () => {
    const run = completedActionRun()
    const service: QuickStartService = {
      unavailableReason: null,
      start: vi.fn(),
      startAction: vi.fn(),
      startWithUploadedTemplate: vi.fn(),
      continueWithUploadedTemplate: vi.fn(),
      getWorkflow: vi.fn(() => run),
      subscribe: vi.fn(() => () => undefined),
      resume: vi.fn(async () => run),
      interrupt: vi.fn(() => run),
      confirmCandidate: vi.fn(),
      approveReview: vi.fn(async () => ({ ...run, status: 'completed' as const })),
      getCharacterInfo: vi.fn(() => ({ characterId: '25', outfitId: 'outfit-25-default' })),
      resolveCharacterInfo: vi.fn(),
    }

    renderQuickStart(service, '/quick-start/run-1')

    await waitFor(() =>
      expect(screen.getByLabelText('当前路径').textContent).toBe(
        '/playtest/25/outfit-25-default?actionId=25-run-1',
      ),
    )
    expect(service.approveReview).toHaveBeenCalledExactlyOnceWith('run-1')
    expect(screen.queryByRole('button', { name: '一键导入 Playtest' })).toBeNull()
  })

  it('starts an action-only run for the character selected in Playtest', async () => {
    const run = completedActionRun()
    const service: QuickStartService = {
      unavailableReason: null,
      start: vi.fn(),
      startAction: vi.fn(async () => run),
      startWithUploadedTemplate: vi.fn(),
      continueWithUploadedTemplate: vi.fn(),
      getWorkflow: vi.fn(() => run),
      subscribe: vi.fn(() => () => undefined),
      resume: vi.fn(async () => run),
      interrupt: vi.fn(() => run),
      confirmCandidate: vi.fn(),
      approveReview: vi.fn(async () => run),
      getCharacterInfo: vi.fn(() => ({ characterId: '25', outfitId: 'outfit-25-default' })),
      resolveCharacterInfo: vi.fn(),
    }

    renderQuickStart(service, '/quick-start?characterId=25&outfitId=outfit-25-default')
    fireEvent.change(screen.getByLabelText('动作描述'), {
      target: { value: '挥手打招呼' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始生成新动作' }))

    await waitFor(() =>
      expect(service.startAction).toHaveBeenCalledWith(
        { characterId: '25', outfitId: 'outfit-25-default' },
        '挥手打招呼',
      ),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('当前路径').textContent).toBe('/quick-start/run-1'),
    )
  })

  it('does not describe a custom action task as idle while it is running', () => {
    const run = completedActionRun()
    const revision = run.revisions[0]!
    const actionStep = revision.steps.find((step) => step.type === 'action-generation')!
    actionStep.status = 'active'
    actionStep.output = null
    const service: QuickStartService = {
      unavailableReason: null,
      start: vi.fn(),
      startAction: vi.fn(),
      startWithUploadedTemplate: vi.fn(),
      continueWithUploadedTemplate: vi.fn(),
      getWorkflow: vi.fn(() => run),
      subscribe: vi.fn(() => () => undefined),
      resume: vi.fn(async () => run),
      interrupt: vi.fn(() => run),
      confirmCandidate: vi.fn(),
      approveReview: vi.fn(),
      getCharacterInfo: vi.fn(() => ({ characterId: '25', outfitId: 'outfit-25-default' })),
      resolveCharacterInfo: vi.fn(),
    }

    renderQuickStart(service, '/quick-start/run-1')

    expect(screen.getByText('正在生成动作帧，请稍候…')).toBeTruthy()
    expect(screen.queryByText('正在生成 idle 动作帧，请稍候…')).toBeNull()
  })
})

function completedActionRun(): WorkflowRun {
  const common = {
    taskId: null,
    submissionId: null,
    error: null,
    referenceStepIds: [],
  }
  return {
    id: 'run-1',
    projectId: '37',
    characterId: '25',
    outfitId: 'outfit-25-default',
    purpose: 'create_character',
    driver: 'ai',
    status: 'active',
    currentRevisionId: 'revision-1',
    prompt: '提着灯笼的守夜人',
    revisions: [
      {
        id: 'revision-1',
        basedOnRevisionId: null,
        restartStepId: null,
        status: 'active',
        generationStatus: 'completed',
        exportStatus: 'not_exported',
        createdAt: '2026-08-03T00:00:00.000Z',
        steps: [
          {
            ...common,
            id: 'setup',
            type: 'character-setup',
            status: 'passed',
            input: null,
            output: null,
          },
          {
            ...common,
            id: 'template',
            type: 'character-template',
            status: 'passed',
            input: null,
            output: { type: 'character_template', images: [{ url: 'character.png' }] },
          },
          {
            ...common,
            id: 'candidate',
            type: 'template-candidate',
            status: 'passed',
            input: null,
            output: null,
          },
          {
            ...common,
            id: 'action',
            type: 'action-generation',
            status: 'passed',
            input: null,
            output: {
              type: 'complete_animation',
              actionType: 'custom',
              frames: [{ url: 'frame.png', durationMs: 125 }],
            },
          },
          { ...common, id: 'review', type: 'review', status: 'active', input: null, output: null },
        ],
      },
    ],
  }
}
