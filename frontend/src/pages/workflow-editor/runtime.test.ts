import { describe, expect, it, vi } from 'vitest'

import type {
  Character,
  Generation,
  GenerationApis,
  Project,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import { createRealWorkflowEditorSession, createUnavailableGenerationApis } from './runtime'

describe('createRealWorkflowEditorSession', () => {
  it('只用主仓库公开接口恢复 WorkflowRun 并装配 Controller', async () => {
    const workflow = workflowFixture()
    const project = projectFixture()
    const character = characterFixture()
    const workflowRunApis: WorkflowRunApis = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(workflow),
      update: vi.fn(async (run) => ({ ...structuredClone(run), version: run.version + 1 })),
      remove: vi.fn(),
    }
    const generationApis: GenerationApis = {
      create: vi.fn() as GenerationApis['create'],
      get: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    }
    const projectApis = { get: vi.fn().mockResolvedValue(project) }
    const unrelatedCharacter = { ...characterFixture(), id: '10', workflowRunId: '99' }
    const characterApis = {
      listByProject: vi
        .fn()
        .mockResolvedValueOnce({
          items: [unrelatedCharacter],
          total: 101,
          page: 1,
          pageSize: 100,
        })
        .mockResolvedValueOnce({
          items: [character],
          total: 101,
          page: 2,
          pageSize: 100,
        }),
      create: vi.fn(),
      update: vi.fn(),
    }

    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis,
      generationApis,
      projectApis,
      characterApis,
      onAsyncError: vi.fn(),
    })

    expect(workflowRunApis.get).toHaveBeenCalledWith('42')
    expect(projectApis.get).toHaveBeenCalledWith('1')
    expect(characterApis.listByProject).toHaveBeenNthCalledWith(1, '1', {
      page: 1,
      pageSize: 100,
    })
    expect(characterApis.listByProject).toHaveBeenNthCalledWith(2, '1', {
      page: 2,
      pageSize: 100,
    })
    expect(session.controller.getWorkflow()).toEqual(workflow)
    expect(session.project).toEqual(project)
    expect(session.character).toEqual(character)
    expect('mode' in session).toBe(false)
    expect('playtestTarget' in session).toBe(false)
  })

  it('拒绝把同一 WorkflowRun 绑定到多个角色', async () => {
    const workflow = workflowFixture()
    const characterApis = {
      listByProject: vi.fn().mockResolvedValue({
        items: [characterFixture(), { ...characterFixture(), id: '10' }],
        total: 2,
        page: 1,
        pageSize: 100,
      }),
      create: vi.fn(),
      update: vi.fn(),
    }

    await expect(
      createRealWorkflowEditorSession('42', {
        workflowRunApis: {
          create: vi.fn(),
          get: vi.fn().mockResolvedValue(workflow),
          update: vi.fn(),
          remove: vi.fn(),
        },
        generationApis: {
          create: vi.fn() as GenerationApis['create'],
          get: vi.fn(),
          subscribe: vi.fn(() => () => undefined),
        },
        projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
        characterApis,
        onAsyncError: vi.fn(),
      }),
    ).rejects.toThrow('WorkflowRun 42 关联了多个角色')
  })

  it('把 Controller 异步错误同时交给装配层和页面订阅者', async () => {
    const onAsyncError = vi.fn()
    const workflow = workflowFixture()
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(workflow),
        update: vi.fn(async (run) => ({ ...structuredClone(run), version: run.version + 1 })),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
      onAsyncError,
    })
    const pageError = vi.fn()
    session.subscribeErrors(pageError)
    let notificationCount = 0
    session.controller.subscribe(() => {
      notificationCount += 1
      if (notificationCount > 1) throw new Error('异步保存回调失败')
    })

    await session.controller.restartFromNode('setup')

    expect(onAsyncError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '异步保存回调失败' }),
    )
    expect(pageError).toHaveBeenCalledWith(expect.objectContaining({ message: '异步保存回调失败' }))
  })

  it('确认身份母版时为尚未绑定角色的 WorkflowRun 创建 Character 和默认造型', async () => {
    const workflow = selectingCharacterTemplateWorkflowFixture()
    const create = vi.fn().mockResolvedValue(characterFixture())
    const update = vi.fn(async (character: Character) => structuredClone(character))
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(workflow),
        update: vi.fn(async (run) => ({ ...structuredClone(run), version: run.version + 1 })),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
        }),
        create,
        update,
      },
      onAsyncError: vi.fn(),
    })

    const character = await session.confirmCharacterTemplate(
      'template',
      'https://assets.windup.test/master.png',
    )

    expect(create).toHaveBeenCalledWith({
      projectId: '1',
      workflowRunId: '42',
      description: '冒险家',
      referenceImageUrl: 'https://assets.windup.test/master.png',
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '9',
        outfits: [
          expect.objectContaining({
            id: 'outfit-default',
            characterId: '9',
            name: '常态造型',
            previewUrl: 'https://assets.windup.test/master.png',
            actions: [],
          }),
        ],
      }),
    )
    expect(character.outfits).toHaveLength(1)
    expect(
      session.controller.getWorkflow().nodes.find((node) => node.id === 'template'),
    ).toMatchObject({ status: 'passed', phase: 'completed' })
  })

  it('发布 Character 动作资产后由调用方单独推进审核节点', async () => {
    const events: string[] = []
    const workflow = reviewingWorkflowFixture()
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(workflow),
        update: vi.fn(async (run) => {
          events.push('approve')
          return { ...structuredClone(run), version: run.version + 1 }
        }),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn().mockResolvedValue(completeAnimationFixture()),
        subscribe: vi.fn(() => () => undefined),
      },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [characterWithOutfitFixture()],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        update: vi.fn(async (character) => {
          events.push('publish')
          return structuredClone(character)
        }),
      },
      onAsyncError: vi.fn(),
    })

    const published = await session.publishReviewedAction('action-walk:review')

    expect(events).toEqual(['publish'])
    expect(published.outfits[0]?.actions).toEqual([
      expect.objectContaining({ id: 'action-walk', frameCount: 2 }),
    ])
    expect(
      session.controller.getWorkflow().nodes.find((node) => node.id === 'action-walk:review'),
    ).toMatchObject({ status: 'active', phase: 'reviewing' })

    await session.controller.approveReview('action-walk:review')

    expect(events).toEqual(['publish', 'approve'])
    expect(
      session.controller.getWorkflow().nodes.find((node) => node.id === 'action-walk:review'),
    ).toMatchObject({ status: 'passed', phase: 'completed' })
  })
})

