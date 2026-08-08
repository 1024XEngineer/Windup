import { describe, expect, it, vi } from 'vitest'

import {
  CHARACTER_ACTION_FRAME_COUNT,
  type Character,
  type CharacterApis,
  type Generation,
  type GenerationApis,
  type GenerationEvent,
  type GenerationInput,
  type WorkflowRun,
  type WorkflowRunStore,
} from '@/entities'
import { createWorkflowController } from '.'
import { buildPublishedActionId } from '@/features/publish'

const NOW = '2026-07-30T12:00:00.000Z'

function createStore(): WorkflowRunStore {
  const runs = new Map<string, WorkflowRun>()
  return {
    async create(input) {
      return {
        id: `run-${runs.size + 1}`,
        projectId: input.projectId,
        characterId: input.purpose === 'add_action' ? input.characterId : null,
        outfitId: input.purpose === 'add_action' ? input.outfitId : null,
        purpose: input.purpose,
        status: 'active',
        nodes: [],
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        prompt: input.prompt ?? null,
        createdAt: NOW,
      }
    },
    async get(id) {
      const run = runs.get(id)
      return run ? structuredClone(run) : null
    },
    async getByCharacter(characterId) {
      const run = [...runs.values()].find((item) => item.characterId === characterId)
      return run ? structuredClone(run) : null
    },
    async list(projectId) {
      return [...runs.values()]
        .filter((run) => !projectId || run.projectId === projectId)
        .map((run) => structuredClone(run))
    },
    async save(run) {
      runs.set(run.id, structuredClone(run))
    },
    async remove(runId) {
      runs.delete(runId)
    },
  }
}

