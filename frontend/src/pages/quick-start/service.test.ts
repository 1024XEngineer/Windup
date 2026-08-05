import { describe, expect, it, vi } from 'vitest'

import type {
  Character,
  CharacterApis,
  Generation,
  GenerationApis,
  GenerationEvent,
  GenerationInput,
  MediaApis,
  WorkflowRun,
} from '@/entities'
import { createWorkflowRunStore } from '@/entities/workflow-run/store'
import { createWorkflowController } from '@/features/workflow-controller'
import { createQuickStartService } from './service'

function memoryStore() {
  return createWorkflowRunStore({ storage: null })
}

function makeCharacter(id: string, outfitId: string): Character {
  return {
    id,
    projectId: 'project-1',
    createdAt: '',
    updatedAt: '',
    outfits: [
      {
        id: outfitId,
        characterId: id,
        name: '默认造型',
        candidateCharacterTemplates: [],
        characterTemplateUrl: 'https://example.com/template.png',
        baseFrames: [],
        actions: [],
      },
    ],
  }
}

interface Harness {
  service: ReturnType<typeof createQuickStartService>
  store: ReturnType<typeof memoryStore>
  generationCreate: ReturnType<typeof vi.fn>
  mediaUpload: ReturnType<typeof vi.fn>
  prepareProject: ReturnType<typeof vi.fn>
  controller: ReturnType<typeof createWorkflowController>
  taskListeners: Map<string, (event: GenerationEvent) => void>
  emitTemplateComplete(taskId: string): void
}

function createHarness(
  characterApis: CharacterApis,
  options: { mediaUpload?: MediaApis['upload'] } = {},
): Harness {
  const store = memoryStore()
  const taskListeners = new Map<string, (event: GenerationEvent) => void>()
  const generationCreate = vi.fn(
    async <T extends GenerationInput>(input: T): Promise<Generation<T['type']>> =>
      ({
        id: `task-${input.type}`,
        projectId: input.projectId,
        type: input.type,
        status: 'pending',
        result: null,
        error: null,
      }) as Generation<T['type']>,
  )
  const generationApis: GenerationApis = {
    create: generationCreate,
    get: vi.fn(async () => {
      throw new Error('not used')
    }),
    subscribe: vi.fn(
      (_projectId: string, taskId: string, onEvent: (e: GenerationEvent) => void) => {
        taskListeners.set(taskId, onEvent)
        onEvent({
          taskId,
          type: 'character_template',
          status: 'pending',
          error: null,
          result: null,
        })
        return () => {
          taskListeners.delete(taskId)
        }
      },
    ),
  }
  const controller = createWorkflowController({
    store,
    generationApis,
    createId: (scope) => `id-${scope}-1`,
    now: () => '2026-07-31T12:00:00.000Z',
  })
  const prepareProject = vi.fn(async () => ({
    id: 'project-1',
    spriteSize: { width: 64, height: 64 },
  }))
  const mediaUpload = vi.fn<MediaApis['upload']>(
    options.mediaUpload ?? (async () => 'https://example.com/uploaded-template.png' as never),
  )
  const mediaApis: MediaApis = { upload: mediaUpload }
  const service = createQuickStartService({
    controller,
    prepareProject,
    characterApis,
    generationApis,
    mediaApis,
  })

  return {
    service,
    store,
    generationCreate,
    mediaUpload,
    prepareProject,
    controller,
    taskListeners,
    emitTemplateComplete(taskId) {
      const listener = taskListeners.get(taskId)
      if (!listener) throw new Error(`missing listener for ${taskId}`)
      listener({
        taskId,
        type: 'character_template',
        status: 'completed',
        error: null,
        result: {
          type: 'character_template',
          images: [{ url: 'https://example.com/candidate.png' }],
        },
      })
    },
  }
}

async function advanceToCandidate(harness: Harness): Promise<WorkflowRun> {
  const run = await harness.service.start('测试角色')
  const revision = run.revisions.find((r) => r.id === run.currentRevisionId)!
  const templateStep = revision.steps.find((s) => s.type === 'character-template')!
  harness.emitTemplateComplete(templateStep.taskId!)
  return run
}

