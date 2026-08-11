import { describe, expect, it, vi } from 'vitest'

import type {
  Character,
  CharacterApis,
  GenerationApis,
  MediaReference,
  ProjectApis,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import {
  createAutoPrepareProject,
  createQuickStartService,
  createRealQuickStartService,
  unavailableQuickStartService,
  type QuickStartFrame,
  type QuickStartMediaApis,
  type QuickStartService,
} from './service'

type QuickStartServiceWithFirstFrame = QuickStartService & {
  getFirstFrameCandidates(runId: string): Promise<readonly QuickStartFrame[]>
  confirmFirstFrame(runId: string, selectedImageUrl: string): Promise<WorkflowRun>
}

function createWorkflowRunApis(initialRuns: readonly WorkflowRun[] = []): WorkflowRunApis {
  let version = 0
  const runs = new Map(initialRuns.map((run) => [run.id, structuredClone(run)]))
  return {
    async create(input) {
      const run: WorkflowRun = {
        id: 'run-1',
        projectId: input.projectId,
        version: ++version,
        storageStatus: 'active',
        nodes: structuredClone(input.nodes),
      }
      runs.set(run.id, run)
      return structuredClone(run)
    },
    async listByProject(projectId) {
      const items = [...runs.values()].filter((run) => run.projectId === projectId)
      return { items: structuredClone(items), total: items.length, page: 1, pageSize: 100 }
    },
    async get(id) {
      const run = runs.get(id)
      if (!run) throw new Error('not found')
      return structuredClone(run)
    },
    async update(run) {
      const saved = { ...structuredClone(run), version: ++version }
      runs.set(saved.id, saved)
      return structuredClone(saved)
    },
    async remove(id) {
      runs.delete(id)
    },
  }
}

describe('createQuickStartService', () => {
  it('rejects empty input and exposes only unavailable fallbacks without fabricating data', async () => {
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis: {
        create: vi.fn(),
        get: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      prepareProject: vi.fn(),
    })

    await expect(service.start('   ')).rejects.toThrow('请先描述')
    expect(service.peekWorkflow('missing')).toBeNull()
    expect(service.getCharacterInfo('missing')).toBeNull()
    await expect(service.getFirstFrameCandidates('missing')).rejects.toThrow('not found')

    expect(unavailableQuickStartService.peekWorkflow('run')).toBeNull()
    expect(unavailableQuickStartService.subscribe('run', vi.fn())()).toBeUndefined()
    await expect(unavailableQuickStartService.resume('run')).resolves.toBeNull()
    await expect(unavailableQuickStartService.interrupt('run')).resolves.toBeNull()
    await expect(unavailableQuickStartService.getFirstFrameCandidates('run')).resolves.toEqual([])
    await expect(unavailableQuickStartService.getTemplateCandidates('run')).resolves.toEqual([])
    await expect(unavailableQuickStartService.getActionFrames('run')).resolves.toEqual([])
    expect(unavailableQuickStartService.getCharacterInfo('run')).toBeNull()
    await expect(unavailableQuickStartService.resolveCharacterInfo('run')).resolves.toBeNull()
    for (const request of [
      unavailableQuickStartService.start('hero'),
      unavailableQuickStartService.startWithUploadedTemplate(new File([], 'hero.png'), ''),
      unavailableQuickStartService.continueWithUploadedTemplate(
        'run',
        new File([], 'hero.png'),
        '',
      ),
      unavailableQuickStartService.startAction(
        { characterId: 'character', outfitId: 'outfit' },
        'walk',
      ),
      unavailableQuickStartService.confirmCandidate('run', 'candidate'),
      unavailableQuickStartService.confirmFirstFrame('run', 'frame'),
      unavailableQuickStartService.approveReview('run'),
    ]) {
      await expect(request).rejects.toThrow(unavailableQuickStartService.unavailableReason!)
    }
  })

  it('creates a bounded default project name and returns the persisted sprite size', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    const create = vi.fn(async (input) => ({
      id: 'project-1',
      ...input,
      description: null,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-11T00:00:00Z',
    }))
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await expect(prepare('一位名字特别长的像素角色设定用于验证截断')).resolves.toEqual({
      id: 'project-1',
      spriteSize: { width: 256, height: 256 },
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^一位名字特别长的像素角色设定用于…-/u),
        perspective: 'side',
        directionalMovement: 'single',
      }),
    )
    vi.restoreAllMocks()
  })

  it('creates one persisted node graph and starts the character image task', async () => {
    const generationApis: GenerationApis = {
      create: vi.fn(async () => ({
        id: 'task-template',
        projectId: 'project-1',
        type: 'character_template' as const,
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      get: vi.fn(async () => ({
        id: 'task-template',
        projectId: 'project-1',
        type: 'character_template' as const,
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      subscribe: vi.fn(() => () => undefined),
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
    })

    const run = await service.start('像素骑士')

    expect(run.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'character-setup', status: 'passed' }),
        expect.objectContaining({
          type: 'character-template',
          phase: 'generating',
          generations: [{ taskId: 'task-template', role: 'character_template' }],
        }),
      ]),
    )
    expect(generationApis.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'character_template', spriteWidth: 256, spriteHeight: 256 }),
    )
  })

  it('uploads a template, persists the character tree, and appends another action to it', async () => {
    let taskSequence = 0
    const taskTypes = new Map<string, 'first_frame' | 'complete_animation' | 'character_template'>()
    const generationApis: GenerationApis = {
      create: vi.fn(async (input) => {
        const id = `task-${++taskSequence}`
        taskTypes.set(id, input.type)
        return {
          id,
          projectId: input.projectId,
          type: input.type,
          status: 'pending' as const,
          result: null,
          error: null,
        }
      }),
      get: vi.fn(async (projectId, id) => ({
        id,
        projectId,
        type: taskTypes.get(id)!,
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      subscribe: vi.fn(() => () => undefined),
    }
    let savedCharacter: Character = {
      id: 'character-1',
      projectId: 'project-1',
      workflowRunId: 'run-1',
      name: '像素骑士',
      description: '挥手',
      referenceImageUrl: 'https://example.test/template.png',
      dataVersion: 1,
      status: 1,
      outfits: [],
    }
    const characterApis: CharacterApis = {
      get: vi.fn(async () => structuredClone(savedCharacter)),
      listByProject: vi.fn(async () => ({
        items: [structuredClone(savedCharacter)],
        total: 1,
        page: 1,
        pageSize: 20,
      })),
      create: vi.fn(async () => structuredClone(savedCharacter)),
      update: vi.fn(async (character) => {
        savedCharacter = structuredClone(character)
        return structuredClone(savedCharacter)
      }),
      remove: vi.fn(async () => undefined),
    }
    const mediaApis: QuickStartMediaApis = {
      upload: vi.fn(async () => 'https://example.test/template.png' as MediaReference),
    }
    const workflowRunApis = createWorkflowRunApis()
    const service = createQuickStartService({
      workflowRunApis,
      generationApis,
      characterApis,
      mediaApis,
      prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
      onAsyncError: vi.fn(),
    })
    const file = new File(['pixels'], 'hero.png', { type: 'image/png' })

    const firstRun = await service.startWithUploadedTemplate(file, '挥手')

    expect(mediaApis.upload).toHaveBeenCalledWith(file, 'reference-image', undefined)
    expect(characterApis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        workflowRunId: 'run-1',
        referenceImageUrl: 'https://example.test/template.png',
      }),
    )
    expect(savedCharacter.outfits).toHaveLength(1)
    expect(firstRun.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'character-setup', status: 'passed' }),
        expect.objectContaining({ type: 'action-first-frame', phase: 'generating' }),
      ]),
    )
    expect(service.getCharacterInfo(firstRun.id)).toEqual({
      characterId: 'character-1',
      outfitId: savedCharacter.outfits[0]!.id,
    })

    const secondRun = await service.startAction(
      { characterId: 'character-1', outfitId: savedCharacter.outfits[0]!.id },
      '跳跃',
    )
    expect(secondRun.id).toBe(firstRun.id)
    expect(secondRun.nodes.filter((node) => node.type === 'action-first-frame')).toHaveLength(2)
    expect(generationApis.create).toHaveBeenCalledTimes(2)
  })

  it('preserves backend frame metadata while approving and importing a completed action', async () => {
    const run: WorkflowRun = {
      id: 'run-complete',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: [
        {
          id: 'character-setup',
          type: 'character-setup',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: [],
          generations: [],
          error: null,
          input: { characterId: 'character-1', prompt: '像素骑士', referenceMedia: [] },
        },
        {
          id: 'character-template',
          type: 'character-template',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['character-setup'],
          generations: [{ taskId: 'task-template', role: 'character_template' }],
          error: null,
          selectedImageUrl: 'template.png',
        },
        {
          id: 'action-first',
          type: 'action-first-frame',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['character-template'],
          generations: [],
          error: null,
          input: { outfitId: 'outfit-1', name: '挥手', type: 'custom', prompt: '挥手', fps: 12 },
          selectedFirstFrameUrl: 'first.png',
        },
        {
          id: 'action-full',
          type: 'action-full-frame',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['action-first'],
          generations: [{ taskId: 'task-animation', role: 'complete_animation' }],
          error: null,
        },
        {
          id: 'review',
          type: 'review',
          status: 'active',
          phase: 'reviewing',
          dependsOnNodeIds: ['action-full'],
          generations: [],
          error: null,
        },
      ],
    }
    const frames = [
      { index: 7, url: 'frame-7.png', durationMs: 83 },
      { index: 9, url: 'frame-9.png', durationMs: null },
    ]
    const generationApis: GenerationApis = {
      create: vi.fn(),
      get: vi.fn(async (_projectId, id) => {
        if (id === 'task-template') {
          return {
            id,
            projectId: 'project-1',
            type: 'character_template' as const,
            status: 'completed' as const,
            result: { type: 'character_template' as const, images: [{ url: 'template.png' }] },
            error: null,
          }
        }
        return {
          id,
          projectId: 'project-1',
          type: 'complete_animation' as const,
          status: 'completed' as const,
          result: { type: 'complete_animation' as const, frames },
          error: null,
        }
      }),
      subscribe: vi.fn(() => () => undefined),
    }
    let character: Character = {
      id: 'character-1',
      projectId: 'project-1',
      workflowRunId: run.id,
      name: '像素骑士',
      description: null,
      referenceImageUrl: 'template.png',
      dataVersion: 1,
      status: 1,
      outfits: [
        {
          id: 'outfit-1',
          characterId: 'character-1',
          name: '默认造型',
          description: null,
          previewUrl: 'template.png',
          actions: [],
        },
      ],
    }
    const characterApis = {
      get: vi.fn(async () => structuredClone(character)),
      update: vi.fn(async (next: Character) => {
        character = structuredClone(next)
        return structuredClone(character)
      }),
      listByProject: vi.fn(async () => ({ items: [character], total: 1, page: 1, pageSize: 20 })),
      create: vi.fn(),
      remove: vi.fn(),
    } as unknown as CharacterApis
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      characterApis,
      prepareProject: vi.fn(),
    })

    await service.resume(run.id)
    await expect(service.getTemplateCandidates(run.id)).resolves.toEqual(['template.png'])
    await expect(service.getActionFrames(run.id)).resolves.toEqual([
      { index: 7, imageUrl: 'frame-7.png', durationMs: 83 },
      { index: 9, imageUrl: 'frame-9.png', durationMs: null },
    ])
    await service.approveReview(run.id)

    expect(character.outfits[0]!.actions[0]!.frames).toEqual([
      { index: 7, imageUrl: 'frame-7.png', durationMs: 83 },
      { index: 9, imageUrl: 'frame-9.png', durationMs: null },
    ])
  })

  it('continues from an uploaded replacement and restores missing character info from project assets', async () => {
    const candidateRun: WorkflowRun = {
      id: 'run-candidate',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: [
        {
          id: 'character-setup',
          type: 'character-setup',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: [],
          generations: [],
          error: null,
          input: { prompt: '像素骑士', referenceMedia: [] },
        },
        {
          id: 'character-template',
          type: 'character-template',
          status: 'active',
          phase: 'selecting',
          dependsOnNodeIds: ['character-setup'],
          generations: [{ taskId: 'template-task', role: 'character_template' }],
          error: null,
          selectedImageUrl: null,
        },
      ],
    }
    const taskTypes = new Map<string, 'first_frame' | 'complete_animation' | 'character_template'>()
    let taskId = 0
    const generationApis: GenerationApis = {
      create: vi.fn(async (input) => {
        const id = `continued-task-${++taskId}`
        taskTypes.set(id, input.type)
        return {
          id,
          projectId: input.projectId,
          type: input.type,
          status: 'pending' as const,
          result: null,
          error: null,
        }
      }),
      get: vi.fn(async (projectId, id) => ({
        id,
        projectId,
        type: taskTypes.get(id) ?? 'character_template',
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      subscribe: vi.fn(() => () => undefined),
    }
    let character: Character = {
      id: 'character-restore',
      projectId: 'project-1',
      workflowRunId: candidateRun.id,
      name: '像素骑士',
      description: null,
      referenceImageUrl: 'replacement.png',
      dataVersion: 1,
      status: 1,
      outfits: [],
    }
    const characterApis: CharacterApis = {
      get: vi.fn(async () => structuredClone(character)),
      listByProject: vi.fn(async () => ({
        items: [structuredClone(character)],
        total: 1,
        page: 1,
        pageSize: 20,
      })),
      create: vi.fn(async () => structuredClone(character)),
      update: vi.fn(async (next) => {
        character = structuredClone(next)
        return structuredClone(character)
      }),
      remove: vi.fn(async () => undefined),
    }
    const workflowRunApis = createWorkflowRunApis([candidateRun])
    const service = createQuickStartService({
      workflowRunApis,
      generationApis,
      characterApis,
      mediaApis: { upload: vi.fn(async () => 'replacement.png' as MediaReference) },
      prepareProject: vi.fn(),
    })

    const continued = await service.continueWithUploadedTemplate(
      candidateRun.id,
      new File(['replacement'], 'replacement.png', { type: 'image/png' }),
      '',
    )
    expect(continued.nodes.find((node) => node.type === 'character-setup')).toMatchObject({
      input: { characterId: 'character-restore' },
    })
    expect(continued.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'action-first-frame', phase: 'generating' }),
      ]),
    )
    const listener = vi.fn()
    const stop = service.subscribe(candidateRun.id, listener)
    await Promise.resolve()
    stop()
    await service.interrupt(candidateRun.id)

    const recoveryService = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([candidateRun]),
      generationApis,
      characterApis,
      prepareProject: vi.fn(),
    })
    await recoveryService.resume(candidateRun.id)
    await expect(recoveryService.resolveCharacterInfo(candidateRun.id)).resolves.toEqual({
      characterId: 'character-restore',
      outfitId: character.outfits[0]!.id,
    })
  })

  it('deduplicates candidate confirmation while creating and binding its character asset', async () => {
    const tasks = new Map<string, Awaited<ReturnType<GenerationApis['create']>>>()
    let sequence = 0
    const generationApis: GenerationApis = {
      create: vi.fn(async (input) => {
        const id = `candidate-task-${++sequence}`
        const task =
          input.type === 'character_template'
            ? {
                id,
                projectId: input.projectId,
                type: 'character_template' as const,
                status: 'completed' as const,
                result: {
                  type: 'character_template' as const,
                  images: [{ url: 'candidate.png' }],
                },
                error: null,
              }
            : {
                id,
                projectId: input.projectId,
                type: input.type,
                status: 'pending' as const,
                result: null,
                error: null,
              }
        tasks.set(id, task)
        return task
      }),
      get: vi.fn(async (_projectId, id) => tasks.get(id)!),
      subscribe: vi.fn(() => () => undefined),
    }
    let character: Character = {
      id: 'candidate-character',
      projectId: 'project-1',
      workflowRunId: 'run-1',
      name: '候选角色',
      description: '像素骑士',
      referenceImageUrl: 'candidate.png',
      dataVersion: 1,
      status: 1,
      outfits: [],
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      characterApis: {
        create: vi.fn(async () => structuredClone(character)),
        update: vi.fn(async (next: Character) => {
          character = structuredClone(next)
          return structuredClone(character)
        }),
        get: vi.fn(async () => structuredClone(character)),
        listByProject: vi.fn(),
        remove: vi.fn(),
      } as unknown as CharacterApis,
      prepareProject: vi.fn(async () => ({
        id: 'project-1',
        spriteSize: { width: 256, height: 256 },
      })),
    })
    const started = await service.start('像素骑士')
    await vi.waitFor(async () => {
      await expect(service.getTemplateCandidates(started.id)).resolves.toEqual(['candidate.png'])
    })

    const first = service.confirmCandidate(started.id, 'candidate.png', '挥手')
    const duplicate = service.confirmCandidate(started.id, 'candidate.png', '挥手')
    expect(duplicate).toBe(first)
    await first

    expect(character.outfits).toHaveLength(1)
    expect(service.getCharacterInfo(started.id)?.characterId).toBe('candidate-character')
  })

  it('creates a fresh run when an existing character has no workflow history', async () => {
    const character: Character = {
      id: 'character-existing',
      projectId: 'project-1',
      workflowRunId: 'old-run',
      name: '老角色',
      description: null,
      referenceImageUrl: 'existing.png',
      dataVersion: 1,
      status: 1,
      outfits: [
        {
          id: 'outfit-existing',
          characterId: 'character-existing',
          name: '默认造型',
          description: null,
          previewUrl: 'existing.png',
          actions: [],
        },
      ],
    }
    const generationApis: GenerationApis = {
      create: vi.fn(async (input) => ({
        id: 'new-first-frame-task',
        projectId: input.projectId,
        type: input.type,
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      get: vi.fn(async (projectId, id) => ({
        id,
        projectId,
        type: 'first_frame' as const,
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      subscribe: vi.fn(() => () => undefined),
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      characterApis: {
        get: vi.fn(async () => character),
        listByProject: vi.fn(async () => ({ items: [character], total: 1, page: 1, pageSize: 20 })),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      } as unknown as CharacterApis,
      prepareProject: vi.fn(),
    })

    const run = await service.startAction(
      { characterId: character.id, outfitId: 'outfit-existing' },
      '',
    )
    expect(run.nodes[0]).toMatchObject({
      type: 'character-setup',
      input: { characterId: character.id, prompt: '' },
    })
    expect(run.nodes.find((node) => node.type === 'action-first-frame')).toMatchObject({
      input: { name: '待机', type: 'idle', prompt: null },
    })
  })

  it('rolls back an orphan character when binding its uploaded template fails', async () => {
    const character: Character = {
      id: 'orphan-character',
      projectId: 'project-1',
      workflowRunId: 'run-1',
      name: '孤立角色',
      description: null,
      referenceImageUrl: 'orphan.png',
      dataVersion: 1,
      status: 1,
      outfits: [],
    }
    const remove = vi.fn(async () => Promise.reject('rollback failed'))
    const onAsyncError = vi.fn()
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis: {
        create: vi.fn(),
        get: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      characterApis: {
        create: vi.fn(async () => character),
        update: vi.fn(async () => Promise.reject(new Error('save failed'))),
        remove,
        get: vi.fn(),
        listByProject: vi.fn(),
      } as unknown as CharacterApis,
      mediaApis: { upload: vi.fn(async () => 'orphan.png' as MediaReference) },
      prepareProject: vi.fn(async () => ({
        id: 'project-1',
        spriteSize: { width: 256, height: 256 },
      })),
      onAsyncError,
    })

    await expect(
      service.startWithUploadedTemplate(new File(['orphan'], 'orphan.png'), ''),
    ).rejects.toThrow('save failed')
    expect(remove).toHaveBeenCalledWith('orphan-character')
    expect(onAsyncError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '创建角色后的回滚失败' }),
    )
  })

  it('reports unavailable dependencies and invalid asset targets explicitly', async () => {
    const generationApis: GenerationApis = {
      create: vi.fn(),
      get: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    }
    const bare = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      prepareProject: vi.fn(),
    })
    const file = new File([], 'hero.png')
    await expect(bare.startWithUploadedTemplate(file, '')).rejects.toThrow('媒体上传服务尚未配置')
    await expect(bare.continueWithUploadedTemplate('run', file, '')).rejects.toThrow(
      '媒体上传服务尚未配置',
    )
    await expect(
      bare.startAction({ characterId: 'character', outfitId: 'outfit' }, 'walk'),
    ).rejects.toThrow('角色服务尚未配置')

    const character: Character = {
      id: 'character',
      projectId: 'project-1',
      workflowRunId: 'run',
      name: null,
      description: null,
      referenceImageUrl: null,
      dataVersion: 1,
      status: 1,
      outfits: [],
    }
    const noOutfit = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      prepareProject: vi.fn(),
      characterApis: {
        get: vi.fn(async () => character),
      } as unknown as CharacterApis,
    })
    await expect(
      noOutfit.startAction({ characterId: 'character', outfitId: 'missing' }, 'walk'),
    ).rejects.toThrow('当前造型没有可用于生成动作的角色母版')
  })

  it('assembles the real service from entity APIs', () => {
    const service = createRealQuickStartService({
      projectApis: { create: vi.fn() } as unknown as ProjectApis,
      characterApis: {} as CharacterApis,
      generationApis: {} as GenerationApis,
      mediaApis: {} as QuickStartMediaApis,
      workflowRunApis: {} as WorkflowRunApis,
    })
    expect(service.unavailableReason).toBeNull()
  })

  it('confirms the action first frame and automatically starts a 32-frame animation', async () => {
    const firstFrameUrl = 'https://example.test/first-frame.png'
    const generationApis: GenerationApis = {
      create: vi.fn(async () => ({
        id: 'task-animation',
        projectId: 'project-1',
        type: 'complete_animation' as const,
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      get: vi.fn(async (_projectId, id) => {
        if (id === 'task-animation') {
          return {
            id,
            projectId: 'project-1',
            type: 'complete_animation' as const,
            status: 'pending' as const,
            result: null,
            error: null,
          }
        }
        return {
          id,
          projectId: 'project-1',
          type: 'first_frame' as const,
          status: 'completed' as const,
          result: {
            type: 'first_frame' as const,
            image: { url: firstFrameUrl },
          },
          error: null,
        }
      }),
      subscribe: vi.fn(() => () => undefined),
    }
    const run: WorkflowRun = {
      id: 'run-1',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: [
        {
          id: 'character-setup',
          type: 'character-setup',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: [],
          generations: [],
          error: null,
          input: { characterId: 'character-1', prompt: '像素骑士', referenceMedia: [] },
        },
        {
          id: 'character-template',
          type: 'character-template',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['character-setup'],
          generations: [{ taskId: 'task-template', role: 'character_template' }],
          error: null,
          selectedImageUrl: 'https://example.test/template.png',
        },
        {
          id: 'action-walk',
          type: 'action-first-frame',
          status: 'active',
          phase: 'selecting',
          dependsOnNodeIds: ['character-template'],
          generations: [{ taskId: 'task-first-frame', role: 'first_frame' }],
          error: null,
          input: {
            outfitId: 'outfit-1',
            name: '行走',
            type: 'custom',
            prompt: '向右行走',
            fps: 12,
          },
          selectedFirstFrameUrl: null,
        },
        {
          id: 'action-walk:action-generation-method',
          type: 'action-generation-method',
          status: 'locked',
          phase: 'selecting',
          dependsOnNodeIds: ['action-walk'],
          generations: [],
          error: null,
          method: null,
        },
        {
          id: 'action-walk:action-full-frame',
          type: 'action-full-frame',
          status: 'locked',
          phase: 'ready',
          dependsOnNodeIds: ['action-walk:action-generation-method'],
          generations: [],
          error: null,
        },
        {
          id: 'action-walk:review',
          type: 'review',
          status: 'locked',
          phase: 'reviewing',
          dependsOnNodeIds: ['action-walk:action-full-frame'],
          generations: [],
          error: null,
        },
      ],
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
    }) as QuickStartServiceWithFirstFrame

    await expect(service.getFirstFrameCandidates('run-1')).resolves.toEqual([
      { index: 0, imageUrl: firstFrameUrl, durationMs: null },
    ])
    await service.confirmFirstFrame('run-1', firstFrameUrl)

    await vi.waitFor(() => {
      expect(generationApis.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete_animation',
          characterId: 'character-1',
          outfitId: 'outfit-1',
          firstFrameUrl,
        }),
      )
    })
  })
})
