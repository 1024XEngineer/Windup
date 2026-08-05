/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkflowRun, WorkflowStep } from '@/entities'

import { WorkflowEditorPage } from './index'
import type { WorkflowEditorService } from './service'

function createCompletedRun(): WorkflowRun {
  const common = {
    status: 'passed' as const,
    taskId: null,
    submissionId: null,
    error: null,
    referenceStepIds: [],
  }
  const steps: WorkflowStep[] = [
    {
      ...common,
      id: 'revision-1:character-setup',
      type: 'character-setup',
      input: { description: '灯笼守夜人', referenceMedia: [] },
      output: null,
    },
    {
      ...common,
      id: 'revision-1:character-template',
      type: 'character-template',
      input: null,
      output: {
        type: 'character_template',
        images: [{ url: 'https://cdn.example.test/character.png' }],
      },
    },
    {
      ...common,
      id: 'revision-1:template-candidate',
      type: 'template-candidate',
      input: null,
      output: null,
    },
    {
      ...common,
      id: 'revision-1:action-generation',
      type: 'action-generation',
      input: null,
      output: {
        type: 'complete_animation',
        actionType: 'walk',
        frames: [{ url: 'https://cdn.example.test/frame-1.png', durationMs: 125 }],
      },
    },
    {
      ...common,
      id: 'revision-1:review',
      type: 'review',
      input: null,
      output: null,
    },
  ]

  return {
    id: 'run-42',
    projectId: 'project-1',
    characterId: 'character-25',
    outfitId: 'outfit-default',
    purpose: 'create_character',
    driver: 'manual',
    status: 'completed',
    currentRevisionId: 'revision-1',
    revisions: [
      {
        id: 'revision-1',
        basedOnRevisionId: null,
        restartStepId: null,
        status: 'completed',
        steps,
        generationStatus: 'completed',
        exportStatus: 'not_exported',
        createdAt: '2026-08-05T00:00:00.000Z',
      },
    ],
    prompt: '生成行走动作',
  }
}

function createService(run: WorkflowRun, approvedRun: WorkflowRun = run): WorkflowEditorService {
  return {
    unavailableReason: null,
    createRun: vi.fn(),
    getWorkflow: vi.fn(() => run),
    subscribe: vi.fn(() => () => undefined),
    resume: vi.fn(async () => run),
    nextStep: vi.fn(async () => run),
    confirmCandidate: vi.fn(async () => run),
    approveReview: vi.fn(async () => approvedRun),
    interrupt: vi.fn(() => run),
    updateCharacterSetup: vi.fn(() => run),
    continueWithUploadedTemplate: vi.fn(async () => run),
  }
}

function createCharacterSetupRun(): WorkflowRun {
  const completed = createCompletedRun()
  return {
    ...completed,
    status: 'active',
    characterId: null,
    outfitId: null,
    revisions: completed.revisions.map((revision) => ({
      ...revision,
      status: 'active',
      steps: revision.steps.map((step, index) => ({
        ...step,
        status: index === 0 ? 'active' : 'locked',
      })),
      generationStatus: 'not_started',
      exportStatus: 'not_exported',
    })),
  }
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>
}

function RunChangeButton() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/workflow-editor/run-99')}>
      切换运行
    </button>
  )
}

afterEach(cleanup)

describe('WorkflowEditor completion choice', () => {
  it('点击审核通过后先显示完成选项，不自动进入 Playtest', async () => {
    const completedRun = createCompletedRun()
    const activeRun: WorkflowRun = {
      ...completedRun,
      status: 'active',
      revisions: completedRun.revisions.map((revision) => ({
        ...revision,
        status: 'active',
        steps: revision.steps.map((step) =>
          step.type === 'review' ? { ...step, status: 'active' } : step,
        ),
      })),
    }

    render(
      <MemoryRouter initialEntries={['/workflow-editor/run-42']}>
        <Routes>
          <Route
            path="/workflow-editor/:runId"
            element={<WorkflowEditorPage service={createService(activeRun, completedRun)} />}
          />
          <Route path="/playtest/:characterId/:outfitId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '审核通过' }))

    expect(await screen.findByRole('heading', { name: '创作结果已准备好' })).toBeTruthy()
    expect(screen.getByText('审核已通过，结果已保留。请选择是否导入 Playtest。')).toBeTruthy()
    expect(screen.queryByTestId('location')).toBeNull()
  })

  it('完成后留在编辑器，只有用户点击后才导入 Playtest', () => {
    render(
      <MemoryRouter initialEntries={['/workflow-editor/run-42']}>
        <Routes>
          <Route
            path="/workflow-editor/:runId"
            element={<WorkflowEditorPage service={createService(createCompletedRun())} />}
          />
          <Route path="/playtest/:characterId/:outfitId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '创作结果已准备好' })).toBeTruthy()
    expect(screen.getByText(/不会自动跳转/)).toBeTruthy()
    expect(screen.queryByTestId('location')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '留在工作流' }))
    expect(screen.getByText('结果已保留，你可以稍后再导入 Playtest。')).toBeTruthy()
    expect(screen.queryByTestId('location')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '导入 Playtest' }))
    expect(screen.getByTestId('location').textContent).toBe(
      '/playtest/character-25/outfit-default?actionId=character-25-run-42',
    )
  })
})