describe('createQuickStartService export recovery', () => {
  it('resolves character info from the backend when the run predates persistence', async () => {
    const character = makeCharacter('42', 'outfit-42-default')
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(async () => character),
      update: vi.fn(async (input) => input),
      remove: vi.fn(async () => undefined),
    }
    const { service, store } = createHarness(characterApis)
    const run: WorkflowRun = {
      id: 'run-legacy',
      projectId: 'project-1',
      characterId: null,
      outfitId: null,
      purpose: 'create_character',
      driver: 'ai',
      status: 'active',
      currentRevisionId: 'revision-1',
      prompt: '旧角色',
      revisions: [],
    }
    store.save(run)

    // 内存 Map 无记录、run 无持久化引用 → 从后端按项目反查
    const info = await service.resolveCharacterInfo('run-legacy')

    expect(characterApis.listByProject).toHaveBeenCalledWith('project-1')
    expect(info).toEqual({ characterId: '42', outfitId: 'outfit-42-default' })
  })

  it('returns null when the project has no characters at all', async () => {
    const characterApis: CharacterApis = {
      get: vi.fn(async () => {
        throw new Error('not found')
      }),
      listByProject: vi.fn(async () => []),
      create: vi.fn(async () => {
        throw new Error('not used')
      }),
      update: vi.fn(async () => {
        throw new Error('not used')
      }),
      remove: vi.fn(async () => undefined),
    }
    const { service, store } = createHarness(characterApis)
    const run: WorkflowRun = {
      id: 'run-empty',
      projectId: 'project-1',
      characterId: null,
      outfitId: null,
      purpose: 'create_character',
      driver: 'ai',
      status: 'active',
      currentRevisionId: 'revision-1',
      prompt: '空项目',
      revisions: [],
    }
    store.save(run)

    const info = await service.resolveCharacterInfo('run-empty')

    expect(info).toBeNull()
  })
})

