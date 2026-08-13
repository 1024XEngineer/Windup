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
  createAuthenticatedGenerationRequest,
  createQuickStartService,
  createRealQuickStartService,
  type QuickStartMediaApis,
} from './service'
import { ProjectNameConflictError } from '@/entities'
import { registerApiAccessTokenProvider } from '@/shared/api'

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

function pendingGenerationApis(): GenerationApis {
  const types = new Map<string, Awaited<ReturnType<GenerationApis['create']>>['type']>()
  let sequence = 0
  return {
    create: vi.fn(async (input) => {
      const id = `task-${++sequence}`
      types.set(id, input.type)
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
      type: types.get(id) ?? 'first_frame',
      status: 'pending' as const,
      result: null,
      error: null,
    })),
    subscribe: vi.fn(() => () => undefined),
  }
}

function projectReader(spriteSize = { width: 256, height: 256 }) {
  return {
    get: vi.fn(async (id: string) => ({ id, spriteSize })),
  } as unknown as Pick<ProjectApis, 'get'>
}

function characterFixture(overrides: Partial<Character> = {}): Character {
  return {
    id: 'character-1',
    projectId: 'project-1',
    workflowRunId: 'run-1',
    name: '像素骑士',
    description: null,
    referenceImageUrl: 'template.png',
    dataVersion: 1,
    status: 1,
    outfits: [],
    ...overrides,
  }
}

function mutableCharacterApis(
  read: () => Character,
  write: (value: Character) => void,
): CharacterApis {
  return {
    get: vi.fn(async () => structuredClone(read())),
    listByProject: vi.fn(async () => ({
      items: [structuredClone(read())],
      total: 1,
      page: 1,
      pageSize: 20,
    })),
    create: vi.fn(async () => structuredClone(read())),
    update: vi.fn(async (value) => {
      write(structuredClone(value))
      return structuredClone(read())
    }),
    remove: vi.fn(async () => undefined),
  }
}

function setupNodes(
  characterId: string | null = 'character-1',
  selectedImageUrl: string | null = 'template.png',
): WorkflowRun['nodes'] {
  return [
    {
      id: 'character-setup',
      type: 'character-setup',
      status: 'passed',
      phase: 'completed',
      dependsOnNodeIds: [],
      generations: [],
      error: null,
      input: { ...(characterId ? { characterId } : {}), prompt: '像素骑士', referenceMedia: [] },
    },
    {
      id: 'character-template',
      type: 'character-template',
      status: selectedImageUrl ? 'passed' : 'active',
      phase: selectedImageUrl ? 'completed' : 'selecting',
      dependsOnNodeIds: ['character-setup'],
      generations: [{ taskId: 'task-template', role: 'character_template' }],
      error: null,
      selectedImageUrl,
    },
  ]
}

function actionRun(firstFramePending = false): WorkflowRun {
  const firstId = firstFramePending ? 'action-walk' : 'action-first'
  const fullId = firstFramePending ? `${firstId}:action-full-frame` : 'action-full'
  return {
    id: firstFramePending ? 'run-1' : 'run-complete',
    projectId: 'project-1',
    version: 1,
    storageStatus: 'active',
    nodes: [
      ...setupNodes(
        'character-1',
        firstFramePending ? 'https://example.test/template.png' : 'template.png',
      ),
      {
        id: firstId,
        type: 'action-first-frame',
        status: firstFramePending ? 'active' : 'passed',
        phase: firstFramePending ? 'selecting' : 'completed',
        dependsOnNodeIds: ['character-template'],
        generations: firstFramePending ? [{ taskId: 'task-first-frame', role: 'first_frame' }] : [],
        error: null,
        input: { outfitId: 'outfit-1', name: '挥手', type: 'custom', prompt: '挥手', fps: 12 },
        selectedFirstFrameUrl: firstFramePending ? null : 'first.png',
      },
      {
        id: `${firstId}:action-generation-method`,
        type: 'action-generation-method',
        status: firstFramePending ? 'locked' : 'passed',
        phase: firstFramePending ? 'selecting' : 'completed',
        dependsOnNodeIds: [firstId],
        generations: [],
        error: null,
        method: firstFramePending ? null : 'video-cropping',
      },
      {
        id: fullId,
        type: 'action-full-frame',
        status: firstFramePending ? 'locked' : 'passed',
        phase: firstFramePending ? 'ready' : 'completed',
        dependsOnNodeIds: [`${firstId}:action-generation-method`],
        generations: firstFramePending
          ? []
          : [{ taskId: 'task-animation', role: 'complete_animation' }],
        error: null,
      },
      {
        id: firstFramePending ? `${firstId}:review` : 'review',
        type: 'review',
        status: firstFramePending ? 'locked' : 'active',
        phase: 'reviewing',
        dependsOnNodeIds: [fullId],
        generations: [],
        error: null,
      },
    ],
  }
}

