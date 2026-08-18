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
import { ProjectNameConflictError, WorkflowRunConflictError } from '@/entities'
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

function completedAnimationGenerationApis(): GenerationApis {
  return {
    create: vi.fn(),
    get: vi.fn(async (projectId, id) => ({
      id,
      projectId,
      type: 'complete_animation' as const,
      status: 'completed' as const,
      result: {
        type: 'complete_animation' as const,
        frames: [{ index: 0, url: 'frame.png', durationMs: 80 }],
      },
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

function characterWithDefaultOutfit(
  workflowRunId: string,
  actions: Character['outfits'][number]['actions'] = [],
): Character {
  return characterFixture({
    workflowRunId,
    outfits: [
      {
        id: 'outfit-1',
        characterId: 'character-1',
        name: '默认造型',
        description: null,
        previewUrl: 'template.png',
        actions,
      },
    ],
  })
}

function priorAction(): Character['outfits'][number]['actions'][number] {
  return {
    id: 'action-full',
    outfitId: 'outfit-1',
    name: '旧动作',
    type: 'custom',
    loop: true,
    fps: 12,
    frameCount: 1,
    frames: [{ index: 0, imageUrl: 'old-frame.png', durationMs: 80 }],
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

  it('creates the character without a name so the backend derives it from the description', async () => {
    const longPrompt = '一位穿着红色斗篷的像素风格女骑士手持长剑站立'
    let savedCharacter = characterFixture({
      description: longPrompt,
      referenceImageUrl: 'https://example.test/template.png',
    })
    const characterApis = mutableCharacterApis(
      () => savedCharacter,
      (value) => (savedCharacter = value),
    )
    // 名称由后端按描述生成。前端一旦自己填，就会撞上 CharacterCreate.name 的 20 字
    // 上限——这里的提示词有 22 字，正是线上创角失败的那一类输入。
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis: pendingGenerationApis(),
      characterApis,
      mediaApis: {
        upload: vi.fn(async () => 'https://example.test/template.png' as MediaReference),
      },
      prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
      projectApis: projectReader(),
      onAsyncError: vi.fn(),
    })

    await service.startWithUploadedTemplate(
      new File(['pixels'], 'hero.png', { type: 'image/png' }),
      longPrompt,
    )

    expect(vi.mocked(characterApis.create).mock.calls[0]?.[0].name).toBeUndefined()
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
    const persistRun = workflowRunApis.update.bind(workflowRunApis)
    let droppedTemplateResponse = false
    vi.spyOn(workflowRunApis, 'update').mockImplementation(async (nextRun) => {
      const saved = await persistRun(nextRun)
      const template = saved.nodes.find((node) => node.type === 'character-template')
      if (!droppedTemplateResponse && template?.status === 'passed') {
        droppedTemplateResponse = true
        throw new Error('上传母版响应丢失')
      }
      return saved
    })
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
    const updateRun = vi.spyOn(workflowRunApis, 'update')
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
    updateRun.mockRejectedValueOnce(new WorkflowRunConflictError('执行记录版本冲突'))
    vi.mocked(characterApis.update)
      .mockImplementationOnce(async (value) => {
        character = structuredClone(value)
        return structuredClone(character)
      })
      .mockRejectedValueOnce(new Error('Character 版本冲突'))
    await expect(session.approveReview()).rejects.toBeInstanceOf(WorkflowRunConflictError)
    expect(character.outfits[0]!.actions).toEqual([])
    expect(session.getWorkflow().nodes.find((node) => node.type === 'review')?.status).toBe(
      'active',
    )
    await session.approveReview()
    await session.approveReview()

    expect(getRun).toHaveBeenCalledTimes(3)
    expect(characterApis.update).toHaveBeenCalledTimes(6)
    expect(session.getWorkflow().nodes.find((node) => node.type === 'review')?.status).toBe(
      'passed',
    )
    expect(character.outfits[0]!.actions[0]!.frames).toEqual([
      { index: 7, imageUrl: 'frame-7.png', durationMs: 83 },
      { index: 9, imageUrl: 'frame-9.png', durationMs: null },
    ])
  })

  it.each([new Error('WorkflowRun 回读失败'), '回读失败'])(
    '审核冲突后无法回读 Run 时保留幂等动作并上报对账错误',
    async (reconcileCause) => {
      const run = actionRun()
      const storedApis = createWorkflowRunApis([run])
      const realGet = storedApis.get.bind(storedApis)
      vi.spyOn(storedApis, 'get')
        .mockImplementationOnce(realGet)
        .mockImplementationOnce(realGet)
        .mockRejectedValueOnce(reconcileCause)
      vi.spyOn(storedApis, 'update').mockRejectedValueOnce(
        new WorkflowRunConflictError('执行记录版本冲突'),
      )
      let character = characterWithDefaultOutfit(run.id, [priorAction()])
      const characterApis = mutableCharacterApis(
        () => character,
        (value) => (character = value),
      )
      const onAsyncError = vi.fn()
      const session = await createQuickStartService({
        workflowRunApis: storedApis,
        generationApis: completedAnimationGenerationApis(),
        characterApis,
        prepareProject: vi.fn(),
        projectApis: projectReader(),
        onAsyncError,
      }).open(run.id)

      await expect(session.approveReview()).rejects.toBeInstanceOf(WorkflowRunConflictError)

      expect(character.outfits[0]!.actions).toHaveLength(1)
      expect(onAsyncError).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            reconcileCause instanceof Error
              ? reconcileCause.message
              : 'WorkflowRun 保存结果对账失败',
        }),
      )
    },
  )

  it.each([new Error('节点重新打开失败'), '节点重新打开失败'])(
    'Character 写入失败且无法重新打开母版节点时上报错误',
    async (reopenCause) => {
      const workflowRunApis = createWorkflowRunApis()
      const realUpdate = workflowRunApis.update.bind(workflowRunApis)
      let updateRunCalls = 0
      vi.spyOn(workflowRunApis, 'update').mockImplementation(async (next) => {
        updateRunCalls += 1
        if (updateRunCalls <= 2) return realUpdate(next)
        throw reopenCause
      })
      const character = characterFixture({
        id: 'character-write-failed',
        referenceImageUrl: 'old.png',
      })
      const onAsyncError = vi.fn()
      const service = createQuickStartService({
        workflowRunApis,
        generationApis: pendingGenerationApis(),
        characterApis: {
          get: vi.fn(async () => structuredClone(character)),
          listByProject: vi.fn(),
          create: vi.fn(async () => structuredClone(character)),
          update: vi.fn(async () => Promise.reject(new Error('Character 写入失败'))),
          remove: vi.fn(),
        },
        mediaApis: { upload: vi.fn(async () => 'candidate.png' as MediaReference) },
        prepareProject: vi.fn(async () => ({
          id: 'project-1',
          spriteSize: { width: 256, height: 256 },
        })),
        projectApis: projectReader(),
        onAsyncError,
      })

      await expect(
        service.startWithUploadedTemplate(new File(['candidate'], 'candidate.png'), ''),
      ).rejects.toThrow('Character 写入失败')
      expect(onAsyncError).toHaveBeenCalledWith(
        reopenCause instanceof Error
          ? reopenCause
          : expect.objectContaining({ message: '角色母版资产写入失败后重新打开节点失败' }),
      )
    },
  )

  it.each([new Error('动作恢复失败'), '动作恢复失败'])(
    '审核冲突的两次动作恢复都失败时上报最终错误',
    async (rollbackCause) => {
      const run = actionRun()
      const workflowRunApis = createWorkflowRunApis([run])
      vi.spyOn(workflowRunApis, 'update').mockRejectedValueOnce(
        new WorkflowRunConflictError('执行记录版本冲突'),
      )
      let character = characterWithDefaultOutfit(run.id, [priorAction()])
      const update = vi.fn(async (value: Character) => {
        if (update.mock.calls.length === 1) {
          character = structuredClone(value)
          return structuredClone(character)
        }
        return Promise.reject(rollbackCause)
      })
      const onAsyncError = vi.fn()
      const session = await createQuickStartService({
        workflowRunApis,
        generationApis: completedAnimationGenerationApis(),
        characterApis: {
          get: vi.fn(async () => structuredClone(character)),
          listByProject: vi.fn(),
          create: vi.fn(),
          update,
          remove: vi.fn(),
        },
        prepareProject: vi.fn(),
        projectApis: projectReader(),
        onAsyncError,
      }).open(run.id)

      await expect(session.approveReview()).rejects.toBeInstanceOf(WorkflowRunConflictError)
      expect(update).toHaveBeenCalledTimes(3)
      expect(onAsyncError).toHaveBeenCalledWith(
        rollbackCause instanceof Error
          ? rollbackCause
          : expect.objectContaining({ message: '审核冲突后恢复角色资产失败' }),
      )
    },
  )

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
    const workflowRunApis = createWorkflowRunApis()
    const updateRun = vi.spyOn(workflowRunApis, 'update')
    const service = createQuickStartService({
      workflowRunApis,
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
    const confirmationSave = updateRun.mock.calls
      .map(([run]) => run)
      .find(
        (run) => run.nodes.find((node) => node.type === 'character-template')?.status === 'passed',
      )
    expect(confirmationSave?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'character-setup',
          input: expect.objectContaining({ characterId: 'candidate-character' }),
        }),
        expect.objectContaining({ type: 'character-template', status: 'passed' }),
      ]),
    )
  })

  it('Run 已落库但响应丢失时不删除已绑定的 Character', async () => {
    const run: WorkflowRun = {
      id: 'run-response-lost',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes(null, null),
    }
    const workflowRunApis = createWorkflowRunApis([run])
    const realUpdate = workflowRunApis.update.bind(workflowRunApis)
    vi.spyOn(workflowRunApis, 'update').mockImplementation(async (nextRun) => {
      const saved = await realUpdate(nextRun)
      const template = saved.nodes.find((node) => node.type === 'character-template')
      if (template?.status === 'passed') throw new Error('网络响应丢失')
      return saved
    })
    let character = characterFixture({
      workflowRunId: run.id,
      referenceImageUrl: 'candidate.png',
    })
    const remove = vi.fn()
    const characterApis = mutableCharacterApis(
      () => character,
      (value) => (character = value),
    )
    characterApis.remove = remove
    const service = createQuickStartService({
      workflowRunApis,
      generationApis: pendingGenerationApis(),
      characterApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })
    const session = await service.open(run.id)

    await expect(session.confirmCandidate('candidate.png', '挥手')).resolves.toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ type: 'action-first-frame', phase: 'generating' }),
      ]),
    })

    expect(remove).not.toHaveBeenCalled()
    const latest = await workflowRunApis.get(run.id)
    expect(latest.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'character-setup',
          input: expect.objectContaining({ characterId: character.id }),
        }),
        expect.objectContaining({ type: 'character-template', status: 'passed' }),
      ]),
    )
  })

  it('并发复用同一 Character 时沿用已有母版造型，不重复追加默认造型', async () => {
    const run: WorkflowRun = {
      id: 'run-shared-character',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes(null, null),
    }
    const workflowRunApis = createWorkflowRunApis([run])
    const realUpdate = workflowRunApis.update.bind(workflowRunApis)
    vi.spyOn(workflowRunApis, 'update').mockImplementationOnce(async (nextRun) => {
      await realUpdate(nextRun)
      throw new WorkflowRunConflictError('执行记录版本冲突')
    })
    let character = characterFixture({
      workflowRunId: run.id,
      referenceImageUrl: 'candidate.png',
      outfits: [
        {
          id: 'outfit-from-other-client',
          characterId: 'character-1',
          name: '默认造型',
          description: null,
          previewUrl: 'candidate.png',
          actions: [],
        },
      ],
    })
    const characterApis = mutableCharacterApis(
      () => character,
      (value) => (character = value),
    )
    const service = createQuickStartService({
      workflowRunApis,
      generationApis: pendingGenerationApis(),
      characterApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })
    const session = await service.open(run.id)

    await session.confirmCandidate('candidate.png', '挥手')

    expect(character.outfits).toEqual([
      expect.objectContaining({
        id: 'outfit-from-other-client',
        previewUrl: 'candidate.png',
      }),
    ])
  })

  it('母版确认冲突时不在获得 WorkflowRun 修改权前改写 Character', async () => {
    const run: WorkflowRun = {
      id: 'run-template-conflict',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes(null, null),
    }
    const workflowRunApis = createWorkflowRunApis([run])
    vi.spyOn(workflowRunApis, 'update').mockRejectedValue(
      new WorkflowRunConflictError('执行记录版本冲突'),
    )
    let character = characterFixture({ workflowRunId: run.id })
    const characterApis = mutableCharacterApis(
      () => character,
      (value) => (character = value),
    )
    const service = createQuickStartService({
      workflowRunApis,
      generationApis: pendingGenerationApis(),
      characterApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })
    const session = await service.open(run.id)

    await expect(session.confirmCandidate('candidate.png', '挥手')).rejects.toBeInstanceOf(
      WorkflowRunConflictError,
    )

    expect(characterApis.remove).not.toHaveBeenCalled()
    expect(character.outfits).toEqual([])
    expect(characterApis.update).not.toHaveBeenCalled()
    expect((await workflowRunApis.get(run.id)).nodes).toEqual(run.nodes)
  })

  it('不同候选图并发确认时只让 WorkflowRun 乐观锁胜者写入 Character', async () => {
    const run: WorkflowRun = {
      id: 'run-competing-templates',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes(null, null),
    }
    let stored = structuredClone(run)
    const workflowRunApis: WorkflowRunApis = {
      create: vi.fn(),
      listByProject: vi.fn(),
      get: vi.fn(async () => structuredClone(stored)),
      update: vi.fn(async (next) => {
        if (next.version !== stored.version) {
          throw new WorkflowRunConflictError('执行记录版本冲突')
        }
        stored = { ...structuredClone(next), version: stored.version + 1 }
        return structuredClone(stored)
      }),
      remove: vi.fn(),
    }
    let character = characterFixture({
      workflowRunId: run.id,
      referenceImageUrl: null,
      outfits: [],
    })
    const characterApis = mutableCharacterApis(
      () => character,
      (value) => (character = value),
    )
    const createService = () =>
      createQuickStartService({
        workflowRunApis,
        generationApis: pendingGenerationApis(),
        characterApis,
        prepareProject: vi.fn(),
        projectApis: projectReader(),
      })
    const [sessionA, sessionB] = await Promise.all([
      createService().open(run.id),
      createService().open(run.id),
    ])

    const results = await Promise.allSettled([
      sessionA.confirmCandidate('candidate-a.png', '挥手'),
      sessionB.confirmCandidate('candidate-b.png', '挥手'),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const selectedImageUrl = stored.nodes.find(
      (node) => node.type === 'character-template',
    )?.selectedImageUrl
    expect(character.referenceImageUrl).toBe(selectedImageUrl)
    expect(character.outfits).toEqual([
      expect.objectContaining({ id: 'outfit-default', previewUrl: selectedImageUrl }),
    ])
    expect(characterApis.update).toHaveBeenCalledOnce()
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

  it('Character 写入失败时重新打开已确认的母版节点', async () => {
    const character = characterFixture({
      id: 'orphan-character',
      name: '孤立角色',
      referenceImageUrl: 'orphan.png',
    })
    const workflowRunApis = createWorkflowRunApis()
    const update = vi.fn(async () => Promise.reject(new Error('角色写入失败')))
    const remove = vi.fn()
    const service = createQuickStartService({
      workflowRunApis,
      generationApis: {
        create: vi.fn(),
        get: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      characterApis: {
        create: vi.fn(async () => character),
        update,
        remove,
        get: vi.fn(async () => structuredClone(character)),
        listByProject: vi.fn(),
      } as unknown as CharacterApis,
      mediaApis: { upload: vi.fn(async () => 'orphan.png' as MediaReference) },
      prepareProject: vi.fn(async () => ({
        id: 'project-1',
        spriteSize: { width: 256, height: 256 },
      })),
      projectApis: projectReader(),
    })

    await expect(
      service.startWithUploadedTemplate(new File(['orphan'], 'orphan.png'), ''),
    ).rejects.toThrow('角色写入失败')
    expect(remove).not.toHaveBeenCalled()
    const latest = await workflowRunApis.get('run-1')
    expect(latest.nodes.find((node) => node.type === 'character-template')).toMatchObject({
      status: 'active',
      phase: 'ready',
      selectedImageUrl: null,
    })
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

  it('向会话订阅者报告自动推进中的乐观锁冲突', async () => {
    const run = actionRun(true)
    const storedApis = createWorkflowRunApis([run])
    let methodAttempts = 0
    const workflowRunApis: WorkflowRunApis = {
      ...storedApis,
      update: vi.fn(async (nextRun: WorkflowRun) => {
        const method = nextRun.nodes.find((node) => node.type === 'action-generation-method')
        if (method?.type === 'action-generation-method' && method.method === 'video-cropping') {
          methodAttempts += 1
          throw new WorkflowRunConflictError('执行记录版本冲突，请刷新后重试')
        }
        return storedApis.update(nextRun)
      }),
    }
    const service = createQuickStartService({
      workflowRunApis,
      generationApis: pendingGenerationApis(),
      prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
      projectApis: projectReader(),
    })
    const session = await service.open(run.id)
    const errors: Error[] = []
    const unsubscribe = session.subscribeErrors((error) => errors.push(error))

    await session.confirmFirstFrame('https://example.test/first-frame-2.png')

    await vi.waitFor(() => expect(errors).toEqual([expect.any(WorkflowRunConflictError)]))
    await session.interrupt()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(methodAttempts).toBe(1)
    unsubscribe()
  })

  it('错误上报器和页面订阅者抛错时仍完成容错', async () => {
    const run = actionRun(true)
    const storedApis = createWorkflowRunApis([run])
    const workflowRunApis: WorkflowRunApis = {
      ...storedApis,
      update: vi.fn(async (nextRun: WorkflowRun) => {
        const method = nextRun.nodes.find((node) => node.type === 'action-generation-method')
        if (method?.type === 'action-generation-method' && method.method === 'video-cropping') {
          throw '非 Error 异常'
        }
        return storedApis.update(nextRun)
      }),
    }
    const onAsyncError = vi.fn(() => {
      throw new Error('上报器异常')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const service = createQuickStartService({
        workflowRunApis,
        generationApis: pendingGenerationApis(),
        prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
        projectApis: projectReader(),
        onAsyncError,
      })
      const session = await service.open(run.id)
      session.subscribeErrors(() => {
        throw new Error('页面订阅者异常')
      })

      await session.confirmFirstFrame('https://example.test/first-frame-2.png')

      await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2))
      expect(onAsyncError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Quick Start 自动推进失败' }),
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('会话销毁后不再报告尚未结束的自动推进错误', async () => {
    const run = actionRun(true)
    const storedApis = createWorkflowRunApis([run])
    const advanceControl: { reject?: (error: Error) => void } = {}
    let markAdvanceStarted: (() => void) | null = null
    const advanceStarted = new Promise<void>((resolve) => {
      markAdvanceStarted = resolve
    })
    const workflowRunApis: WorkflowRunApis = {
      ...storedApis,
      update: vi.fn(async (nextRun: WorkflowRun) => {
        const method = nextRun.nodes.find((node) => node.type === 'action-generation-method')
        if (method?.type === 'action-generation-method' && method.method === 'video-cropping') {
          markAdvanceStarted?.()
          return new Promise<WorkflowRun>((_resolve, reject) => {
            advanceControl.reject = reject
          })
        }
        return storedApis.update(nextRun)
      }),
    }
    const onAsyncError = vi.fn()
    const service = createQuickStartService({
      workflowRunApis,
      generationApis: pendingGenerationApis(),
      prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
      projectApis: projectReader(),
      onAsyncError,
    })
    const session = await service.open(run.id)
    const pageError = vi.fn()
    session.subscribeErrors(pageError)

    await session.confirmFirstFrame('https://example.test/first-frame-2.png')
    await advanceStarted
    session.dispose()
    if (!advanceControl.reject) throw new Error('自动推进请求没有启动')
    advanceControl.reject(new Error('旧会话保存失败'))
    await Promise.resolve()

    expect(onAsyncError).not.toHaveBeenCalled()
    expect(pageError).not.toHaveBeenCalled()
  })
})