describe('createQuickStartService action generation', () => {
  it('uploads a template before creating a run, then starts one custom action without a character-template task', async () => {
    const character = makeCharacter('42', 'outfit-42-default')
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(async () => character),
      update: vi.fn(async (input) => input),
      remove: vi.fn(async () => undefined),
    }
    const harness = createHarness(characterApis)
    const file = { name: ' uploaded-hero.png ' } as File
    const abortController = new AbortController()

    const started = await harness.service.startWithUploadedTemplate(
      file,
      '  挥手打招呼  ',
      abortController.signal,
    )

    expect(harness.prepareProject).toHaveBeenCalledWith('挥手打招呼')
    expect(harness.mediaUpload).toHaveBeenCalledWith(
      file,
      'reference-image',
      abortController.signal,
    )
    expect(harness.generationCreate).toHaveBeenCalledTimes(1)
    expect(harness.generationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'complete_animation',
        actionType: 'custom',
        prompt: '挥手打招呼',
        firstFrameUrl: 'https://example.com/uploaded-template.png',
      }),
    )
    expect(harness.generationCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'character_template' }),
    )
    expect(
      started.revisions[0]?.steps.find((step) => step.type === 'template-candidate'),
    ).toMatchObject({ status: 'passed' })
  })

  it('uses an idle action for a blank uploaded-template description', async () => {
    const character = makeCharacter('42', 'outfit-42-default')
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(async () => character),
      update: vi.fn(async (input) => input),
      remove: vi.fn(async () => undefined),
    }
    const harness = createHarness(characterApis)
    const started = await harness.service.startWithUploadedTemplate(
      { name: 'hero.png' } as File,
      '   ',
    )

    expect(started.prompt).toBeNull()
    expect(harness.generationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'complete_animation',
        actionType: 'idle',
        prompt: null,
      }),
    )
  })

  it('does not create or advance a run when the upload fails', async () => {
    const character = makeCharacter('42', 'outfit-42-default')
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(async () => character),
      update: vi.fn(async (input) => input),
      remove: vi.fn(async () => undefined),
    }
    const harness = createHarness(characterApis, {
      mediaUpload: vi.fn(async () => {
        throw new Error('上传失败')
      }),
    })

    await expect(
      harness.service.startWithUploadedTemplate({ name: 'hero.png' } as File, '挥手'),
    ).rejects.toThrow('上传失败')

    expect(harness.store.get('id-run-1')).toBeNull()
    expect(harness.generationCreate).not.toHaveBeenCalled()
    expect(characterApis.create).not.toHaveBeenCalled()

    const existing = harness.controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      driver: 'ai',
      prompt: '已有运行',
    })
    await expect(
      harness.service.continueWithUploadedTemplate(existing.id, { name: 'hero.png' } as File, ''),
    ).rejects.toThrow('上传失败')
    expect(
      harness.store
        .get(existing.id)
        ?.revisions[0]?.steps.find((step) => step.type === 'character-setup')?.status,
    ).toBe('active')
  })

  it('adds a new custom action to the existing outfit without replacing another custom action', async () => {
    const character = makeCharacter('42', 'outfit-42-default')
    character.outfits[0]!.actions.push({
      id: '42-older-run',
      outfitId: 'outfit-42-default',
      name: '画画',
      kind: 'custom',
      type: 'custom',
      fps: 8,
      keyFrameIndex: 0,
      frames: [{ imageUrl: 'https://example.com/old.png', durationMs: 125, rootMotion: null }],
    })
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(async () => character),
      update: vi.fn(async (input) => input),
      remove: vi.fn(async () => undefined),
    }
    const harness = createHarness(characterApis)

    const started = await harness.service.startAction(
      { characterId: '42', outfitId: 'outfit-42-default' },
      '挥手打招呼',
    )

    expect(started.purpose).toBe('add_action')
    expect(characterApis.create).not.toHaveBeenCalled()
    expect(harness.generationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'complete_animation',
        characterId: '42',
        outfitId: 'outfit-42-default',
        actionType: 'custom',
        prompt: '挥手打招呼',
      }),
    )

    harness.taskListeners.get('task-complete_animation')?.({
      taskId: 'task-complete_animation',
      type: 'complete_animation',
      status: 'completed',
      error: null,
      result: {
        type: 'complete_animation',
        actionType: 'custom',
        frames: [{ url: 'https://example.com/new.png', durationMs: 125 }],
      },
    })
    await harness.service.approveReview(started.id)

    const saved = vi.mocked(characterApis.update).mock.calls[0]?.[0]
    expect(saved?.outfits[0]?.actions.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: '42-older-run', name: '画画' },
      { id: '42-id-run-1', name: '挥手打招呼' },
    ])
  })

  it('does not enter action generation before character preparation can be persisted', async () => {
    const character = makeCharacter('42', 'outfit-42-default')
    let resolveCharacter!: (value: Character) => void
    const pendingCharacter = new Promise<Character>((resolve) => {
      resolveCharacter = resolve
    })
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(() => pendingCharacter),
      update: vi.fn(async (input) => input),
      remove: vi.fn(async () => undefined),
    }
    const harness = createHarness(characterApis)
    await advanceToCandidate(harness)

    const confirmation = harness.service.confirmCandidate(
      'id-run-1',
      'https://example.com/candidate.png',
    )
    const waiting = harness.service.getWorkflow('id-run-1')!
    const waitingRevision = waiting.revisions.find((item) => item.id === waiting.currentRevisionId)!
    expect(waitingRevision.steps.find((item) => item.type === 'template-candidate')?.status).toBe(
      'active',
    )
    expect(waitingRevision.steps.find((item) => item.type === 'action-generation')?.status).toBe(
      'locked',
    )

    resolveCharacter(character)
    const confirmed = await confirmation
    const confirmedRevision = confirmed.revisions.find(
      (item) => item.id === confirmed.currentRevisionId,
    )!
    expect(confirmedRevision.steps.find((item) => item.type === 'action-generation')).toMatchObject(
      { status: 'active', taskId: 'task-complete_animation' },
    )
  })

  it('submits a complete_animation task after candidate confirmation', async () => {
    const character = makeCharacter('42', 'outfit-42-default')
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(async () => character),
      update: vi.fn(async (input) => input),
      remove: vi.fn(async () => undefined),
    }
    const harness = createHarness(characterApis)
    await advanceToCandidate(harness)
    harness.generationCreate.mockClear()

    await harness.service.confirmCandidate('id-run-1', 'https://example.com/candidate.png')

    const actionCalls = harness.generationCreate.mock.calls.map(([input]) => input)
    const animationInput = actionCalls.find((input) => input?.type === 'complete_animation')
    expect(animationInput).toMatchObject({
      type: 'complete_animation',
      projectId: 'project-1',
      characterId: '42',
      outfitId: 'outfit-42-default',
      actionType: 'idle',
      firstFrameUrl: 'https://example.com/candidate.png',
    })
  })

  it('keeps all generated frames in the run and publishes only after approval', async () => {
    const character = makeCharacter('42', 'outfit-42-default')
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(async () => character),
      update: vi.fn(async (input) => input),
      remove: vi.fn(async () => undefined),
    }
    const harness = createHarness(characterApis)
    await advanceToCandidate(harness)
    await harness.service.confirmCandidate('id-run-1', 'https://example.com/candidate.png')

    const listener = harness.taskListeners.get('task-complete_animation')
    expect(listener).toBeDefined()
    listener?.({
      taskId: 'task-complete_animation',
      type: 'complete_animation',
      status: 'completed',
      error: null,
      result: {
        type: 'complete_animation',
        actionType: 'idle',
        frames: Array.from({ length: 16 }, (_, index) => ({
          url: `https://example.com/frame-${index}.png`,
          durationMs: 100 + index,
        })),
      },
    })

    expect(characterApis.update).not.toHaveBeenCalled()
    const beforeApproval = harness.service.getWorkflow('id-run-1')!
    const revision = beforeApproval.revisions.find(
      (item) => item.id === beforeApproval.currentRevisionId,
    )!
    const actionStep = revision.steps.find((item) => item.type === 'action-generation')
    expect(actionStep?.output?.frames).toHaveLength(16)

    vi.mocked(characterApis.update).mockImplementationOnce(async (input) => {
      expect(harness.service.getWorkflow('id-run-1')?.status).toBe('completed')
      return input
    })
    const approved = await harness.service.approveReview('id-run-1')

    expect(approved.status).toBe('completed')
    const published = vi.mocked(characterApis.update).mock.calls[0]?.[0]
    expect(published?.outfits[0]?.actions[0]?.frames).toHaveLength(16)
  })
})