function createHarness(characterApis?: CharacterApis) {
  const listeners = new Map<string, (event: GenerationEvent) => void>()
  const lastListeners = new Map<string, (event: GenerationEvent) => void>()
  let actionTaskSequence = 0
  const createGeneration: GenerationApis['create'] = async <T extends GenerationInput>(input: T) =>
    ({
      id: input.type === 'character_image' ? 'task-image-1' : `task-action-${++actionTaskSequence}`,
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
    subscribe: vi.fn((_projectId, taskId, onEvent) => {
      listeners.set(taskId, onEvent)
      lastListeners.set(taskId, onEvent)
      return () => listeners.delete(taskId)
    }),
  }
  const store = createStore()
  const controller = createWorkflowController({
    store,
    generationApis,
    characterApis,
    now: () => NOW,
    createId: () => 'submission-1',
  })
  return {
    controller,
    store,
    generationApis,
    emit(taskId: string, event: GenerationEvent) {
      const listener = listeners.get(taskId)
      if (!listener) throw new Error(`missing listener ${taskId}`)
      listener(event)
    },
    emitLate(taskId: string, event: GenerationEvent) {
      const listener = lastListeners.get(taskId)
      if (!listener) throw new Error(`missing historical listener ${taskId}`)
      listener(event)
    },
  }
}

describe('createWorkflowController', () => {
  it('creates and persists the frontend-owned node graph', async () => {
    const { controller, store } = createHarness()
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      prompt: 'pixel knight',
    })

    expect(run.nodes).toHaveLength(6)
    expect(run.nodes[0]).toMatchObject({
      type: 'character-setup',
      status: 'active',
    })
    expect(await store.get(run.id)).toEqual(run)
  })

  it('notifies page subscribers whenever the persisted snapshot changes', async () => {
    const { controller } = createHarness()
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
    })
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(run.id, listener)

    await controller.updateCharacterSetup(run.id, {
      description: 'revised knight',
      referenceMedia: [],
    })

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            type: 'character-setup',
            input: expect.objectContaining({ description: 'revised knight' }),
          }),
        ]),
      }),
    )
    unsubscribe()
  })

  it('rolls the page cache back when persistence fails', async () => {
    const { controller, store } = createHarness()
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
    })
    const listener = vi.fn()
    controller.subscribe(run.id, listener)
    store.save = vi.fn().mockRejectedValue(new Error('save failed'))

    await expect(
      controller.updateCharacterSetup(run.id, {
        description: 'must not appear as saved',
        referenceMedia: [],
      }),
    ).rejects.toThrow('save failed')

    expect(controller.peekWorkflow(run.id)).toEqual(run)
    expect(listener).toHaveBeenLastCalledWith(run)
  })

  it('moves from setup to candidate selection when the image task completes', async () => {
    const { controller, emit } = createHarness()
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      prompt: 'pixel knight',
    })
    await controller.nextStep(run.id, { width: 64, height: 64 })

    emit('task-image-1', {
      taskId: 'task-image-1',
      type: 'character_image',
      status: 'completed',
      error: null,
      result: {
        type: 'character_image',
        imageUrls: ['https://example.com/knight.png'],
      },
    })

    await vi.waitFor(() => {
      expect(controller.peekWorkflow(run.id)?.nodes[2]).toMatchObject({
        type: 'action-first-frame',
        status: 'active',
      })
    })
  })

  it('keeps interruption as frontend state and preserves the active node', async () => {
    const { controller } = createHarness()
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
    })

    const interrupted = await controller.interrupt(run.id)

    expect(interrupted.status).toBe('interrupted')
    expect(interrupted.nodes.filter((node) => node.status === 'active')).toHaveLength(1)
  })

  it('ignores a late generation event once interruption has entered the save queue', async () => {
    const harness = createHarness()
    const run = await harness.controller.create({
      projectId: 'project-1',
      purpose: 'add_action',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      characterTemplateUrl: 'template.png',
      baseFrameUrls: [],
    })
    await harness.controller.startActionGeneration(run.id, {
      type: 'character_action',
      projectId: 'project-1',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionType: 'walk',
      firstFrameUrl: null,
      prompt: null,
      referenceMedia: ['template.png' as never],
      numFrames: 1,
    })
    const originalSave = harness.store.save.bind(harness.store)
    let releaseInterruptedSave: (() => void) | undefined
    harness.store.save = vi.fn(async (snapshot) => {
      if (snapshot.status === 'interrupted') {
        await new Promise<void>((resolve) => {
          releaseInterruptedSave = resolve
        })
      }
      await originalSave(snapshot)
    })

    const interrupting = harness.controller.interrupt(run.id)
    await vi.waitFor(() =>
      expect(harness.controller.peekWorkflow(run.id)?.status).toBe('interrupted'),
    )
    harness.emitLate('task-action-1', {
      taskId: 'task-action-1',
      type: 'character_action',
      status: 'completed',
      error: null,
      result: {
        type: 'character_action',
        actionType: 'walk',
        frames: [{ index: 0, imageUrl: 'late.png', durationMs: null }],
      },
    })
    releaseInterruptedSave?.()
    await interrupting

    expect(harness.controller.peekWorkflow(run.id)?.status).toBe('interrupted')
    expect(
      harness.controller
        .peekWorkflow(run.id)
        ?.nodes.find((node) => node.type === 'action-first-frame'),
    ).toMatchObject({ status: 'active', output: null })
  })

  it('deduplicates concurrent character creation for one candidate', async () => {
    const character: Character = {
      id: 'character-1',
      projectId: 'project-1',
      createdAt: NOW,
      updatedAt: NOW,
      outfits: [
        {
          id: 'outfit-1',
          characterId: 'character-1',
          name: '默认造型',
          candidateCharacterTemplates: [],
          characterTemplateUrl: 'https://example.com/knight.png',
          baseFrames: [],
          actions: [],
        },
      ],
    }
    let releaseCreate: ((character: Character) => void) | undefined
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(
        () =>
          new Promise<Character>((resolve) => {
            releaseCreate = resolve
          }),
      ),
      update: vi.fn(async (updated) => updated),
      remove: vi.fn(async () => undefined),
    }
    const { controller, emit } = createHarness(characterApis)
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      prompt: 'pixel knight',
    })
    await controller.nextStep(run.id, { width: 64, height: 64 })
    emit('task-image-1', {
      taskId: 'task-image-1',
      type: 'character_image',
      status: 'completed',
      error: null,
      result: {
        type: 'character_image',
        imageUrls: ['https://example.com/knight.png'],
      },
    })
    await vi.waitFor(() => {
      expect(controller.peekWorkflow(run.id)?.nodes[2]?.status).toBe('active')
    })

    const first = controller.startActionFromTemplate(run.id, 'https://example.com/knight.png')
    const second = controller.startActionFromTemplate(run.id, 'https://example.com/knight.png')
    await vi.waitFor(() => expect(characterApis.create).toHaveBeenCalledOnce())
    releaseCreate?.(character)
    await Promise.all([first, second])

    expect(characterApis.create).toHaveBeenCalledOnce()
    expect(
      controller.peekWorkflow(run.id)?.nodes.find((node) => node.type === 'action-first-frame')
        ?.input,
    ).toMatchObject({
      numFrames: 1,
      referenceMedia: ['https://example.com/knight.png'],
    })
  })

  it('rejects an action result that is not exactly 32 frames', async () => {
    const { controller } = createHarness()
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'add_action',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      characterTemplateUrl: 'template.png',
      baseFrameUrls: [],
    })
    await controller.completeActionGeneration(run.id, {
      type: 'character_action',
      actionType: 'custom',
      frames: [{ index: 0, imageUrl: 'first.png', durationMs: null }],
    })
    await controller.selectActionGenerationMethod(run.id, 'video-cropping')
    const result = await controller.completeActionGeneration(run.id, {
      type: 'character_action',
      actionType: 'idle',
      frames: Array.from({ length: CHARACTER_ACTION_FRAME_COUNT - 1 }, (_, index) => ({
        index,
        imageUrl: `frame-${index}.png`,
        durationMs: null,
      })),
    })

    expect(result.status).toBe('failed')
    expect(result.nodes.find((node) => node.type === 'action-full-frame')).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('32 帧'),
    })
  })

  it('persists the selected generation route before full animation starts', async () => {
    const { controller } = createHarness()
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'add_action',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      characterTemplateUrl: 'template.png',
      baseFrameUrls: [],
    })
    await controller.completeActionGeneration(run.id, {
      type: 'character_action',
      actionType: 'custom',
      frames: [{ index: 0, imageUrl: 'first.png', durationMs: null }],
    })

    const selected = await controller.selectActionGenerationMethod(run.id, 'video-cropping')

    expect(selected.nodes.find((node) => node.type === 'action-generation-method')).toMatchObject({
      status: 'passed',
      input: { method: 'video-cropping' },
    })
    expect(selected.nodes.find((node) => node.type === 'action-full-frame')?.status).toBe('active')
  })

  it('starts a requested action branch while another branch is waiting for review', async () => {
    const { controller } = createHarness()
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'add_action',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      characterTemplateUrl: 'template.png',
      baseFrameUrls: [],
    })
    await controller.completeActionGeneration(run.id, {
      type: 'character_action',
      actionType: 'custom',
      frames: [{ index: 0, imageUrl: 'first.png', durationMs: null }],
    })
    await controller.selectActionGenerationMethod(run.id, 'video-cropping')
    const firstFullFrame = controller
      .peekWorkflow(run.id)!
      .nodes.find((node) => node.type === 'action-full-frame')!
    await controller.completeActionGeneration(
      run.id,
      {
        type: 'character_action',
        actionType: 'idle',
        frames: Array.from({ length: CHARACTER_ACTION_FRAME_COUNT }, (_, index) => ({
          index,
          imageUrl: `idle-${index}.png`,
          durationMs: null,
        })),
      },
      firstFullFrame.id,
    )
    const appended = await controller.appendAction(run.id)
    const secondFirstFrame = appended.nodes.find(
      (node) => node.id === `${run.id}:action-first-frame:2`,
    )!

    await controller.startActionGeneration(
      run.id,
      {
        type: 'character_action',
        projectId: 'project-1',
        characterId: 'character-1',
        outfitId: 'outfit-1',
        actionType: 'custom',
        firstFrameUrl: null,
        prompt: '挥手',
        referenceMedia: ['template.png' as never],
        numFrames: 1,
      },
      secondFirstFrame.id,
    )

    expect(
      controller.peekWorkflow(run.id)?.nodes.find((node) => node.id === secondFirstFrame.id),
    ).toMatchObject({
      status: 'active',
      taskId: 'task-action-1',
      input: { numFrames: 1, prompt: '挥手' },
    })
    expect(
      controller.peekWorkflow(run.id)?.nodes.find((node) => node.id === `${run.id}:review`),
    ).toMatchObject({ status: 'active' })
  })

  it('restores every in-flight action branch after a page refresh', async () => {
    const harness = createHarness()
    const run = await harness.controller.create({
      projectId: 'project-1',
      purpose: 'add_action',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      characterTemplateUrl: 'template.png',
      baseFrameUrls: [],
    })
    const firstNode = run.nodes.find((node) => node.type === 'action-first-frame')!
    await harness.controller.startActionGeneration(
      run.id,
      {
        type: 'character_action',
        projectId: 'project-1',
        characterId: 'character-1',
        outfitId: 'outfit-1',
        actionType: 'custom',
        firstFrameUrl: null,
        prompt: '挥手',
        referenceMedia: ['template.png' as never],
        numFrames: 1,
      },
      firstNode.id,
    )
    const appended = await harness.controller.appendAction(run.id)
    const secondNode = appended.nodes.find((node) => node.id === `${run.id}:action-first-frame:2`)!
    await harness.controller.startActionGeneration(
      run.id,
      {
        type: 'character_action',
        projectId: 'project-1',
        characterId: 'character-1',
        outfitId: 'outfit-1',
        actionType: 'custom',
        firstFrameUrl: null,
        prompt: '跳跃',
        referenceMedia: ['template.png' as never],
        numFrames: 1,
      },
      secondNode.id,
    )
    vi.mocked(harness.generationApis.get).mockImplementation(async (_projectId, taskId) => ({
      id: taskId,
      projectId: 'project-1',
      type: 'character_action',
      status: 'running',
      result: null,
      error: null,
    }))
    const restored = createWorkflowController({
      store: harness.store,
      generationApis: harness.generationApis,
    })

    await restored.resume(run.id)

    expect(harness.generationApis.get).toHaveBeenCalledWith('project-1', 'task-action-1')
    expect(harness.generationApis.get).toHaveBeenCalledWith('project-1', 'task-action-2')
  })

  it('deletes a published Action while retaining and marking its WorkflowRun branch', async () => {
    let character: Character = {
      id: 'character-1',
      projectId: 'project-1',
      createdAt: NOW,
      updatedAt: NOW,
      outfits: [
        {
          id: 'outfit-1',
          characterId: 'character-1',
          name: '默认造型',
          candidateCharacterTemplates: [],
          characterTemplateUrl: 'template.png',
          baseFrames: [],
          actions: [],
        },
      ],
    }
    const characterApis: CharacterApis = {
      get: vi.fn(async () => structuredClone(character)),
      listByProject: vi.fn(async () => [structuredClone(character)]),
      create: vi.fn(),
      update: vi.fn(async (input) => (character = structuredClone(input))),
      remove: vi.fn(async () => undefined),
    }
    const { controller } = createHarness(characterApis)
    const run = await controller.create({
      projectId: 'project-1',
      purpose: 'add_action',
      characterId: character.id,
      outfitId: 'outfit-1',
      characterTemplateUrl: 'template.png',
      baseFrameUrls: [],
    })
    await controller.completeActionGeneration(run.id, {
      type: 'character_action',
      actionType: 'custom',
      frames: [{ index: 0, imageUrl: 'first.png', durationMs: null }],
    })
    await controller.selectActionGenerationMethod(run.id, 'video-cropping')
    const fullFrameNode = controller
      .peekWorkflow(run.id)!
      .nodes.find((node) => node.type === 'action-full-frame')!
    await controller.completeActionGeneration(
      run.id,
      {
        type: 'character_action',
        actionType: 'walk',
        frames: Array.from({ length: CHARACTER_ACTION_FRAME_COUNT }, (_, index) => ({
          index,
          imageUrl: `walk-${index}.png`,
          durationMs: null,
        })),
      },
      fullFrameNode.id,
    )
    const reviewNode = controller
      .peekWorkflow(run.id)!
      .nodes.find((node) => node.type === 'review')!
    await controller.approveAndPublish(run.id, reviewNode.id)
    const actionId = buildPublishedActionId(character.id, run.id, fullFrameNode.id)

    const saved = await controller.deletePublishedAction(character.id, 'outfit-1', actionId)

    expect(saved.outfits[0]?.actions).toEqual([])
    expect(
      controller.peekWorkflow(run.id)?.nodes.find((node) => node.id === fullFrameNode.id),
    ).toMatchObject({
      status: 'passed',
      deletedAt: NOW,
      output: expect.objectContaining({ type: 'character_action' }),
    })
  })
})
