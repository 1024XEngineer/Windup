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
