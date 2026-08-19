import { describe, expect, it, vi } from 'vitest'

import type {
  Character,
  Generation,
  GenerationApis,
  MediaApis,
  MediaReference,
  Project,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import { WorkflowRunConflictError } from '@/entities'
import { registerApiAccessTokenProvider, registerApiUnauthorizedRecovery } from '@/shared/api'
import { createDefaultRealWorkflowEditorSession, createRealWorkflowEditorSession } from './runtime'

describe('createRealWorkflowEditorSession', () => {
  it('通过公开 MediaApis 上传角色参考图并固定用途分类', async () => {
    const uploaded = 'https://assets.windup.test/reference.png' as MediaReference
    const mediaApis: Pick<MediaApis, 'upload'> = {
      upload: vi.fn().mockResolvedValue(uploaded),
    }
    const { session } = await createCharacterTemplateSession({ mediaApis })
    const file = new File(['pixels'], 'reference.png', { type: 'image/png' })
    const controller = new AbortController()

    await expect(session.uploadReferenceImage(file, controller.signal)).resolves.toBe(uploaded)
    expect(mediaApis.upload).toHaveBeenCalledWith(file, 'reference-image', controller.signal)
  })

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
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    }

    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis,
      generationApis,
      mediaApis: { upload: vi.fn() },
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
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
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
        mediaApis: { upload: vi.fn() },
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
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
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
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
        }),
        create,
        get: vi.fn(),
        update,
        remove: vi.fn(),
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

  it('拒绝用空图片确认身份母版', async () => {
    const { session, create } = await createCharacterTemplateSession()

    await expect(session.confirmCharacterTemplate('template', '   ')).rejects.toThrow(
      '必须选择角色母版',
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('新建 Character 后 Run 冲突时删除未绑定的孤儿角色', async () => {
    const { session, remove } = await createCharacterTemplateSession({
      workflowRunUpdate: vi
        .fn()
        .mockRejectedValue(new WorkflowRunConflictError('执行记录版本冲突')),
    })

    await expect(
      session.confirmCharacterTemplate('template', 'https://assets.windup.test/master.png'),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError)

    expect(remove).toHaveBeenCalledWith('9')
    expect(session.controller.getWorkflow().nodes).toEqual(
      selectingCharacterTemplateWorkflowFixture().nodes,
    )
  })

  it('无法回读 Run 确认保存结果时保留可幂等 Character', async () => {
    const workflow = selectingCharacterTemplateWorkflowFixture()
    const reconcileError = new Error('WorkflowRun 回读失败')
    const getRun = vi.fn().mockResolvedValueOnce(workflow).mockRejectedValue(reconcileError)
    const remove = vi.fn()
    const onAsyncError = vi.fn()
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: getRun,
        update: vi.fn().mockRejectedValue(new WorkflowRunConflictError('执行记录版本冲突')),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
        create: vi.fn().mockResolvedValue(characterFixture()),
        get: vi.fn(),
        update: vi.fn(async (character) => structuredClone(character)),
        remove,
      },
      onAsyncError,
    })

    await expect(
      session.confirmCharacterTemplate('template', 'https://assets.windup.test/master.png'),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError)

    expect(remove).not.toHaveBeenCalled()
    expect(onAsyncError).toHaveBeenCalledWith(reconcileError)
  })

  it('拒绝确认当前不可选择的身份母版节点', async () => {
    const { session, create } = await createCharacterTemplateSession()

    await expect(
      session.confirmCharacterTemplate('missing', 'https://assets.windup.test/master.png'),
    ).rejects.toThrow('角色母版节点当前不能确认')
    expect(create).not.toHaveBeenCalled()
  })

  it('拒绝确认缺少角色设定依赖的身份母版', async () => {
    const workflow = selectingCharacterTemplateWorkflowFixture()
    workflow.nodes = workflow.nodes.filter((node) => node.type !== 'character-setup')
    const { session, create } = await createCharacterTemplateSession({ workflow })

    await expect(
      session.confirmCharacterTemplate('template', 'https://assets.windup.test/master.png'),
    ).rejects.toThrow('角色母版缺少角色设定')
    expect(create).not.toHaveBeenCalled()
  })

  it('已有 Character 和造型时只推进身份母版节点', async () => {
    const existing = characterWithOutfitFixture()
    const { session, create, update } = await createCharacterTemplateSession({
      characters: [existing],
    })

    const character = await session.confirmCharacterTemplate(
      'template',
      'https://assets.windup.test/master.png',
    )

    expect(character).toEqual(existing)
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(
      session.controller.getWorkflow().nodes.find((node) => node.id === 'template'),
    ).toMatchObject({ status: 'passed', phase: 'completed' })
  })

  it('已有 Character 新增造型后 Run 冲突时恢复修改前的角色资产', async () => {
    const existing = characterFixture()
    const updates: Character[] = []
    const workflow = selectingCharacterTemplateWorkflowFixture()
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(workflow),
        update: vi.fn().mockRejectedValue(new WorkflowRunConflictError('执行记录版本冲突')),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [existing],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(existing),
        update: vi.fn(async (character) => {
          updates.push(structuredClone(character))
          return { ...structuredClone(character), dataVersion: character.dataVersion + 1 }
        }),
        remove: vi.fn(),
      },
      onAsyncError: vi.fn(),
    })

    await expect(
      session.confirmCharacterTemplate('template', 'https://assets.windup.test/master.png'),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError)

    expect(updates).toHaveLength(2)
    expect(updates[0]!.outfits).toHaveLength(1)
    expect(updates[1]).toMatchObject({ dataVersion: 2, outfits: [] })
    expect(session.controller.getWorkflow().nodes).toEqual(workflow.nodes)
  })

  it('身份母版冲突且角色回滚失败时上报恢复错误', async () => {
    const existing = characterFixture()
    const workflow = selectingCharacterTemplateWorkflowFixture()
    const rollbackError = new Error('角色资产恢复失败')
    const onAsyncError = vi.fn()
    let updateCount = 0
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(workflow),
        update: vi.fn().mockRejectedValue(new WorkflowRunConflictError('执行记录版本冲突')),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [existing],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(existing),
        update: vi.fn(async (character) => {
          updateCount += 1
          if (updateCount > 1) throw rollbackError
          return { ...structuredClone(character), dataVersion: character.dataVersion + 1 }
        }),
        remove: vi.fn(),
      },
      onAsyncError,
    })

    await expect(
      session.confirmCharacterTemplate('template', 'https://assets.windup.test/master.png'),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError)

    expect(onAsyncError).toHaveBeenCalledWith(rollbackError)
  })

  it('发布 Character 动作资产并在同一会话内推进审核节点', async () => {
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
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [characterWithOutfitFixture()],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(characterWithOutfitFixture()),
        update: vi.fn(async (character) => {
          events.push('publish')
          return structuredClone(character)
        }),
        remove: vi.fn(),
      },
      onAsyncError: vi.fn(),
    })

    const published = await session.publishReviewedAction('action-walk:review')

    expect(events).toEqual(['publish', 'approve'])
    expect(published.outfits[0]?.actions).toEqual([
      expect.objectContaining({ id: 'action-walk', frameCount: 2 }),
    ])
    expect(
      session.controller.getWorkflow().nodes.find((node) => node.id === 'action-walk:review'),
    ).toMatchObject({ status: 'passed', phase: 'completed' })
  })

  it('拒绝发布缺少动作首帧依赖的完整动画', async () => {
    const workflow = reviewingWorkflowFixture()
    workflow.nodes = workflow.nodes.filter((node) => node.type !== 'action-first-frame')
    const session = await createRealWorkflowEditorSession('42', {
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
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [characterWithOutfitFixture()],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      onAsyncError: vi.fn(),
    })

    await expect(session.publishReviewedAction('action-walk:review')).rejects.toThrow(
      '完整动画缺少动作首帧节点',
    )
  })

  it('审核 Run 已落库但响应丢失时保留已发布的动作资产', async () => {
    let savedWorkflow = reviewingWorkflowFixture()
    let savedCharacter = characterWithOutfitFixture()
    const updateCharacter = vi.fn(async (character: Character) => {
      savedCharacter = { ...structuredClone(character), dataVersion: character.dataVersion + 1 }
      return structuredClone(savedCharacter)
    })
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: vi.fn(async () => structuredClone(savedWorkflow)),
        update: vi.fn(async (run) => {
          savedWorkflow = { ...structuredClone(run), version: run.version + 1 }
          throw new Error('网络响应丢失')
        }),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn().mockResolvedValue(completeAnimationFixture()),
        subscribe: vi.fn(() => () => undefined),
      },
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        get: vi.fn(async () => structuredClone(savedCharacter)),
        listByProject: vi.fn().mockResolvedValue({
          items: [savedCharacter],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        update: updateCharacter,
        remove: vi.fn(),
      },
      onAsyncError: vi.fn(),
    })

    await expect(session.publishReviewedAction('action-walk:review')).resolves.toMatchObject({
      id: savedCharacter.id,
    })

    expect(updateCharacter).toHaveBeenCalledTimes(1)
    expect(savedCharacter.outfits[0]!.actions).toEqual([
      expect.objectContaining({ id: 'action-walk' }),
    ])
    expect(savedWorkflow.nodes.find((node) => node.id === 'action-walk:review')).toMatchObject({
      status: 'passed',
    })
    expect(
      session.controller.getWorkflow().nodes.find((node) => node.id === 'action-walk:review'),
    ).toMatchObject({ status: 'passed' })
  })

  it('其他客户端已完成同一审核时当前 409 不撤销已发布动作', async () => {
    const initialWorkflow = reviewingWorkflowFixture()
    const latestWorkflow = structuredClone(initialWorkflow)
    const latestSetup = latestWorkflow.nodes.find((node) => node.type === 'character-setup')
    const latestReview = latestWorkflow.nodes.find((node) => node.type === 'review')
    if (!latestSetup || latestSetup.type !== 'character-setup' || !latestReview) {
      throw new Error('测试工作流缺少节点')
    }
    latestSetup.input = { ...latestSetup.input, name: '并发客户端改名' }
    latestReview.status = 'passed'
    latestReview.phase = 'completed'
    latestWorkflow.version += 1
    let character = characterWithOutfitFixture()
    const updateCharacter = vi.fn(async (next: Character) => {
      character = { ...structuredClone(next), dataVersion: next.dataVersion + 1 }
      return structuredClone(character)
    })
    const getRun = vi.fn().mockResolvedValueOnce(initialWorkflow).mockResolvedValue(latestWorkflow)
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: getRun,
        update: vi.fn().mockRejectedValue(new WorkflowRunConflictError('执行记录版本冲突')),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn().mockResolvedValue(completeAnimationFixture()),
        subscribe: vi.fn(() => () => undefined),
      },
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        get: vi.fn(async () => structuredClone(character)),
        listByProject: vi.fn().mockResolvedValue({
          items: [character],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        update: updateCharacter,
        remove: vi.fn(),
      },
      onAsyncError: vi.fn(),
    })

    await expect(session.publishReviewedAction('action-walk:review')).rejects.toBeInstanceOf(
      WorkflowRunConflictError,
    )

    expect(updateCharacter).toHaveBeenCalledTimes(1)
    expect(character.outfits[0]!.actions).toEqual([expect.objectContaining({ id: 'action-walk' })])
  })

  it('动作资产发布后 Run 冲突时恢复修改前的 Character', async () => {
    const original = characterWithOutfitFixture()
    const originalAction = {
      id: 'action-walk',
      outfitId: 'outfit-default',
      name: '原行走动作',
      type: 'walk' as const,
      loop: true,
      fps: 8,
      frameCount: 0,
      frames: [],
    }
    original.outfits[0]!.actions = [originalAction]
    const updates: Character[] = []
    let published: Character | null = null
    const unrelatedAction = {
      id: 'action-jump',
      outfitId: 'outfit-default',
      name: '跳跃',
      type: 'jump',
      loop: false,
      fps: 12,
      frameCount: 0,
      frames: [],
    }
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(reviewingWorkflowFixture()),
        update: vi.fn().mockRejectedValue(new WorkflowRunConflictError('执行记录版本冲突')),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn().mockResolvedValue(completeAnimationFixture()),
        subscribe: vi.fn(() => () => undefined),
      },
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [original],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        get: vi.fn(async () => ({
          ...(published ?? original),
          dataVersion: 3,
          outfits: (published ?? original).outfits.map((outfit) => ({
            ...outfit,
            actions: [...outfit.actions, unrelatedAction],
          })),
        })),
        update: vi.fn(async (character) => {
          updates.push(structuredClone(character))
          if (updates.length === 2) throw new Error('Character 版本冲突')
          const saved = { ...structuredClone(character), dataVersion: character.dataVersion + 1 }
          if (updates.length === 1) published = saved
          return saved
        }),
        remove: vi.fn(),
      },
      onAsyncError: vi.fn(),
    })

    await expect(session.publishReviewedAction('action-walk:review')).rejects.toBeInstanceOf(
      WorkflowRunConflictError,
    )

    expect(updates).toHaveLength(3)
    expect(updates[0]!.outfits[0]!.actions).toHaveLength(1)
    expect(updates[1]).toMatchObject({ dataVersion: 2, outfits: original.outfits })
    expect(updates[2]!.outfits[0]!.actions).toHaveLength(2)
    expect(updates[2]!.outfits[0]!.actions).toEqual(
      expect.arrayContaining([unrelatedAction, originalAction]),
    )
    expect(
      session.controller.getWorkflow().nodes.find((node) => node.id === 'action-walk:review'),
    ).toMatchObject({ status: 'active', phase: 'reviewing' })
  })

  it('审核冲突且动作资产无法回滚时保留发布结果并上报错误', async () => {
    const workflow = reviewingWorkflowFixture()
    const original = characterWithOutfitFixture()
    const rollbackError = new Error('动作资产恢复失败')
    const onAsyncError = vi.fn()
    let published: Character | null = null
    let updateCount = 0
    const session = await createRealWorkflowEditorSession('42', {
      workflowRunApis: {
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(workflow),
        update: vi.fn().mockRejectedValue(new WorkflowRunConflictError('执行记录版本冲突')),
        remove: vi.fn(),
      },
      generationApis: {
        create: vi.fn() as GenerationApis['create'],
        get: vi.fn().mockResolvedValue(completeAnimationFixture()),
        subscribe: vi.fn(() => () => undefined),
      },
      mediaApis: { upload: vi.fn() },
      projectApis: { get: vi.fn().mockResolvedValue(projectFixture()) },
      characterApis: {
        listByProject: vi.fn().mockResolvedValue({
          items: [original],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
        create: vi.fn(),
        get: vi.fn(async () => structuredClone(published ?? original)),
        update: vi.fn(async (character) => {
          updateCount += 1
          if (updateCount > 1) throw rollbackError
          const saved = { ...structuredClone(character), dataVersion: character.dataVersion + 1 }
          published = saved
          return structuredClone(saved)
        }),
        remove: vi.fn(),
      },
      onAsyncError,
    })

    await expect(session.publishReviewedAction('action-walk:review')).rejects.toBeInstanceOf(
      WorkflowRunConflictError,
    )

    expect(onAsyncError).toHaveBeenCalledWith(rollbackError)
  })
})