describe('createUnavailableGenerationApis', () => {
  it('在 main 尚无 Generation HTTP 适配器时明确失败，不返回演示结果', async () => {
    const apis = createUnavailableGenerationApis()

    await expect(apis.create(characterGenerationInput())).rejects.toThrow(
      'GenerationApis 尚未接入真实后端',
    )
    await expect(apis.get('1', '9')).rejects.toThrow('GenerationApis 尚未接入真实后端')
    expect(() => apis.subscribe('1', '9', vi.fn())).not.toThrow()
  })
})

function workflowFixture(): WorkflowRun {
  return {
    id: '42',
    projectId: '1',
    version: 3,
    storageStatus: 'active',
    nodes: [
      {
        id: 'setup',
        type: 'character-setup',
        status: 'active',
        phase: 'configuring',
        dependsOnNodeIds: [],
        generations: [],
        error: null,
        input: { prompt: '冒险家', referenceMedia: [] },
      },
    ],
  }
}

function projectFixture(): Project {
  return {
    id: '1',
    ownerId: '7',
    workflowId: null,
    name: '正式项目',
    perspective: 'side',
    directionalMovement: 'single',
    spriteSize: { width: 64, height: 64 },
    gameStyle: null,
    sampleImageUrl: null,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  }
}

function characterFixture(): Character {
  return {
    id: '9',
    projectId: '1',
    workflowRunId: '42',
    name: '正式角色',
    description: null,
    referenceImageUrl: null,
    dataVersion: 1,
    status: 1,
    outfits: [],
  }
}

function characterWithOutfitFixture(): Character {
  return {
    ...characterFixture(),
    outfits: [
      {
        id: 'outfit-default',
        characterId: '9',
        name: '常态造型',
        description: null,
        previewUrl: null,
        actions: [],
      },
    ],
  }
}

function selectingCharacterTemplateWorkflowFixture(): WorkflowRun {
  return {
    id: '42',
    projectId: '1',
    version: 4,
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
        input: { prompt: '冒险家', referenceMedia: [] },
      },
      {
        id: 'template',
        type: 'character-template',
        status: 'active',
        phase: 'selecting',
        dependsOnNodeIds: ['setup'],
        generations: [{ taskId: 'character-task', role: 'character_template' }],
        error: null,
        selectedImageUrl: null,
      },
    ],
  }
}

function reviewingWorkflowFixture(): WorkflowRun {
  return {
    id: '42',
    projectId: '1',
    version: 7,
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
        input: { prompt: '冒险家', referenceMedia: [] },
      },
      {
        id: 'template',
        type: 'character-template',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['setup'],
        generations: [],
        error: null,
        selectedImageUrl: 'https://assets.windup.test/master.png',
      },
      {
        id: 'action-walk',
        type: 'action-first-frame',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['template'],
        generations: [],
        error: null,
        input: {
          outfitId: 'outfit-default',
          name: '行走',
          type: 'walk',
          prompt: null,
          fps: 12,
        },
        selectedFirstFrameUrl: 'https://assets.windup.test/walk-01.png',
      },
      {
        id: 'action-walk:method',
        type: 'action-generation-method',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['action-walk'],
        generations: [],
        error: null,
        method: 'video-cropping',
      },
      {
        id: 'action-walk:full-frame',
        type: 'action-full-frame',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['action-walk:method'],
        generations: [{ taskId: 'generation-walk', role: 'complete_animation' }],
        error: null,
      },
      {
        id: 'action-walk:review',
        type: 'review',
        status: 'active',
        phase: 'reviewing',
        dependsOnNodeIds: ['action-walk:full-frame'],
        generations: [],
        error: null,
      },
    ],
  }
}

function completeAnimationFixture(): Generation<'complete_animation'> {
  return {
    id: 'generation-walk',
    projectId: '1',
    type: 'complete_animation',
    status: 'completed',
    error: null,
    result: {
      type: 'complete_animation',
      frames: [
        { url: 'https://assets.windup.test/walk-01.png' },
        { url: 'https://assets.windup.test/walk-02.png' },
      ],
    },
  }
}

function characterGenerationInput() {
  return {
    type: 'character_template' as const,
    projectId: '1',
    prompt: '冒险家',
    spriteWidth: 64,
    spriteHeight: 64,
    referenceMedia: [],
  }
}
