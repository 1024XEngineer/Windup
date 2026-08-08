import { describe, expect, it, vi } from 'vitest'

import type {
  Character,
  CharacterApis,
  Generation,
  GenerationApis,
  GenerationInput,
  GenerationEvent,
  MediaApis,
} from '@/entities'
import { createWorkflowRunStore } from '@/entities/workflow-run/store'
import { createWorkflowController } from '@/features/workflow-controller'
import { createQuickStartService } from './service'

function characterApis(): CharacterApis {
  const character: Character = {
    id: 'character-1',
    projectId: 'project-1',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    outfits: [
      {
        id: 'outfit-1',
        characterId: 'character-1',
        name: '默认造型',
        candidateCharacterTemplates: [],
        characterTemplateUrl: 'https://example.com/template.png',
        baseFrames: [],
        actions: [],
      },
    ],
  }
  return {
    get: vi.fn(async () => character),
    listByProject: vi.fn(async () => [character]),
    create: vi.fn(async () => character),
    update: vi.fn(async (input) => input),
    remove: vi.fn(async () => undefined),
  }
}

function createHarness() {
  const listeners = new Map<string, (event: GenerationEvent) => void>()
  let taskSequence = 0
  const store = createWorkflowRunStore()
  const createGeneration: GenerationApis['create'] = async <T extends GenerationInput>(input: T) =>
    ({
      id: `task-${++taskSequence}`,
      projectId: input.projectId,
      type: input.type,
      status: 'pending',
      result: null,
      error: null,
    }) as Generation<T['type']>
  const generationApis: GenerationApis = {
    create: vi.fn(createGeneration),
    get: vi.fn(async () => {
      throw new Error('not used')
    }),
    subscribe: vi.fn((_projectId, taskId, listener) => {
      listeners.set(taskId, listener)
      return () => listeners.delete(taskId)
    }),
  }
  const characters = characterApis()
  const mediaUpload = vi.fn(async () => 'https://example.com/uploaded.png' as never)
  const mediaApis: MediaApis = { upload: mediaUpload }
  const prepareProject = vi.fn(async () => ({
    id: 'project-1',
    spriteSize: { width: 64, height: 64 },
  }))
  const controller = createWorkflowController({
    store,
    generationApis,
    characterApis: characters,
  })
  const service = createQuickStartService({
    controller,
    prepareProject,
    characterApis: characters,
    mediaApis,
  })
  return {
    service,
    store,
    generationApis,
    prepareProject,
    mediaUpload,
    characters,
    emit(taskId: string, event: GenerationEvent) {
      const listener = listeners.get(taskId)
      if (!listener) throw new Error(`missing listener ${taskId}`)
      listener(event)
    },
  }
}

describe('createQuickStartService', () => {
  it('creates a real project-owned run and starts character image generation', async () => {
    const harness = createHarness()

    const run = await harness.service.start('  像素骑士  ')

    expect(harness.prepareProject).toHaveBeenCalledWith('像素骑士')
    expect(run).toMatchObject({ projectId: 'project-1', prompt: '像素骑士' })
    expect(run.nodes.find((node) => node.type === 'character-template')).toMatchObject({
      status: 'active',
      taskId: 'task-1',
    })
    expect(harness.generationApis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'character_image',
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    )
  })

  it('does not leave an orphan run when project creation fails', async () => {
    const harness = createHarness()
    vi.mocked(harness.prepareProject).mockRejectedValueOnce(new Error('项目服务不可用'))

    await expect(harness.service.start('像素骑士')).rejects.toThrow('项目服务不可用')
    await expect(harness.store.list()).resolves.toEqual([])
  })

  it('uploads a template, generates one first frame, then automatically selects video cropping', async () => {
    const harness = createHarness()
    const file = new File(['png'], 'template.png', { type: 'image/png' })

    const run = await harness.service.startWithUploadedTemplate(file, '挥手')

    expect(harness.mediaUpload).toHaveBeenCalledWith(file, 'reference-image', undefined)
    expect(harness.generationApis.create).toHaveBeenCalledTimes(1)
    expect(harness.generationApis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'character_action',
        numFrames: 1,
        prompt: '挥手',
        firstFrameUrl: null,
        referenceMedia: ['https://example.com/uploaded.png'],
      }),
    )
    expect(run.nodes.find((node) => node.type === 'character-template')).toMatchObject({
      status: 'passed',
      taskId: null,
    })

    harness.emit('task-1', {
      taskId: 'task-1',
      type: 'character_action',
      status: 'completed',
      error: null,
      result: {
        type: 'character_action',
        actionType: 'custom',
        frames: [{ index: 0, imageUrl: 'https://example.com/first.png', durationMs: null }],
      },
    })

    await vi.waitFor(() => expect(harness.generationApis.create).toHaveBeenCalledTimes(2))
    expect(harness.generationApis.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        numFrames: 32,
        firstFrameUrl: 'https://example.com/first.png',
      }),
    )
    const advanced = harness.service.peekWorkflow(run.id)
    expect(advanced?.nodes.find((node) => node.type === 'action-generation-method')).toMatchObject({
      status: 'passed',
      input: { method: 'video-cropping' },
    })
  })

  it('recovers character references from the backend for an older run', async () => {
    const harness = createHarness()
    const created = await harness.service.start('旧角色')

    const info = await harness.service.resolveCharacterInfo(created.id)

    expect(harness.characters.listByProject).toHaveBeenCalledWith('project-1')
    expect(info).toEqual({ characterId: 'character-1', outfitId: 'outfit-1' })
  })

  it('generates an action-specific first frame before choosing the route for an existing outfit', async () => {
    const harness = createHarness()

    const run = await harness.service.startAction(
      { characterId: 'character-1', outfitId: 'outfit-1' },
      '向右挥手',
    )

    expect(harness.generationApis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'character_action',
        numFrames: 1,
        firstFrameUrl: null,
        prompt: '向右挥手',
        referenceMedia: ['https://example.com/template.png'],
      }),
    )
    const firstFrameNode = run.nodes.find((node) => node.type === 'action-first-frame')
    expect(firstFrameNode).toMatchObject({ status: 'active', taskId: 'task-1' })

    harness.emit('task-1', {
      taskId: 'task-1',
      type: 'character_action',
      status: 'completed',
      error: null,
      result: {
        type: 'character_action',
        actionType: 'custom',
        frames: [{ index: 0, imageUrl: 'https://example.com/wave-first.png', durationMs: null }],
      },
    })

    await vi.waitFor(() => expect(harness.generationApis.create).toHaveBeenCalledTimes(2))
    expect(harness.generationApis.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        numFrames: 32,
        firstFrameUrl: 'https://example.com/wave-first.png',
      }),
    )
  })
})
