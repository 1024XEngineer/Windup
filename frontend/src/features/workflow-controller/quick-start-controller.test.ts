import { describe, expect, it, vi } from 'vitest'

import type { GenerationApis, ProjectApis, WorkflowRunApis } from '@/entities'

import type { WorkflowController } from './controller'
import { createQuickStartWorkflowController } from './quick-start-controller'

function fixture() {
  let run = {
    id: 'run-1',
    projectId: 'project-1',
    version: 1,
    storageStatus: 'active' as const,
    nodes: [],
  }
  const workflowController = {
    create: vi.fn(async (input) => {
      run = { ...run, projectId: input.projectId, nodes: input.nodes }
    }),
    generateCharacterTemplate: vi.fn(async () => undefined),
    getWorkflow: vi.fn(() => structuredClone(run)),
    dispose: vi.fn(),
  } as unknown as WorkflowController
  const createController = vi.fn(() => workflowController)
  const projectApis = {
    create: vi.fn(async (input) => ({
      id: 'project-1',
      ...input,
      description: null,
      createdAt: '2026-08-19T00:00:00Z',
      updatedAt: '2026-08-19T00:00:00Z',
    })),
  } as unknown as ProjectApis
  const controller = createQuickStartWorkflowController({
    projectApis,
    workflowRunApis: {} as WorkflowRunApis,
    generationApis: {} as GenerationApis,
    createController,
    onAsyncError: vi.fn(),
  })
  return { controller, createController, projectApis, workflowController }
}

describe('createQuickStartWorkflowController', () => {
  it('rejects an empty prompt before provisioning business resources', async () => {
    const { controller, createController, projectApis } = fixture()

    await expect(controller.startCharacterGeneration({ prompt: '   ' })).rejects.toThrow(
      '请先描述想要创建的角色',
    )

    expect(projectApis.create).not.toHaveBeenCalled()
    expect(createController).not.toHaveBeenCalled()
  })

  it('provisions one project and starts one persisted character-template generation', async () => {
    const { controller, createController, projectApis, workflowController } = fixture()

    await expect(
      controller.startCharacterGeneration({ prompt: '  银发的像素骑士  ' }),
    ).resolves.toEqual({ runId: 'run-1' })

    expect(projectApis.create).toHaveBeenCalledTimes(1)
    expect(projectApis.create).toHaveBeenCalledWith({
      name: '银发的像素骑士',
      perspective: 'side',
      directionalMovement: 'single',
      spriteSize: { width: 256, height: 256 },
    })
    expect(createController).toHaveBeenCalledTimes(1)
    expect(workflowController.create).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodes: [
        {
          id: 'character-setup',
          type: 'character-setup',
          status: 'active',
          phase: 'configuring',
          dependsOnNodeIds: [],
          generations: [],
          error: null,
          input: { prompt: '银发的像素骑士', referenceMedia: [] },
        },
        {
          id: 'character-template',
          type: 'character-template',
          status: 'locked',
          phase: 'ready',
          dependsOnNodeIds: ['character-setup'],
          generations: [],
          error: null,
          selectedImageUrl: null,
        },
      ],
    })
    expect(workflowController.generateCharacterTemplate).toHaveBeenCalledTimes(1)
    expect(workflowController.generateCharacterTemplate).toHaveBeenCalledWith('character-setup', {
      spriteWidth: 256,
      spriteHeight: 256,
    })
    expect(workflowController.dispose).toHaveBeenCalledTimes(1)
  })

  it('does not retry the paid write when generation submission fails', async () => {
    const { controller, projectApis, workflowController } = fixture()
    vi.mocked(workflowController.generateCharacterTemplate).mockRejectedValueOnce(
      new Error('generation response lost'),
    )

    await expect(controller.startCharacterGeneration({ prompt: '像素骑士' })).rejects.toThrow(
      'generation response lost',
    )

    expect(projectApis.create).toHaveBeenCalledTimes(1)
    expect(workflowController.generateCharacterTemplate).toHaveBeenCalledTimes(1)
    expect(workflowController.dispose).toHaveBeenCalledTimes(1)
  })

  it('accepts a host project provisioner so other Quick Start paths can share naming policy', async () => {
    const { createController, workflowController } = fixture()
    const prepareProject = vi.fn(async () => ({
      id: 'project-shared',
      spriteSize: { width: 128, height: 96 },
    }))
    const controller = createQuickStartWorkflowController({
      prepareProject,
      workflowRunApis: {} as WorkflowRunApis,
      generationApis: {} as GenerationApis,
      createController,
      onAsyncError: vi.fn(),
    })

    await controller.startCharacterGeneration({ prompt: '  共享项目策略  ' })

    expect(prepareProject).toHaveBeenCalledWith('共享项目策略')
    expect(workflowController.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-shared' }),
    )
    expect(workflowController.generateCharacterTemplate).toHaveBeenCalledWith('character-setup', {
      spriteWidth: 128,
      spriteHeight: 96,
    })
  })
})