describe('createDefaultRealWorkflowEditorSession', () => {
  it('使用真实 Generation 接口恢复任务，并在业务 401 后携带新 token 重放一次', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    let accessToken = 'expired-token'
    const unregisterToken = registerApiAccessTokenProvider(() => accessToken)
    const recover = vi.fn(async () => {
      accessToken = 'refreshed-token'
      return true
    })
    const unregisterRecovery = registerApiUnauthorizedRecovery(recover)
    const generationTokens: Array<string | null> = []
    const workflow = selectingCharacterTemplateWorkflowFixture()
    workflow.nodes[1]!.generations = [{ taskId: '91', role: 'character_template' }]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === 'https://api.windup.test/workflow-runs/42') {
        return apiSuccess({
          id: 42,
          project_id: 1,
          nodes: workflow.nodes,
          status: 'active',
          version: 4,
        })
      }
      if (url === 'https://api.windup.test/projects/1') {
        return apiSuccess({
          id: 1,
          workflow_id: null,
          project_name: '正式项目',
          character_perspective: 1,
          directional_movement: 1,
          sprite_width: 64,
          sprite_height: 64,
          game_style: null,
          sprite_sample_url: null,
          create_at: '2026-08-10T00:00:00.000Z',
          update_at: '2026-08-10T00:00:00.000Z',
        })
      }
      if (url === 'https://api.windup.test/characters?project_id=1&page=1&page_size=100') {
        return apiSuccess([], { total: 0, page: 1, page_size: 100 })
      }
      if (url === 'https://api.windup.test/generation/tasks/91?project_id=1') {
        generationTokens.push(new Headers(init?.headers).get('authorization'))
        if (generationTokens.length === 1) {
          return new Response(
            JSON.stringify({ code: 401, message: 'access token expired', data: null }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return apiSuccess({
          id: 91,
          project_id: 1,
          task_type: 'character_image',
          status: 'failed',
          input_payload: { num_images: 3 },
          result: null,
          error_message: 'provider unavailable',
        })
      }
      throw new Error(`意外请求：${url}`)
    })

    try {
      const session = await createDefaultRealWorkflowEditorSession('42')

      await expect(
        session.controller.getGeneration('template', 'character_template'),
      ).resolves.toMatchObject({
        id: '91',
        projectId: '1',
        type: 'character_template',
        status: 'failed',
        error: 'provider unavailable',
      })
      expect(recover).toHaveBeenCalledOnce()
      expect(generationTokens).toEqual(['Bearer expired-token', 'Bearer refreshed-token'])
      session.dispose()
    } finally {
      fetchSpy.mockRestore()
      unregisterRecovery()
      unregisterToken()
      vi.unstubAllEnvs()
    }
  })
})

