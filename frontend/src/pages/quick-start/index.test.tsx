// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

import {
  createWorkflowRunStore,
  type Generation,
  type GenerationApis,
  type GenerationInput,
  type TaskApis,
  type TaskEvent,
  type WorkflowRun,
  type WorkflowStep,
} from '@/entities'
import { createWorkflowController } from '@/features/workflow-controller'
import { QuickStartPage } from '.'
import { createQuickStartService } from './service'

afterEach(cleanup)

interface HarnessOptions {
  prepareProject?: (prompt: string) => Promise<{ id: string }>
  createGeneration?: GenerationApis['create']
  nextStepError?: Error
}

function createHarness(options: HarnessOptions = {}) {
  const store = createWorkflowRunStore({ storage: null })
  const taskListeners = new Map<string, (event: TaskEvent) => void>()

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

  const taskApis: TaskApis = {
    get: vi.fn(async (_projectId, taskId) => ({
      id: taskId,
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
    generationApis: { create: createGeneration },
    taskApis,
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
    options.prepareProject ?? vi.fn(async (_prompt: string) => ({ id: ' project-1 ' }))
  const service = createQuickStartService({ controller, prepareProject })

  return {
    prepareProject,
    service,
    store,
    emit(event: TaskEvent) {
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
  return <output aria-label="当前路径">{useLocation().pathname}</output>
}

function renderQuickStart(service: ReturnType<typeof createHarness>['service']) {
  return render(
    <MemoryRouter initialEntries={['/quick-start']}>
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
})
