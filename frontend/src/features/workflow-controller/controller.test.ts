/** WorkflowController 只测协调边界，WorkflowRun Service 内部流程由 Entity 自己的测试保护。 */

import { describe, expect, it, vi } from 'vitest'

import type {
  ActionFirstFrameCandidateBatch,
  CharacterCandidateBatch,
  WorkflowRun,
  WorkflowRunService,
  WorkflowRunStore,
  WorkflowStepType,
} from '@/entities'
import { createWorkflowController } from './controller'

function createRun(
  purpose: 'create_character' | 'add_action',
  activeType: WorkflowStepType,
  status: WorkflowRun['status'] = 'active',
): WorkflowRun {
  const base = {
    id: `run-${purpose}`,
    projectId: 'project-1',
    purpose,
    driver: 'ai' as const,
    status,
    currentRevisionId: 'revision-1',
    revisions: [
      {
        id: 'revision-1',
        basedOnRevisionId: null,
        restartStepId: null,
        status: status === 'completed' ? ('completed' as const) : ('active' as const),
        steps: [
          {
            id: 'step-1',
            type: activeType,
            status: status === 'active' ? ('active' as const) : ('passed' as const),
            taskId: null,
            candidateTaskIds: [],
            submissionId: null,
            error: null,
            referenceStepIds: [],
          },
        ],
        generationStatus: 'not_started' as const,
        exportStatus: 'not_exported' as const,
        createdAt: '2026-08-03T00:00:00.000Z',
      },
    ],
    prompt: '角色',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  }
  return (
    purpose === 'create_character'
      ? { ...base, purpose, characterId: null, outfitId: null, selectedAt: null }
      : {
          ...base,
          purpose,
          characterId: 'character-1',
          outfitId: 'outfit-1',
          actionId: 'action-1',
          actionName: '行走',
          actionType: 'walk',
          fps: 12,
        }
  ) as WorkflowRun
}

function createFixture(initialRuns: WorkflowRun[] = []) {
  const runs = new Map(initialRuns.map((run) => [run.id, run]))
  const store: WorkflowRunStore = {
    create: vi.fn(),
    get: vi.fn((runId) => runs.get(runId) ?? null),
    list: vi.fn(() => [...runs.values()]),
    save: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    subscribeAll: vi.fn(() => () => undefined),
  }
  const service = {
    startCharacter: vi.fn(),
    resumeCharacterCandidates: vi.fn(),
    confirmCharacter: vi.fn(),
    startAction: vi.fn(),
    resumeActionFirstFrameCandidates: vi.fn(),
    confirmActionFirstFrame: vi.fn(),
    resumeAction: vi.fn(),
    approveAction: vi.fn(),
  } as unknown as WorkflowRunService
  return { controller: createWorkflowController({ store, service }), store, service }
}

describe('createWorkflowController', () => {
  it('delegates business commands to WorkflowRun Service without saving snapshots itself', async () => {
    const { controller, store, service } = createFixture()
    const characterInput = { projectId: 'project-1', prompt: '角色', driver: 'ai' as const }
    const actionInput = {
      projectId: 'project-1',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionName: '行走',
      actionType: 'walk' as const,
      fps: 12,
      driver: 'ai' as const,
    }

    await controller.startCharacter(characterInput)
    await controller.confirmCharacter({ runId: 'character-run', selectedImageUrl: 'character.png' })
    await controller.startAction(actionInput)
    await controller.confirmActionFirstFrame({
      runId: 'action-run',
      selectedImageUrl: 'first-frame.png',
    })
    await controller.approveAction('action-run')

    expect(service.startCharacter).toHaveBeenCalledWith(characterInput)
    expect(service.confirmCharacter).toHaveBeenCalledWith({
      runId: 'character-run',
      selectedImageUrl: 'character.png',
    })
    expect(service.startAction).toHaveBeenCalledWith(actionInput)
    expect(service.confirmActionFirstFrame).toHaveBeenCalledWith({
      runId: 'action-run',
      selectedImageUrl: 'first-frame.png',
    })
    expect(service.approveAction).toHaveBeenCalledWith('action-run')
    expect(store.save).not.toHaveBeenCalled()
  })

  it('restores character candidates through the character resume use case', async () => {
    const run = createRun('create_character', 'character-template')
    const batch: CharacterCandidateBatch = {
      run,
      generationId: 'generation-1',
      candidates: ['a.png', 'b.png', 'c.png', 'd.png'],
    }
    const { controller, service } = createFixture([run])
    vi.mocked(service.resumeCharacterCandidates).mockResolvedValue(batch)

    await expect(controller.resume(run.id)).resolves.toEqual({
      phase: 'character-candidates',
      ...batch,
    })
  })

  it('restores action first-frame candidates without starting complete animation', async () => {
    const run = createRun('add_action', 'first-frame-candidate')
    const batch: ActionFirstFrameCandidateBatch = {
      run,
      candidateTaskIds: ['first-1', 'first-2', 'first-3', 'first-4'],
      candidates: ['a.png', 'b.png', 'c.png', 'd.png'],
    }
    const { controller, service } = createFixture([run])
    vi.mocked(service.resumeActionFirstFrameCandidates).mockResolvedValue(batch)

    const snapshot = await controller.resume(run.id)

    expect(snapshot).toEqual({ phase: 'action-first-frame-candidates', ...batch })
    expect(service.resumeAction).not.toHaveBeenCalled()
  })

  it('resumes complete animation through Service and returns the review phase', async () => {
    const generating = createRun('add_action', 'complete-animation')
    const reviewing = createRun('add_action', 'review')
    const { controller, service } = createFixture([generating])
    vi.mocked(service.resumeAction).mockResolvedValue(reviewing)

    await expect(controller.resume(generating.id)).resolves.toEqual({
      phase: 'action-review',
      run: reviewing,
    })
  })

  it('returns setup and terminal snapshots without invoking generation recovery', async () => {
    const setup = createRun('create_character', 'character-setup')
    const completed = createRun('add_action', 'review', 'completed')
    const { controller, service } = createFixture([setup, completed])

    await expect(controller.resume(setup.id)).resolves.toEqual({
      phase: 'character-setup',
      run: setup,
    })
    await expect(controller.resume(completed.id)).resolves.toEqual({
      phase: 'terminal',
      run: completed,
    })
    expect(service.resumeCharacterCandidates).not.toHaveBeenCalled()
    expect(service.resumeAction).not.toHaveBeenCalled()
  })

  it('delegates reads, project filtering and subscriptions to Store', () => {
    const first = createRun('create_character', 'character-setup')
    const second = { ...createRun('add_action', 'action-setup'), projectId: 'project-2' }
    const { controller, store } = createFixture([first, second])
    const listener = vi.fn()
    const listListener = vi.fn()

    expect(controller.getWorkflow(first.id)).toBe(first)
    expect(controller.listWorkflows('project-1')).toEqual([first])
    controller.subscribe(first.id, listener)
    controller.subscribeAll(listListener)

    expect(store.subscribe).toHaveBeenCalledWith(first.id, listener)
    expect(store.subscribeAll).toHaveBeenCalledWith(listListener)
  })
})