async function createCharacterTemplateSession(
  options: {
    workflow?: WorkflowRun
    characters?: Character[]
    mediaApis?: Pick<MediaApis, 'upload'>
    workflowRunUpdate?: WorkflowRunApis['update']
  } = {},
) {
  const workflow = options.workflow ?? selectingCharacterTemplateWorkflowFixture()
  const characters = options.characters ?? []
  const create = vi.fn().mockResolvedValue(characterFixture())
  const update = vi.fn(async (character: Character) => structuredClone(character))
  const remove = vi.fn()
  const session = await createRealWorkflowEditorSession('42', {
    workflowRunApis: {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(workflow),
      update:
        options.workflowRunUpdate ??
        vi.fn(async (run) => ({ ...structuredClone(run), version: run.version + 1 })),
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
        items: characters,
        total: characters.length,
        page: 1,
        pageSize: 100,
      }),
      create,
      get: vi.fn().mockResolvedValue(characters[0] ?? characterFixture()),
      update,
      remove,
    },
    mediaApis: options.mediaApis ?? { upload: vi.fn() },
    onAsyncError: vi.fn(),
  })
  return { session, create, update, remove }
}

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
        { index: 0, url: 'https://assets.windup.test/walk-01.png', durationMs: 100 },
        { index: 1, url: 'https://assets.windup.test/walk-02.png', durationMs: null },
      ],
    },
  }
}

function apiSuccess(data: unknown, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ code: 200, message: 'success', data, ...extra }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