describe('WorkflowEditor uploaded template shortcut', () => {
  function renderCharacterSetup(service: WorkflowEditorService) {
    return render(
      <MemoryRouter initialEntries={['/workflow-editor/run-42']}>
        <Routes>
          <Route
            path="/workflow-editor/:runId"
            element={<WorkflowEditorPage service={service} />}
          />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('submits the selected image and optional action description through the shortcut only', async () => {
    const run = createCharacterSetupRun()
    const service = createService(run)
    const shortcut = service.continueWithUploadedTemplate as ReturnType<typeof vi.fn>
    const nextStep = service.nextStep as ReturnType<typeof vi.fn>
    const updateCharacterSetup = service.updateCharacterSetup as ReturnType<typeof vi.fn>
    const { container } = renderCharacterSetup(service)
    const file = new File(['mother-template'], 'mother.png', { type: 'image/png' })

    const description = await screen.findByPlaceholderText('描述角色身份、外观和视觉风格…')
    fireEvent.change(description, { target: { value: '持剑的守夜人' } })

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).toBeTruthy()
    fireEvent.change(input!, { target: { files: [file] } })
    fireEvent.submit(input!.closest('form')!)

    expect(shortcut).toHaveBeenCalledTimes(1)
    expect(shortcut).toHaveBeenCalledWith('run-42', file, '持剑的守夜人', expect.any(AbortSignal))
    expect(nextStep).not.toHaveBeenCalled()
    expect(updateCharacterSetup).not.toHaveBeenCalled()
  })

  it('allows blank text when an image is selected', async () => {
    const run = createCharacterSetupRun()
    const service = createService(run)
    const shortcut = service.continueWithUploadedTemplate as ReturnType<typeof vi.fn>
    const { container } = renderCharacterSetup(service)
    const file = new File(['mother-template'], 'mother.png', { type: 'image/png' })

    await screen.findByPlaceholderText('描述角色身份、外观和视觉风格…')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).toBeTruthy()
    fireEvent.change(input!, { target: { files: [file] } })
    fireEvent.submit(input!.closest('form')!)

    expect(shortcut).toHaveBeenCalledWith('run-42', file, '', expect.any(AbortSignal))
  })

  it('keeps the existing description update and next-step path when no image is selected', async () => {
    const run = createCharacterSetupRun()
    const service = createService(run)
    const shortcut = service.continueWithUploadedTemplate as ReturnType<typeof vi.fn>
    const nextStep = service.nextStep as ReturnType<typeof vi.fn>
    const updateCharacterSetup = service.updateCharacterSetup as ReturnType<typeof vi.fn>
    const { container } = renderCharacterSetup(service)

    const description = await screen.findByPlaceholderText('描述角色身份、外观和视觉风格…')
    fireEvent.change(description, { target: { value: '灯笼守夜人' } })
    fireEvent.submit(container.querySelector<HTMLFormElement>('#characterSetupForm')!)

    expect(shortcut).not.toHaveBeenCalled()
    expect(updateCharacterSetup).toHaveBeenCalledWith('run-42', {
      description: '灯笼守夜人',
      referenceMedia: [],
    })
    expect(nextStep).toHaveBeenCalledWith('run-42')
  })

  it('does not render an error from a canceled, stale upload', async () => {
    const run = createCharacterSetupRun()
    let rejectFirstUpload!: (reason: unknown) => void
    const firstUpload = new Promise<WorkflowRun>((_, reject) => {
      rejectFirstUpload = reject
    })
    const secondUpload = new Promise<WorkflowRun>(() => undefined)
    const service = createService(run)
    const shortcut = service.continueWithUploadedTemplate as ReturnType<typeof vi.fn>
    shortcut.mockImplementationOnce(() => firstUpload).mockImplementationOnce(() => secondUpload)
    const { container } = renderCharacterSetup(service)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const form = input.closest('form')!

    fireEvent.change(input, {
      target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] },
    })
    fireEvent.submit(form)
    await waitFor(() => expect(shortcut).toHaveBeenCalledTimes(1))
    const firstSignal = shortcut.mock.calls[0]?.[3] as AbortSignal

    fireEvent.change(input, {
      target: { files: [new File(['second'], 'second.png', { type: 'image/png' })] },
    })
    fireEvent.submit(form)
    await waitFor(() => expect(shortcut).toHaveBeenCalledTimes(2))

    expect(firstSignal.aborted).toBe(true)
    await act(async () => {
      rejectFirstUpload(new Error('上传已取消'))
      await firstUpload.catch(() => undefined)
    })

    expect(screen.queryByText('上传已取消')).toBeNull()
  })

  it('cancels an in-flight upload when the route switches to another run', async () => {
    const run = createCharacterSetupRun()
    const pendingUpload = new Promise<WorkflowRun>(() => undefined)
    const service = createService(run)
    const shortcut = service.continueWithUploadedTemplate as ReturnType<typeof vi.fn>
    shortcut.mockImplementation(() => pendingUpload)

    const { container } = render(
      <MemoryRouter initialEntries={['/workflow-editor/run-42']}>
        <Routes>
          <Route
            path="/workflow-editor/:runId"
            element={
              <>
                <WorkflowEditorPage service={service} />
                <RunChangeButton />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!

    fireEvent.change(input, {
      target: { files: [new File(['template'], 'template.png', { type: 'image/png' })] },
    })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(shortcut).toHaveBeenCalledTimes(1))
    const signal = shortcut.mock.calls[0]?.[3] as AbortSignal

    fireEvent.click(screen.getByRole('button', { name: '切换运行' }))

    expect(signal.aborted).toBe(true)
  })
})
