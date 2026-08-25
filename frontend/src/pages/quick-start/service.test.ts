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
  let runSequence = initialRuns.length
  const runs = new Map(initialRuns.map((run) => [run.id, structuredClone(run)]))
  return {
    async create(input) {
      const run: WorkflowRun = {
        id: `run-${++runSequence}`,
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

function projectReader(
  spriteSize = { width: 256, height: 256 },
  directionalMovement: 'single' | 'four-way' | 'eight-way' = 'single',
) {
  return {
    get: vi.fn(async (id: string) => ({ id, spriteSize, directionalMovement })),
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
        model3dUrl: null,
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
  it('四向 Quick Start 在用户选定母版前只创建东向三候选任务', async () => {
    const generationApis = pendingGenerationApis()
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      prepareProject: vi.fn(async () => ({
        id: 'project-1',
        spriteSize: { width: 256, height: 256 },
        directionalMovement: 'four-way' as const,
      })),
      projectApis: projectReader(undefined, 'four-way'),
    })

    await service.start('四向像素骑士', 'four-way')

    expect(generationApis.create).toHaveBeenCalledTimes(1)
    expect(generationApis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'character_template',
        direction: 'east',
        candidateCount: 3,
      }),
    )
  })

  it('确认四向母版后才以该图为锚点为其余方向各生成一张', async () => {
    const tasks = new Map<string, Awaited<ReturnType<GenerationApis['create']>>>()
    let sequence = 0
    const generationApis: GenerationApis = {
      create: vi.fn(async (input) => {
        const id = `task-${++sequence}`
        const direction = input.direction ?? 'east'
        const candidateCount = input.type === 'complete_animation' ? 0 : (input.candidateCount ?? 3)
        const task =
          input.type === 'complete_animation'
            ? {
                id,
                projectId: input.projectId,
                type: 'complete_animation' as const,
                status: 'pending' as const,
                result: null,
                error: null,
              }
            : {
                id,
                projectId: input.projectId,
                type: input.type,
                status: 'completed' as const,
                result: {
                  type: input.type,
                  direction,
                  images: Array.from({ length: candidateCount }, (_, index) => ({
                    url: `${direction}-${index + 1}.png`,
                  })),
                },
                error: null,
              }
        tasks.set(id, task)
        return task
      }) as GenerationApis['create'],
      get: vi.fn(async (_projectId, id) => structuredClone(tasks.get(id)!)),
      subscribe: vi.fn((...args: unknown[]) => {
        const id = String(args[1])
        const listener = (typeof args[2] === 'function' ? args[2] : args[3]) as (
          event: unknown,
        ) => void
        const task = tasks.get(id)!
        queueMicrotask(() =>
          listener({
            taskId: id,
            type: task.type,
            status: task.status,
            result: task.result,
            error: task.error,
          }),
        )
        return () => undefined
      }) as GenerationApis['subscribe'],
    }
    let character = characterFixture({
      id: 'direction-character',
      workflowRunId: 'run-1',
      referenceImageUrl: null,
    })
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      characterApis: mutableCharacterApis(
        () => character,
        (value) => (character = value),
      ),
      prepareProject: vi.fn(async () => ({
        id: 'project-1',
        spriteSize: { width: 256, height: 256 },
        directionalMovement: 'four-way' as const,
      })),
      projectApis: projectReader(undefined, 'four-way'),
    })

    const session = await service.start('四向像素骑士', 'four-way')
    await vi.waitFor(async () => {
      await expect(session.getTemplateCandidates()).resolves.toHaveLength(3)
    })

    await session.confirmCandidate('east-2.png', '挥手')

    const templateCalls = vi
      .mocked(generationApis.create)
      .mock.calls.map(([input]) => input)
      .filter((input) => input.type === 'character_template')
    expect(templateCalls).toEqual([
      expect.objectContaining({ direction: 'east', candidateCount: 3 }),
      expect.objectContaining({
        direction: 'west',
        candidateCount: 1,
        referenceMedia: ['east-2.png'],
      }),
      expect.objectContaining({
        direction: 'north',
        candidateCount: 1,
        referenceMedia: ['east-2.png'],
      }),
      expect.objectContaining({
        direction: 'south',
        candidateCount: 1,
        referenceMedia: ['east-2.png'],
      }),
    ])
    expect(session.getWorkflow().nodes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'action-first-frame' })]),
    )
  })

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

  it('只向 Agent 暴露当前 Run 已确认结果可复用的 Controller 操作', async () => {
    const run = actionRun()
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis: pendingGenerationApis(),
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })

    const session = await service.open(run.id)

    expect(session.getWorkflowAgentContext()).toEqual({
      availableTools: [
        'regenerate_character_template',
        'refine_character_template',
        'regenerate_first_frame',
        'refine_first_frame',
      ],
    })
  })

  it('角色母版微调直接复用当前 Run 的 Controller 和上一版图片', async () => {
    const run = actionRun()
    const generationApis = pendingGenerationApis()
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      prepareProject: vi.fn(),
      projectApis: projectReader({ width: 96, height: 128 }),
    })
    const session = await service.open(run.id)

    await session.regenerateCharacterTemplate('refine', '把披风改成深蓝色')

    expect(generationApis.create).toHaveBeenCalledWith({
      type: 'character_template',
      projectId: 'project-1',
      prompt: '像素骑士\n把披风改成深蓝色',
      referenceMedia: ['template.png'],
      spriteWidth: 96,
      spriteHeight: 128,
      direction: 'east',
    })
  })

  it('动作首帧重新生成直接复用当前 Run 的 Controller 原始输入', async () => {
    const run = actionRun()
    const generationApis = pendingGenerationApis()
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      prepareProject: vi.fn(),
      projectApis: projectReader({ width: 80, height: 80 }),
    })
    const session = await service.open(run.id)

    await session.regenerateFirstFrame('regenerate')

    expect(generationApis.create).toHaveBeenCalledWith({
      type: 'first_frame',
      projectId: 'project-1',
      actionType: 'custom',
      prompt: '挥手',
      spriteWidth: 80,
      spriteHeight: 80,
      referenceMedia: ['template.png'],
      direction: 'east',
    })
  })

  it('只列出各生成节点真正失败的方向', async () => {
    const run: WorkflowRun = {
      id: 'run-failed-directions',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: [
        {
          id: 'setup',
          type: 'character-setup',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: [],
          generations: [],
          error: null,
          input: { prompt: '像素骑士', referenceMedia: [] },
        },
        {
          id: 'template',
          type: 'character-template',
          status: 'failed',
          phase: 'generating',
          dependsOnNodeIds: ['setup'],
          generations: [
            { taskId: 'template-east', role: 'character_template' },
            { taskId: 'template-north', role: 'character_template', direction: 'north' },
          ],
          error: 'north failed',
          selectedImageUrl: null,
        },
        {
          id: 'first-frame',
          type: 'action-first-frame',
          status: 'failed',
          phase: 'generating',
          dependsOnNodeIds: ['template'],
          generations: [
            { taskId: 'first-east', role: 'first_frame' },
            { taskId: 'first-south', role: 'first_frame', direction: 'south' },
          ],
          error: 'east failed',
          input: { outfitId: 'outfit-1', name: '挥手', type: 'custom', prompt: null, fps: 12 },
          selectedFirstFrameUrl: null,
        },
        {
          id: 'method',
          type: 'action-generation-method',
          status: 'failed',
          phase: 'selecting',
          dependsOnNodeIds: ['first-frame'],
          generations: [],
          error: 'method failed',
          method: null,
        },
        {
          id: 'full-frame',
          type: 'action-full-frame',
          status: 'failed',
          phase: 'generating',
          dependsOnNodeIds: ['method'],
          generations: [
            { taskId: 'full-north', role: 'complete_animation', direction: 'north' },
            { taskId: 'full-south', role: 'complete_animation', direction: 'south' },
          ],
          error: 'south failed',
        },
        {
          id: 'deleted-template',
          type: 'character-template',
          status: 'failed',
          phase: 'generating',
          dependsOnNodeIds: ['setup'],
          generations: [{ taskId: 'deleted-east', role: 'character_template' }],
          error: 'deleted failed',
          selectedImageUrl: null,
          deletedAt: '2026-08-20T00:00:00Z',
        },
      ],
    }
    const outcomes = new Map<
      string,
      readonly [
        'character_template' | 'first_frame' | 'complete_animation',
        'pending' | 'completed' | 'failed',
      ]
    >([
      ['template-east', ['character_template', 'pending']],
      ['template-north', ['character_template', 'failed']],
      ['first-east', ['first_frame', 'failed']],
      ['first-south', ['first_frame', 'completed']],
      ['full-north', ['complete_animation', 'completed']],
      ['full-south', ['complete_animation', 'failed']],
    ])
    const generationApis: GenerationApis = {
      create: vi.fn(async (input) => ({
        id: 'retry-north',
        projectId: input.projectId,
        type: input.type,
        status: 'pending' as const,
        result: null,
        error: null,
      })) as GenerationApis['create'],
      get: vi.fn(async (projectId, id) => {
        const outcome =
          outcomes.get(id) ??
          (id === 'retry-north' ? (['character_template', 'pending'] as const) : undefined)
        if (!outcome) throw new Error(`unexpected generation: ${id}`)
        return {
          id,
          projectId,
          type: outcome[0],
          status: outcome[1],
          result: null,
          error: outcome[1] === 'failed' ? `${id} failed` : null,
        }
      }) as GenerationApis['get'],
      subscribe: vi.fn(() => () => undefined),
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(undefined, 'four-way'),
    })

    const session = await service.open(run.id)

    await expect(session.getFailedGenerationDirections()).resolves.toEqual([
      { nodeId: 'template', direction: 'north' },
      { nodeId: 'first-frame', direction: 'east' },
      { nodeId: 'full-frame', direction: 'south' },
    ])
    expect(generationApis.get).toHaveBeenCalledTimes(6)

    await session.retryGenerationDirection('template', 'north')

    expect(generationApis.create).toHaveBeenCalledTimes(1)
    expect(generationApis.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'character_template', direction: 'north' }),
    )
  })

  it('没有动作首帧时拒绝确认候选', async () => {
    const run: WorkflowRun = {
      id: 'run-without-first-frame',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes(),
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis: pendingGenerationApis(),
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })
    const session = await service.open(run.id)

    await expect(session.confirmFirstFrame('first.png')).rejects.toThrow(
      '当前运行没有可确认的动作首帧',
    )
  })

  it.each([
    [
      'north',
      { east: 'east-1.png', west: 'west-1.png', south: 'south-1.png' },
      '缺少north方向的用户选择',
    ],
    [
      'south',
      { east: 'east-1.png', west: 'west-1.png', north: 'north-1.png' },
      '缺少south方向的用户选择',
    ],
  ] as const)('四向母版确认拒绝缺失的 %s 方向用户选择', async (missing, selections, message) => {
    const run: WorkflowRun = {
      id: `run-missing-${missing}-template`,
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes('character-1', 'east-1.png'),
    }
    const template = run.nodes[1]
    if (!template || template.type !== 'character-template') throw new Error('missing template')
    template.status = 'active'
    template.phase = 'selecting'
    template.selectedImages = { east: 'east-1.png' }
    template.generations = (['east', 'west', 'north', 'south'] as const).map((direction) => ({
      taskId: `template-${direction}`,
      role: 'character_template' as const,
      ...(direction === 'east' ? {} : { direction }),
    }))
    const generationApis: GenerationApis = {
      create: vi.fn(),
      get: vi.fn(async (projectId, id) => {
        const direction = id.replace('template-', '') as 'east' | 'west' | 'north' | 'south'
        return {
          id,
          projectId,
          type: 'character_template' as const,
          status: 'completed' as const,
          result: {
            type: 'character_template' as const,
            direction,
            images:
              direction === missing
                ? []
                : [{ url: `${direction}-1.png` }, { url: `${direction}-2.png` }],
          },
          error: null,
        }
      }),
      subscribe: vi.fn(() => () => undefined),
    }
    let character = characterFixture({
      workflowRunId: run.id,
      referenceImageUrl: 'east-1.png',
      outfits: [
        {
          id: 'outfit-default',
          characterId: 'character-1',
          name: '默认造型',
          description: null,
          previewUrl: 'east-1.png',
          model3dUrl: null,
          actions: [],
        },
      ],
    })
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      characterApis: mutableCharacterApis(
        () => character,
        (value) => (character = value),
      ),
      prepareProject: vi.fn(),
      projectApis: projectReader(undefined, 'four-way'),
    })
    const session = await service.open(run.id)

    await expect(session.confirmCandidate(selections, '')).rejects.toThrow(message)
  })

  it('四向首帧确认拒绝缺失的同方向候选', async () => {
    const run = actionRun(true)
    const firstFrame = run.nodes.find((node) => node.type === 'action-first-frame')!
    firstFrame.generations = (['east', 'west', 'north', 'south'] as const).map((direction) => ({
      taskId: `first-${direction}`,
      role: 'first_frame' as const,
      ...(direction === 'east' ? {} : { direction }),
    }))
    const generationApis: GenerationApis = {
      create: vi.fn(),
      get: vi.fn(async (projectId, id) => {
        const direction = id.replace('first-', '') as 'east' | 'west' | 'north' | 'south'
        return {
          id,
          projectId,
          type: 'first_frame' as const,
          status: 'completed' as const,
          result: {
            type: 'first_frame' as const,
            direction,
            images:
              direction === 'north'
                ? []
                : [{ url: `${direction}-1.png` }, { url: `${direction}-2.png` }],
          },
          error: null,
        }
      }),
      subscribe: vi.fn(() => () => undefined),
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(undefined, 'four-way'),
    })
    const session = await service.open(run.id)

    await expect(
      session.confirmFirstFrame({
        east: 'east-1.png',
        west: 'west-1.png',
        south: 'south-1.png',
      }),
    ).rejects.toThrow('缺少north方向的用户选择')
  })

  it('继续上传母版时拒绝没有可用造型的已有角色', async () => {
    const run: WorkflowRun = {
      id: 'run-upload-without-outfit',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes(),
    }
    const template = run.nodes[1]
    if (!template || template.type !== 'character-template') throw new Error('missing template')
    template.status = 'active'
    template.phase = 'selecting'
    template.selectedImageUrl = 'template.png'
    const setup = run.nodes[0]
    if (!setup || setup.type !== 'character-setup') throw new Error('missing setup')
    setup.input.characterId = 'character-1'
    const character = characterFixture({
      workflowRunId: run.id,
      outfits: [
        {
          id: 'unrelated-outfit',
          characterId: 'character-1',
          name: '其它造型',
          description: null,
          previewUrl: 'other.png',
          model3dUrl: null,
          actions: [],
        },
      ],
    })
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis: pendingGenerationApis(),
      characterApis: mutableCharacterApis(
        () => character,
        () => undefined,
      ),
      mediaApis: {
        upload: vi.fn(async () => 'replacement.png' as MediaReference),
      },
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })
    const session = await service.open(run.id)

    await expect(
      session.continueWithUploadedTemplate(new File(['pixels'], 'replacement.png'), ''),
    ).rejects.toThrow('角色母版缺少可用造型')
  })

  it('重复确认母版时拒绝没有可用造型的已有角色', async () => {
    const run: WorkflowRun = {
      id: 'run-confirm-without-outfit',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes(),
    }
    const template = run.nodes[1]
    if (!template || template.type !== 'character-template') throw new Error('missing template')
    template.status = 'active'
    template.phase = 'selecting'
    template.selectedImageUrl = 'template.png'
    const setup = run.nodes[0]
    if (!setup || setup.type !== 'character-setup') throw new Error('missing setup')
    setup.input.characterId = 'character-1'
    const character = characterFixture({
      workflowRunId: run.id,
      outfits: [
        {
          id: 'unrelated-outfit',
          characterId: 'character-1',
          name: '其它造型',
          description: null,
          previewUrl: 'other.png',
          model3dUrl: null,
          actions: [],
        },
      ],
    })
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis: pendingGenerationApis(),
      characterApis: mutableCharacterApis(
        () => character,
        () => undefined,
      ),
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })
    const session = await service.open(run.id)

    await expect(session.confirmCandidate('template.png', '')).rejects.toThrow(
      '角色母版缺少可用造型',
    )
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
      directionalMovement: 'single',
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

  it('creates the Quick Start project with the selected directional movement', async () => {
    const create = vi.fn(async (input) => ({
      id: 'project-eight-way',
      ...input,
      description: null,
      createdAt: '2026-08-25T00:00:00Z',
      updatedAt: '2026-08-25T00:00:00Z',
    }))
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await expect(prepare('八向像素骑士', 'eight-way')).resolves.toMatchObject({
      id: 'project-eight-way',
      directionalMovement: 'eight-way',
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ directionalMovement: 'eight-way' }),
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

  it('continues to the next readable project name after five conflicts', async () => {
    const create = vi.fn()
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      create.mockRejectedValueOnce(new ProjectNameConflictError())
    }
    create.mockResolvedValueOnce({
      id: 'project-6',
      name: '像素骑士 6',
      spriteSize: { width: 256, height: 256 },
    })
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await expect(prepare('像素骑士')).resolves.toEqual({
      id: 'project-6',
      spriteSize: { width: 256, height: 256 },
    })

    expect(create).toHaveBeenCalledTimes(6)
    expect(create).toHaveBeenNthCalledWith(6, expect.objectContaining({ name: '像素骑士 6' }))
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

  it('stops after a bounded number of conflicting project names', async () => {
    const conflict = new ProjectNameConflictError()
    const create = vi.fn().mockRejectedValue(conflict)
    const prepare = createAutoPrepareProject({ create } as unknown as ProjectApis)

    await expect(prepare('像素骑士')).rejects.toBe(conflict)
    expect(create).toHaveBeenCalledTimes(100)
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
    const createRun = vi.spyOn(workflowRunApis, 'create')
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

    const outfitId = savedCharacter.outfits[0]!.id
    await firstSession.addAction(outfitId, '跳跃')
    await firstSession.addAction(outfitId, '跑步')
    await firstSession.addAction(outfitId, '攻击')
    await firstSession.addAction(outfitId, '站立挥手')
    await firstSession.addAction(outfitId, '跑步攻击')
    const finalRun = firstSession.getWorkflow()
    expect(finalRun.id).toBe(firstRun.id)
    expect(finalRun.nodes.filter((node) => node.type === 'action-first-frame')).toHaveLength(6)
    expect(createRun).toHaveBeenCalledOnce()
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

  it('四向上传单张母版后只生成其余方向，等待用户逐方向确认再创建动作', async () => {
    const generationApis = pendingGenerationApis()
    const prepareProject = vi.fn(async () => ({
      id: 'project-1',
      spriteSize: { width: 256, height: 256 },
      directionalMovement: 'four-way' as const,
    }))
    let savedCharacter = characterFixture({
      description: '挥手',
      referenceImageUrl: 'https://example.test/template.png',
    })
    const characterApis = mutableCharacterApis(
      () => savedCharacter,
      (value) => (savedCharacter = value),
    )
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      characterApis,
      mediaApis: {
        upload: vi.fn(async () => 'https://example.test/template.png' as MediaReference),
      },
      prepareProject,
      projectApis: projectReader(undefined, 'four-way'),
    })

    const session = await service.startWithUploadedTemplate(
      new File(['pixels'], 'hero.png', { type: 'image/png' }),
      '挥手',
      undefined,
      'four-way',
    )

    expect(prepareProject).toHaveBeenCalledWith('挥手', 'four-way')
    const calls = vi.mocked(generationApis.create).mock.calls.map(([input]) => input)
    expect(
      calls.filter((input) => input.type === 'character_template').map((input) => input.direction),
    ).toEqual(['west', 'north', 'south'])
    expect(calls.some((input) => input.type === 'first_frame')).toBe(false)
    expect(
      session.getWorkflow().nodes.find((node) => node.type === 'character-template'),
    ).toMatchObject({
      status: 'active',
      phase: 'generating',
      selectedImages: { east: 'https://example.test/template.png' },
    })
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
          model3dUrl: null,
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
    await expect(session.getTemplateCandidates()).resolves.toEqual([
      { direction: 'east', index: 0, imageUrl: 'template.png' },
    ])
    await expect(session.getActionFrames()).resolves.toEqual([
      { index: 7, imageUrl: 'frame-7.png', durationMs: 83 },
      { index: 9, imageUrl: 'frame-9.png', durationMs: null },
    ])
    await expect(session.getExportModel()).rejects.toThrow('挥手的帧序号必须从 0 连续排列')
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

  it('Quick Start 四向审核发布时保留全部方向序列', async () => {
    const run = actionRun()
    const fullFrame = run.nodes.find((node) => node.type === 'action-full-frame')!
    fullFrame.generations = [
      { taskId: 'task-east', role: 'complete_animation', direction: 'east' },
      { taskId: 'task-west', role: 'complete_animation', direction: 'west' },
      { taskId: 'task-north', role: 'complete_animation', direction: 'north' },
      { taskId: 'task-south', role: 'complete_animation', direction: 'south' },
    ]
    const generationApis: GenerationApis = {
      create: vi.fn(),
      get: vi.fn(async (projectId, id) => {
        const direction = id.replace('task-', '') as 'east' | 'west' | 'north' | 'south'
        return {
          id,
          projectId,
          type: 'complete_animation' as const,
          status: 'completed' as const,
          result: {
            type: 'complete_animation' as const,
            direction,
            frames: [{ index: 0, url: `${direction}.png`, durationMs: 80 }],
          },
          error: null,
        }
      }),
      subscribe: vi.fn(() => () => undefined),
    }
    let character = characterWithDefaultOutfit(run.id)
    const characterApis = mutableCharacterApis(
      () => character,
      (value) => (character = value),
    )
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      characterApis,
      prepareProject: vi.fn(),
      projectApis: projectReader({ width: 256, height: 256 }, 'four-way'),
    })

    const session = await service.open(run.id)
    await session.approveReview()

    expect(character.outfits[0]?.actions[0]?.sequences?.map((item) => item.direction)).toEqual([
      'east',
      'west',
      'north',
      'south',
    ])
    expect(character.outfits[0]?.actions[0]?.sequences?.[1]).toMatchObject({
      direction: 'west',
      sourceDirection: null,
      mirrorX: false,
      frames: [{ imageUrl: 'west.png' }],
    })
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
    '单向 Character 写入失败且无法重新打开母版节点时上报错误',
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
          directionalMovement: 'single' as const,
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

  it('四向继续上传替换母版时只替换东向并生成其它独立方向', async () => {
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
              model3dUrl: null,
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
      projectApis: projectReader({ width: 256, height: 256 }, 'four-way'),
      mediaApis: { upload: vi.fn(async () => 'replacement.png' as MediaReference) },
      prepareProject: vi.fn(),
    })

    const session = await service.open(candidateRun.id)
    const updateCharacter = vi.mocked(characterApis.update)
    updateCharacter.mockRejectedValueOnce(new Error('uploaded templates write failed'))
    await expect(
      session.continueWithUploadedTemplate(
        new File(['replacement'], 'replacement.png', { type: 'image/png' }),
        '',
      ),
    ).rejects.toThrow('uploaded templates write failed')
    expect(
      session.getWorkflow().nodes.find((node) => node.type === 'character-template'),
    ).toMatchObject({
      status: 'active',
      phase: 'selecting',
      selectedImages: { east: 'replacement.png' },
    })

    const continued = await session.continueWithUploadedTemplate(
      new File(['replacement'], 'replacement.png', { type: 'image/png' }),
      '',
    )
    expect(continued.nodes.find((node) => node.type === 'character-setup')).toMatchObject({
      input: { characterId: 'character-restore' },
    })
    expect(continued.nodes.find((node) => node.type === 'character-template')).toMatchObject({
      status: 'active',
      phase: 'generating',
      selectedImageUrl: 'replacement.png',
      selectedImages: { east: 'replacement.png' },
    })
    expect(continued.nodes.some((node) => node.type === 'action-first-frame')).toBe(false)
    expect(character.templates).toEqual([
      {
        direction: 'east',
        sourceDirection: null,
        mirrorX: false,
        imageUrl: 'replacement.png',
      },
      {
        direction: 'west',
        sourceDirection: 'east',
        mirrorX: true,
        imageUrl: null,
      },
    ])
    expect(vi.mocked(generationApis.create).mock.calls.map(([input]) => input.direction)).toEqual([
      'west',
      'north',
      'south',
    ])
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
          model3dUrl: null,
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
          model3dUrl: null,
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
        { direction: 'east', index: 0, imageUrl: 'candidate.png' },
        { direction: 'east', index: 1, imageUrl: 'candidate-2.png' },
        { direction: 'east', index: 2, imageUrl: 'candidate-3.png' },
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

  it('四向候选由用户逐方向确认后才生成各方向动作', async () => {
    const tasks = new Map<string, Awaited<ReturnType<GenerationApis['create']>>>()
    let sequence = 0
    const generationApis: GenerationApis = {
      create: vi.fn(async (input) => {
        const id = `direction-task-${++sequence}`
        const direction = input.direction ?? 'east'
        const task =
          input.type === 'complete_animation'
            ? {
                id,
                projectId: input.projectId,
                type: 'complete_animation' as const,
                status: 'pending' as const,
                result: null,
                error: null,
              }
            : {
                id,
                projectId: input.projectId,
                type: input.type,
                status: 'completed' as const,
                result: {
                  type: input.type,
                  direction,
                  images: Array.from({ length: input.candidateCount ?? 3 }, (_, index) => ({
                    url: `${direction}-${input.type}-${index + 1}.png`,
                  })),
                },
                error: null,
              }
        tasks.set(id, task)
        return task
      }) as GenerationApis['create'],
      get: vi.fn(async (_projectId, id) => structuredClone(tasks.get(id)!)),
      subscribe: vi.fn(() => () => undefined),
    }
    let character = characterFixture({
      id: 'direction-character',
      description: '四向骑士',
      referenceImageUrl: 'east-character_template-1.png',
    })
    const characterApis = mutableCharacterApis(
      () => character,
      (value) => (character = value),
    )
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      characterApis,
      prepareProject: vi.fn(async () => ({
        id: 'project-1',
        spriteSize: { width: 256, height: 256 },
        directionalMovement: 'four-way' as const,
      })),
      projectApis: projectReader(),
    })

    const session = await service.start('四向骑士')
    await vi.waitFor(async () => {
      await expect(session.getTemplateCandidates()).resolves.toEqual([
        { direction: 'east', index: 0, imageUrl: 'east-character_template-1.png' },
        { direction: 'east', index: 1, imageUrl: 'east-character_template-2.png' },
        { direction: 'east', index: 2, imageUrl: 'east-character_template-3.png' },
      ])
    })

    await session.confirmCandidate('east-character_template-2.png', '')

    await vi.waitFor(async () => {
      await expect(session.getTemplateCandidates()).resolves.toEqual([
        { direction: 'east', index: 0, imageUrl: 'east-character_template-1.png' },
        { direction: 'east', index: 1, imageUrl: 'east-character_template-2.png' },
        { direction: 'east', index: 2, imageUrl: 'east-character_template-3.png' },
        { direction: 'west', index: 0, imageUrl: 'west-character_template-1.png' },
        { direction: 'north', index: 0, imageUrl: 'north-character_template-1.png' },
        { direction: 'south', index: 0, imageUrl: 'south-character_template-1.png' },
      ])
    })
    const selectedTemplates = {
      east: 'east-character_template-2.png',
      west: 'west-character_template-1.png',
      north: 'north-character_template-1.png',
      south: 'south-character_template-1.png',
    }
    const confirmTemplates = session.confirmCandidate as unknown as (
      selectedImages: typeof selectedTemplates,
      actionDescription: string,
    ) => Promise<WorkflowRun>
    await confirmTemplates(selectedTemplates, '挥手')

    await vi.waitFor(async () => {
      await expect(session.getFirstFrameCandidates()).resolves.toEqual([
        { direction: 'east', index: 0, imageUrl: 'east-first_frame-1.png' },
        { direction: 'east', index: 1, imageUrl: 'east-first_frame-2.png' },
        { direction: 'east', index: 2, imageUrl: 'east-first_frame-3.png' },
        { direction: 'west', index: 0, imageUrl: 'west-first_frame-1.png' },
        { direction: 'west', index: 1, imageUrl: 'west-first_frame-2.png' },
        { direction: 'west', index: 2, imageUrl: 'west-first_frame-3.png' },
        { direction: 'north', index: 0, imageUrl: 'north-first_frame-1.png' },
        { direction: 'north', index: 1, imageUrl: 'north-first_frame-2.png' },
        { direction: 'north', index: 2, imageUrl: 'north-first_frame-3.png' },
        { direction: 'south', index: 0, imageUrl: 'south-first_frame-1.png' },
        { direction: 'south', index: 1, imageUrl: 'south-first_frame-2.png' },
        { direction: 'south', index: 2, imageUrl: 'south-first_frame-3.png' },
      ])
    })
    expect(
      vi
        .mocked(generationApis.create)
        .mock.calls.filter(([input]) => input.type === 'complete_animation'),
    ).toHaveLength(0)
    const selectedFirstFrames = {
      east: 'east-first_frame-2.png',
      west: 'west-first_frame-2.png',
      north: 'north-first_frame-2.png',
      south: 'south-first_frame-2.png',
    }
    const confirmFirstFrames = session.confirmFirstFrame as unknown as (
      selectedImages: typeof selectedFirstFrames,
    ) => Promise<WorkflowRun>
    await confirmFirstFrames(selectedFirstFrames)

    await vi.waitFor(() =>
      expect(
        vi
          .mocked(generationApis.create)
          .mock.calls.filter(([input]) => input.type === 'complete_animation'),
      ).toHaveLength(4),
    )
    expect(character.templates).toEqual([
      {
        direction: 'east',
        sourceDirection: null,
        mirrorX: false,
        imageUrl: 'east-character_template-2.png',
      },
      {
        direction: 'west',
        sourceDirection: null,
        mirrorX: false,
        imageUrl: 'west-character_template-1.png',
      },
      {
        direction: 'north',
        sourceDirection: null,
        mirrorX: false,
        imageUrl: 'north-character_template-1.png',
      },
      {
        direction: 'south',
        sourceDirection: null,
        mirrorX: false,
        imageUrl: 'south-character_template-1.png',
      },
    ])
    const firstFrameCalls = vi
      .mocked(generationApis.create)
      .mock.calls.map(([input]) => input)
      .filter((input) => input.type === 'first_frame')
    expect(firstFrameCalls.map((input) => input.direction)).toEqual([
      'east',
      'west',
      'north',
      'south',
    ])
    expect(firstFrameCalls.map((input) => input.referenceMedia[0])).toEqual([
      'east-character_template-2.png',
      'west-character_template-1.png',
      'north-character_template-1.png',
      'south-character_template-1.png',
    ])
    const animationCalls = vi
      .mocked(generationApis.create)
      .mock.calls.map(([input]) => input)
      .filter((input) => input.type === 'complete_animation')
    expect(animationCalls.map((input) => input.firstFrameUrl)).toEqual([
      'east-first_frame-2.png',
      'west-first_frame-2.png',
      'north-first_frame-2.png',
      'south-first_frame-2.png',
    ])
    expect(animationCalls.map((input) => input.prompt)).toEqual(['挥手', '挥手', '挥手', '挥手'])
    expect(
      session.getWorkflow().nodes.find((node) => node.type === 'action-full-frame'),
    ).toMatchObject({ input: { prompt: '挥手' } })
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
          model3dUrl: null,
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

  it('现有四向角色仍缺真实西向母版时阻止创建新动作', async () => {
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
          model3dUrl: null,
          actions: [],
        },
      ],
    })
    Object.assign(character, {
      templates: [
        {
          direction: 'east',
          sourceDirection: null,
          mirrorX: false,
          imageUrl: 'existing.png',
        },
        {
          direction: 'west',
          sourceDirection: 'east',
          mirrorX: true,
          imageUrl: null,
        },
        {
          direction: 'north',
          sourceDirection: null,
          mirrorX: false,
          imageUrl: 'existing-north.png',
        },
        {
          direction: 'south',
          sourceDirection: null,
          mirrorX: false,
          imageUrl: 'existing-south.png',
        },
      ],
    })
    const nodes = setupNodes(character.id, 'existing.png')
    Object.assign(nodes[1], {
      selectedImages: {
        east: 'existing.png',
        north: 'existing-north.png',
        south: 'existing-south.png',
      },
    })
    const run: WorkflowRun = {
      id: 'old-run',
      projectId: character.projectId,
      version: 1,
      storageStatus: 'active',
      nodes,
    }
    const generationApis = pendingGenerationApis()
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      characterApis: {
        get: vi.fn(async () => character),
        listByProject: vi.fn(async () => ({ items: [character], total: 1, page: 1, pageSize: 20 })),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      } as unknown as CharacterApis,
      projectApis: projectReader(undefined, 'four-way'),
      prepareProject: vi.fn(),
    })

    const session = await service.open(run.id)
    await expect(session.addAction('outfit-existing', '向北行走')).rejects.toThrow(
      '角色母版尚未确认方向 west',
    )
    expect(generationApis.create).not.toHaveBeenCalled()
  })

  it('keeps a custom action display name bounded while preserving its full prompt', async () => {
    const actionDescription = '挥手向远处的朋友打招呼并转身轻轻鞠躬并保持姿态'
    const run: WorkflowRun = {
      id: 'old-run',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: setupNodes(),
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis: pendingGenerationApis(),
      projectApis: projectReader(),
      prepareProject: vi.fn(),
    })

    const session = await service.open(run.id)
    await expect(session.addAction('outfit-existing', '   ')).rejects.toThrow(
      '请先描述要新增的动作',
    )
    await session.addAction('outfit-existing', actionDescription)
    expect(
      session.getWorkflow().nodes.find((node) => node.type === 'action-first-frame'),
    ).toMatchObject({
      input: {
        name: '挥手向远处的朋友打招呼并转身轻轻鞠躬并…',
        prompt: actionDescription,
        type: 'custom',
      },
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

  it('reports unavailable upload dependencies and invalid template continuation explicitly', async () => {
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
      { direction: 'east', index: 0, imageUrl: firstFrameUrls[0] },
      { direction: 'east', index: 1, imageUrl: firstFrameUrls[1] },
      { direction: 'east', index: 2, imageUrl: firstFrameUrls[2] },
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

  it('动作首帧进入 selecting 后等待用户确认而不自动读取候选', async () => {
    const run = actionRun(true)
    const generationApis = pendingGenerationApis()
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      prepareProject: vi.fn(),
      projectApis: projectReader(),
    })
    const session = await service.open(run.id)

    await session.resume()
    await Promise.resolve()

    expect(generationApis.get).not.toHaveBeenCalled()
    expect(
      session.getWorkflow().nodes.find((node) => node.type === 'action-first-frame'),
    ).toMatchObject({ status: 'active', phase: 'selecting' })
    await session.interrupt()
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