describe('createQuickStartService', () => {
  it('sends generation requests to the API with the current bearer token', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test/')
    const unregister = registerApiAccessTokenProvider(() => 'quick-start-token')
    const fetchFn = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response(),
    )

    await createAuthenticatedGenerationRequest(fetchFn as typeof fetch)('/generation/image', {
      method: 'POST',
    })

    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://api.windup.test/generation/image')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer quick-start-token')
    expect(init?.credentials).toBe('include')
    unregister()
    vi.unstubAllEnvs()
  })

  it('rejects empty input and does not fabricate missing workflow data', async () => {
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis: {
        create: vi.fn(),
        get: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })

    await expect(service.start('   ')).rejects.toThrow('请先描述')
    await expect(service.open('missing')).rejects.toThrow('not found')
  })

  it('creates a readable bounded project name without a hash suffix', async () => {
    const create = vi.fn(async (input) => ({
      id: 'project-1',
      ...input,
      description: null,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-11T00:00:00Z',
    }))
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await expect(prepare('  一位名字特别长的像素角色设定用于验证截断继续  ')).resolves.toEqual({
      id: 'project-1',
      spriteSize: { width: 256, height: 256 },
    })
    const createdName = create.mock.calls[0]?.[0].name
    expect(Array.from(createdName ?? '')).toHaveLength(20)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '一位名字特别长的像素角色设定用于验证截…',
        perspective: 'side',
        directionalMovement: 'single',
      }),
    )
  })

  it('uses a readable number when the generated project name already exists', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new ProjectNameConflictError())
      .mockResolvedValueOnce({
        id: 'project-2',
        name: '会挥剑的像素骑士 2',
        spriteSize: { width: 256, height: 256 },
      })
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await expect(prepare('会挥剑的像素骑士')).resolves.toEqual({
      id: 'project-2',
      spriteSize: { width: 256, height: 256 },
    })
    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: '会挥剑的像素骑士' }))
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: '会挥剑的像素骑士 2' }),
    )
  })

  it('uses a readable fallback for an empty project prompt', async () => {
    const create = vi.fn(async (input) => ({
      id: 'project-fallback',
      ...input,
      spriteSize: { width: 256, height: 256 },
    }))
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await prepare('   ')

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: '未命名项目' }))
  })

  it('does not retry project creation errors other than name conflicts', async () => {
    const networkError = new Error('网络请求失败')
    const create = vi.fn().mockRejectedValue(networkError)
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await expect(prepare('像素骑士')).rejects.toBe(networkError)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('does not infer a project-name conflict from an arbitrary error message', async () => {
    const unrelatedError = new Error('项目名称已存在')
    const create = vi.fn().mockRejectedValue(unrelatedError)
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await expect(prepare('像素骑士')).rejects.toBe(unrelatedError)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps long numbered project names readable within the backend limit', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new ProjectNameConflictError())
      .mockResolvedValueOnce({
        id: 'project-long-2',
        name: '一位名字特别长的像素角色设定用于验… 2',
        spriteSize: { width: 256, height: 256 },
      })
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await prepare('一位名字特别长的像素角色设定用于验证截断继续')

    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: '一位名字特别长的像素角色设定用于验证截…' }),
    )
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: '一位名字特别长的像素角色设定用于验… 2' }),
    )
    expect(Array.from(create.mock.calls[1]?.[0].name ?? '')).toHaveLength(20)
  })

  it('stops after five conflicting project names to avoid excessive write requests', async () => {
    const conflict = new ProjectNameConflictError()
    const create = vi.fn().mockRejectedValue(conflict)
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await expect(prepare('像素骑士')).rejects.toBe(conflict)
    expect(create).toHaveBeenCalledTimes(5)
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
      projectApis: projectReader(),
    })

    const session = await service.start('像素骑士')
    const run = session.getWorkflow()

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
    const generationApis = pendingGenerationApis()
    let savedCharacter = characterFixture({
      description: '挥手',
      referenceImageUrl: 'https://example.test/template.png',
    })
    const characterApis = mutableCharacterApis(
      () => savedCharacter,
      (value) => (savedCharacter = value),
    )
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
      projectApis: projectReader(),
      onAsyncError: vi.fn(),
    })
    const file = new File(['pixels'], 'hero.png', { type: 'image/png' })

    const firstSession = await service.startWithUploadedTemplate(file, '挥手')
    const firstRun = firstSession.getWorkflow()

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
    expect(firstSession.getCharacterInfo()).toEqual({
      characterId: 'character-1',
      outfitId: savedCharacter.outfits[0]!.id,
    })

    const secondSession = await service.startAction(
      { characterId: 'character-1', outfitId: savedCharacter.outfits[0]!.id },
      '跳跃',
    )
    const target = { characterId: 'character-1', outfitId: savedCharacter.outfits[0]!.id }
    await service.startAction(target, '跑步')
    await service.startAction(target, '攻击')
    await service.startAction(target, '站立挥手')
    const finalSession = await service.startAction(target, '跑步攻击')
    const finalRun = finalSession.getWorkflow()
    expect(secondSession.runId).toBe(firstSession.runId)
    expect(finalSession.runId).toBe(firstSession.runId)
    expect(finalRun.nodes.filter((node) => node.type === 'action-first-frame')).toHaveLength(6)
    expect(generationApis.create).toHaveBeenCalledTimes(6)
    expect(generationApis.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actionType: 'custom', prompt: '挥手' }),
    )
    expect(generationApis.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ actionType: 'jump', prompt: '跳跃' }),
    )
    expect(generationApis.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ actionType: 'walk', prompt: '跑步' }),
    )
    expect(generationApis.create).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ actionType: 'attack', prompt: '攻击' }),
    )
    expect(generationApis.create).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({ actionType: 'custom', prompt: '站立挥手' }),
    )
    expect(generationApis.create).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({ actionType: 'custom', prompt: '跑步攻击' }),
    )
  })

  it('preserves backend frame metadata while approving and importing a completed action', async () => {
    const run = actionRun()
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
    let character = characterFixture({
      workflowRunId: run.id,
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
    })
    const characterApis = mutableCharacterApis(
      () => character,
      (value) => (character = value),
    )
    const workflowRunApis = createWorkflowRunApis([run])
    const getRun = vi.spyOn(workflowRunApis, 'get')
    const service = createQuickStartService({
      workflowRunApis,
      generationApis,
      characterApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })

    const session = await service.open(run.id)
    await session.resume()
    await expect(session.getTemplateCandidates()).resolves.toEqual(['template.png'])
    await expect(session.getActionFrames()).resolves.toEqual([
      { index: 7, imageUrl: 'frame-7.png', durationMs: 83 },
      { index: 9, imageUrl: 'frame-9.png', durationMs: null },
    ])
    session.dispose()
    await session.resume()
    vi.mocked(characterApis.update).mockRejectedValueOnce(new Error('asset write failed'))
    await expect(session.approveReview()).rejects.toThrow('asset write failed')
    expect(session.getWorkflow().nodes.find((node) => node.type === 'review')?.status).toBe(
      'active',
    )
    await session.approveReview()
    await session.approveReview()

    expect(getRun).toHaveBeenCalledTimes(1)
    expect(characterApis.update).toHaveBeenCalledTimes(3)
    expect(session.getWorkflow().nodes.find((node) => node.type === 'review')?.status).toBe(
      'passed',
    )
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
      nodes: setupNodes(null, null),
    }
    const generationApis = pendingGenerationApis()
    let character = characterFixture({
      id: 'character-restore',
      workflowRunId: candidateRun.id,
      referenceImageUrl: 'replacement.png',
    })
    const characterApis = mutableCharacterApis(
      () => character,
      (value) => (character = value),
    )
    characterApis.listByProject = vi.fn(async () => ({
      items: [
        structuredClone(character),
        characterFixture({
          id: 'unrelated-character',
          workflowRunId: 'another-run',
          outfits: [
            {
              id: 'unrelated-outfit',
              characterId: 'unrelated-character',
              name: '其他造型',
              description: null,
              previewUrl: 'unrelated.png',
              actions: [],
            },
          ],
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    }))
    const workflowRunApis = createWorkflowRunApis([candidateRun])
    const service = createQuickStartService({
      workflowRunApis,
      generationApis,
      characterApis,
      projectApis: projectReader(),
      mediaApis: { upload: vi.fn(async () => 'replacement.png' as MediaReference) },
      prepareProject: vi.fn(),
    })

    const session = await service.open(candidateRun.id)
    const continued = await session.continueWithUploadedTemplate(
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
    const stop = session.subscribe(listener)
    await Promise.resolve()
    stop()
    await session.interrupt()

    const recoveryRun = structuredClone(continued)
    const recoverySetup = recoveryRun.nodes.find((node) => node.type === 'character-setup')
    if (!recoverySetup || recoverySetup.type !== 'character-setup') throw new Error('missing setup')
    delete recoverySetup.input.characterId
    const recoveryService = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([recoveryRun]),
      generationApis,
      characterApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })
    const recoverySession = await recoveryService.open(recoveryRun.id)
    await recoverySession.resume()
    await expect(recoverySession.resolveCharacterInfo()).resolves.toEqual({
      characterId: 'character-restore',
      outfitId: character.outfits[0]!.id,
    })
    vi.mocked(characterApis.listByProject).mockResolvedValueOnce({
      items: [
        structuredClone(character),
        characterFixture({ id: 'duplicate-character', workflowRunId: recoveryRun.id }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    })
    await expect(recoverySession.resolveCharacterInfo()).resolves.toBeNull()
  })

  it('restores character info when the bound character is on a later project page', async () => {
    const run = actionRun()
    const setup = run.nodes.find((node) => node.type === 'character-setup')
    if (!setup || setup.type !== 'character-setup') throw new Error('missing setup')
    delete setup.input.characterId
    const character = characterFixture({
      workflowRunId: run.id,
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
    })
    const characterApis = mutableCharacterApis(
      () => character,
      () => undefined,
    )
    characterApis.listByProject = vi.fn(async (_projectId, query = {}) =>
      query.page === 2
        ? { items: [structuredClone(character)], total: 21, page: 2, pageSize: 20 }
        : {
            items: [characterFixture({ id: 'unrelated-character', workflowRunId: 'another-run' })],
            total: 21,
            page: 1,
            pageSize: 20,
          },
    )
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis: pendingGenerationApis(),
      characterApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })

    const session = await service.open(run.id)

    await expect(session.resolveCharacterInfo()).resolves.toEqual({
      characterId: character.id,
      outfitId: 'outfit-1',
    })
  })

  it('reuses the character already bound to a run when replacing its template', async () => {
    const run: WorkflowRun = {
      id: 'run-existing-character',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes('character-existing', null),
    }
    const character = characterFixture({
      id: 'character-existing',
      workflowRunId: run.id,
      outfits: [
        {
          id: 'outfit-existing',
          characterId: 'character-existing',
          name: '默认造型',
          description: null,
          previewUrl: 'replacement.png',
          actions: [],
        },
      ],
    })
    const characterApis = mutableCharacterApis(
      () => character,
      () => undefined,
    )
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis: pendingGenerationApis(),
      characterApis,
      projectApis: projectReader(),
      mediaApis: { upload: vi.fn(async () => 'replacement.png' as MediaReference) },
      prepareProject: vi.fn(),
    })

    const session = await service.open(run.id)
    await session.continueWithUploadedTemplate(new File(['replacement'], 'replacement.png'), '')

    expect(session.getCharacterInfo()).toEqual({
      characterId: character.id,
      outfitId: 'outfit-existing',
    })
    expect(characterApis.create).not.toHaveBeenCalled()
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
                  images: [
                    { url: 'candidate.png' },
                    { url: 'candidate-2.png' },
                    { url: 'candidate-3.png' },
                  ],
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
      projectApis: projectReader(),
    })
    const started = await service.start('像素骑士')
    await vi.waitFor(async () => {
      await expect(started.getTemplateCandidates()).resolves.toEqual([
        'candidate.png',
        'candidate-2.png',
        'candidate-3.png',
      ])
    })

    const first = started.confirmCandidate('candidate.png', '挥手')
    const duplicate = started.confirmCandidate('candidate.png', '挥手')
    expect(duplicate).toBe(first)
    await first

    expect(character.outfits).toHaveLength(1)
    expect(started.getCharacterInfo()?.characterId).toBe('candidate-character')
  })

  it('creates a fresh run when an existing character has no workflow history', async () => {
    const character = characterFixture({
      id: 'character-existing',
      workflowRunId: 'old-run',
      name: '老角色',
      referenceImageUrl: 'existing.png',
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
    })
    const generationApis = pendingGenerationApis()
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
      projectApis: projectReader(),
      prepareProject: vi.fn(),
    })

    const session = await service.startAction(
      { characterId: character.id, outfitId: 'outfit-existing' },
      '',
    )
    const run = session.getWorkflow()
    expect(run.nodes[0]).toMatchObject({
      type: 'character-setup',
      input: { characterId: character.id, prompt: '' },
    })
    expect(run.nodes.find((node) => node.type === 'action-first-frame')).toMatchObject({
      input: { name: '待机', type: 'idle', prompt: null },
    })
  })

  it('rolls back an orphan character when binding its uploaded template fails', async () => {
    const character = characterFixture({
      id: 'orphan-character',
      name: '孤立角色',
      referenceImageUrl: 'orphan.png',
    })
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
      projectApis: projectReader(),
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
      projectApis: projectReader(),
    })
    const file = new File([], 'hero.png')
    await expect(bare.startWithUploadedTemplate(file, '')).rejects.toThrow('媒体上传服务尚未配置')
    await expect(
      bare.startAction({ characterId: 'character', outfitId: 'outfit' }, 'walk'),
    ).rejects.toThrow('角色服务尚未配置')

    const character = characterFixture({
      id: 'character',
      workflowRunId: 'run',
      name: null,
      referenceImageUrl: null,
    })
    const noOutfit = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(),
      characterApis: {
        get: vi.fn(async () => character),
      } as unknown as CharacterApis,
    })
    await expect(
      noOutfit.startAction({ characterId: 'character', outfitId: 'missing' }, 'walk'),
    ).rejects.toThrow('当前造型没有可用于生成动作的角色母版')

    const staticRun: WorkflowRun = {
      id: 'run-static',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes(),
    }
    const staticService = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([staticRun]),
      generationApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(),
      characterApis: {} as CharacterApis,
      mediaApis: { upload: vi.fn() },
    })
    const staticSession = await staticService.open(staticRun.id)
    await expect(staticSession.continueWithUploadedTemplate(file, '')).rejects.toThrow(
      '当前角色母版节点不能直接替换图片',
    )
    await expect(staticSession.confirmFirstFrame('first.png')).rejects.toThrow(
      '当前运行没有可确认的动作首帧',
    )
    await expect(staticSession.approveReview()).rejects.toThrow('没有可审核的完整动画')
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
    const firstFrameUrls = [
      'https://example.test/first-frame-1.png',
      'https://example.test/first-frame-2.png',
      'https://example.test/first-frame-3.png',
    ]
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
            images: firstFrameUrls.map((url) => ({ url })),
          },
          error: null,
        }
      }),
      subscribe: vi.fn(() => () => undefined),
    }
    const run = actionRun(true)
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
      projectApis: projectReader(),
    })
    const session = await service.open('run-1')

    await expect(session.getFirstFrameCandidates()).resolves.toEqual([
      { index: 0, imageUrl: firstFrameUrls[0], durationMs: null },
      { index: 1, imageUrl: firstFrameUrls[1], durationMs: null },
      { index: 2, imageUrl: firstFrameUrls[2], durationMs: null },
    ])
    await session.confirmFirstFrame(firstFrameUrls[1]!)

    await vi.waitFor(() => {
      expect(generationApis.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete_animation',
          characterId: 'character-1',
          outfitId: 'outfit-1',
          firstFrameUrl: firstFrameUrls[1],
        }),
      )
    })
  })
})
