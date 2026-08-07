import { describe, expect, it, vi } from 'vitest'

import type {
  CharacterWorkflowNode,
  Generation,
  GenerationApis,
  GenerationEvent,
  WorkflowActionInput,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import { createWorkflowController } from '.'

function characterNode(overrides: Partial<CharacterWorkflowNode> = {}): CharacterWorkflowNode {
  return {
    id: 'character-1',
    type: 'character',
    status: 'active',
    phase: 'configuring_character',
    dependsOnNodeIds: [],
    generations: [],
    error: null,
    input: { prompt: '像素骑士', referenceMedia: [] },
    selectedImageUrl: null,
    ...overrides,
  }
}

function actionInput(overrides: Partial<WorkflowActionInput> = {}): WorkflowActionInput {
  return {
    outfitId: 'outfit-1',
    name: '行走',
    type: 'walk',
    prompt: null,
    fps: 12,
    ...overrides,
  }
}

function createRun(nodes: WorkflowNode[] = [characterNode()]): WorkflowRun {
  return {
    id: 'run-1',
    projectId: '1',
    version: 1,
    storageStatus: 'active',
    nodes,
  }
}

function createWorkflowApis(initial: WorkflowRun = createRun()) {
  let saved = structuredClone(initial)
  const apis: WorkflowRunApis = {
    create: vi.fn(async (input) => {
      saved = {
        id: 'run-1',
        projectId: input.projectId,
        version: 1,
        storageStatus: 'active',
        nodes: structuredClone(input.nodes),
      }
      return structuredClone(saved)
    }),
    get: vi.fn(async () => structuredClone(saved)),
    update: vi.fn(async (run) => {
      saved = { ...structuredClone(run), version: saved.version + 1 }
      return structuredClone(saved)
    }),
    remove: vi.fn(async () => undefined),
  }
  return { apis, getSaved: () => structuredClone(saved) }
}

function createGenerationHarness() {
  const listeners = new Map<string, (event: GenerationEvent) => void>()
  const snapshots = new Map<string, Generation>()
  let nextId = 1
  const apis: GenerationApis = {
    create: vi.fn(async (input) => {
      const generation: Generation = {
        id: `task-${nextId++}`,
        projectId: input.projectId,
        type: input.type,
        status: 'pending',
        result: null,
        error: null,
      }
      snapshots.set(generation.id, generation)
      return generation
    }) as GenerationApis['create'],
    get: vi.fn(async (_projectId, id) => {
      const generation = snapshots.get(id)
      if (!generation) throw new Error(`Generation 不存在：${id}`)
      return structuredClone(generation)
    }),
    subscribe: vi.fn((_projectId, id, onEvent) => {
      listeners.set(id, onEvent)
      return () => listeners.delete(id)
    }),
  }

  function emit(event: GenerationEvent) {
    snapshots.set(event.taskId, {
      id: event.taskId,
      projectId: '1',
      type: event.type,
      status: event.status,
      result: event.result,
      error: event.error,
    })
    listeners.get(event.taskId)?.(event)
  }

  return { apis, emit, listeners, snapshots }
}

function createController(run = createRun()) {
  const workflow = createWorkflowApis(run)
  const generation = createGenerationHarness()
  const asyncErrors: Error[] = []
  const controller = createWorkflowController({
    workflow: run,
    workflowRunApis: workflow.apis,
    generationApis: generation.apis,
    createId: () => 'action-created',
    onAsyncError: (error) => asyncErrors.push(error),
  })
  return { controller, workflow, generation, asyncErrors }
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('WorkflowController', () => {
  it('一个实例只绑定一条 WorkflowRun，创建后不能换成另一条', async () => {
    const workflow = createWorkflowApis()
    const generation = createGenerationHarness()
    const controller = createWorkflowController({
      workflowRunApis: workflow.apis,
      generationApis: generation.apis,
      onAsyncError: vi.fn(),
    })

    const created = await controller.create({ projectId: '1', nodes: [characterNode()] })

    expect(controller.getWorkflow()).toEqual(created)
    await expect(
      controller.create({ projectId: '2', nodes: [characterNode({ id: 'other' })] }),
    ).rejects.toThrow('已经绑定')
  })

  it('角色通过后按显式依赖边同时解锁多个 Action', async () => {
    const run = createRun([
      characterNode({ phase: 'selecting_character' }),
      {
        id: 'action-walk',
        type: 'action',
        status: 'locked',
        phase: 'configuring_action',
        dependsOnNodeIds: ['character-1'],
        generations: [],
        error: null,
        input: actionInput(),
        selectedFirstFrameUrl: null,
      },
      {
        id: 'action-jump',
        type: 'action',
        status: 'locked',
        phase: 'configuring_action',
        dependsOnNodeIds: ['character-1'],
        generations: [],
        error: null,
        input: actionInput({ name: '跳跃', type: 'jump' }),
        selectedFirstFrameUrl: null,
      },
    ])
    const { controller } = createController(run)

    const next = await controller.confirmCharacter('character-1', 'https://img/knight.png')

    expect(next.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'character-1', status: 'passed', phase: 'completed' }),
        expect.objectContaining({ id: 'action-walk', status: 'active' }),
        expect.objectContaining({ id: 'action-jump', status: 'active' }),
      ]),
    )
  })

  it('角色生成任务落库并从终态事件进入候选确认阶段', async () => {
    const { controller, workflow, generation, asyncErrors } = createController()

    await controller.generateCharacter('character-1', { spriteWidth: 64, spriteHeight: 64 })
    expect(generation.apis.create).toHaveBeenCalledWith(
      expect.objectContaining({ spriteWidth: 64, spriteHeight: 64 }),
    )
    const inFlight = workflow.getSaved().nodes[0]
    expect(inFlight).toMatchObject({
      phase: 'generating_character_candidates',
      generations: [{ taskId: 'task-1', role: 'character_candidates' }],
    })

    generation.emit({
      taskId: 'task-1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        images: [{ url: 'https://img/knight.png' }],
      },
      error: null,
    })
    await flushAsyncWork()

    expect(controller.getWorkflow().nodes[0]).toMatchObject({
      status: 'active',
      phase: 'selecting_character',
      error: null,
    })
    expect(asyncErrors).toEqual([])
  })

  it('SSE 与紧随其后的查询同时返回终态时只保存一次结果', async () => {
    const workflow = createWorkflowApis()
    const terminalEvent: GenerationEvent = {
      taskId: 'task-terminal',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        images: [{ url: 'https://img/knight.png' }],
      },
      error: null,
    }
    const generationApis: GenerationApis = {
      create: vi.fn(async () => ({
        id: 'task-terminal',
        projectId: '1',
        type: 'character_template',
        status: 'pending',
        result: null,
        error: null,
      })) as GenerationApis['create'],
      get: vi.fn(async () => ({
        id: terminalEvent.taskId,
        projectId: '1',
        type: terminalEvent.type,
        status: terminalEvent.status,
        result: terminalEvent.result,
        error: terminalEvent.error,
      })),
      subscribe: vi.fn((_projectId, _taskId, onEvent) => {
        onEvent(terminalEvent)
        return () => undefined
      }),
    }
    const controller = createWorkflowController({
      workflow: createRun(),
      workflowRunApis: workflow.apis,
      generationApis,
      onAsyncError: vi.fn(),
    })

    await controller.generateCharacter('character-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })

    expect(workflow.apis.update).toHaveBeenCalledTimes(2)
    expect(controller.getWorkflow().nodes[0].phase).toBe('selecting_character')
  })

  it('中断后忽略迟到结果，恢复时查询终态再推进', async () => {
    const { controller, generation } = createController()
    await controller.generateCharacter('character-1', { spriteWidth: 64, spriteHeight: 64 })
    await controller.interrupt()

    generation.emit({
      taskId: 'task-1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        images: [{ url: 'https://img/knight.png' }],
      },
      error: null,
    })
    await flushAsyncWork()
    expect(controller.getWorkflow().nodes[0].phase).toBe('generating_character_candidates')

    await controller.resume()
    expect(controller.getWorkflow().nodes[0].phase).toBe('selecting_character')
  })

  it('从节点重做会清掉下游和旧 task，旧事件不能覆盖新执行线', async () => {
    const run = createRun([
      characterNode({
        phase: 'generating_character_candidates',
        generations: [{ taskId: 'task-old', role: 'character_candidates' }],
      }),
      {
        id: 'action-walk',
        type: 'action',
        status: 'locked',
        phase: 'configuring_action',
        dependsOnNodeIds: ['character-1'],
        generations: [],
        error: null,
        input: actionInput(),
        selectedFirstFrameUrl: null,
      },
    ])
    const { controller } = createController(run)

    await controller.restartFromNode('character-1')
    await controller.applyGenerationResult({
      nodeId: 'character-1',
      taskId: 'task-old',
      generation: {
        id: 'task-old',
        projectId: '1',
        type: 'character_template',
        status: 'completed',
        result: {
          type: 'character_template',
          images: [{ url: 'https://img/stale.png' }],
        },
        error: null,
      },
    })

    expect(controller.getWorkflow().nodes).toEqual([
      expect.objectContaining({
        id: 'character-1',
        status: 'active',
        phase: 'configuring_character',
        generations: [],
      }),
      expect.objectContaining({ id: 'action-walk', status: 'locked', generations: [] }),
    ])
  })

  it('生成请求尚未返回时重做，旧任务不能挂回新执行线', async () => {
    const workflow = createWorkflowApis()
    const pendingResolvers: Array<(generation: Generation) => void> = []
    const snapshots = new Map<string, Generation>()
    const createGeneration = vi.fn(
      () =>
        new Promise<Generation>((resolve) => {
          pendingResolvers.push((generation) => {
            snapshots.set(generation.id, generation)
            resolve(generation)
          })
        }),
    ) as unknown as GenerationApis['create']
    const generationApis: GenerationApis = {
      create: createGeneration,
      get: vi.fn(async (_projectId, id) => structuredClone(snapshots.get(id)!)),
      subscribe: vi.fn(() => () => undefined),
    }
    const controller = createWorkflowController({
      workflow: createRun(),
      workflowRunApis: workflow.apis,
      generationApis,
      onAsyncError: vi.fn(),
    })

    const oldSubmission = controller.generateCharacter('character-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    await Promise.resolve()
    await controller.restartFromNode('character-1')

    const newSubmission = controller.generateCharacter('character-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    await Promise.resolve()
    expect(createGeneration).toHaveBeenCalledTimes(2)

    pendingResolvers[0]?.({
      id: 'task-old',
      projectId: '1',
      type: 'character_template',
      status: 'pending',
      result: null,
      error: null,
    })
    await oldSubmission
    const sameNewSubmission = controller.generateCharacter('character-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    expect(createGeneration).toHaveBeenCalledTimes(2)

    pendingResolvers[1]?.({
      id: 'task-new',
      projectId: '1',
      type: 'character_template',
      status: 'pending',
      result: null,
      error: null,
    })
    await Promise.all([newSubmission, sameNewSubmission])

    expect(controller.getWorkflow().nodes[0].generations).toEqual([
      { taskId: 'task-new', role: 'character_candidates' },
    ])
  })

  it('保存失败时不发布未落库的新状态', async () => {
    const { controller, workflow } = createController(
      createRun([characterNode({ phase: 'selecting_character' })]),
    )
    vi.mocked(workflow.apis.update).mockRejectedValueOnce(new Error('后端保存失败'))

    await expect(
      controller.confirmCharacter('character-1', 'https://img/knight.png'),
    ).rejects.toThrow('后端保存失败')

    expect(controller.getWorkflow().nodes[0]).toMatchObject({
      status: 'active',
      phase: 'selecting_character',
      selectedImageUrl: null,
    })
  })

  it('生成任务创建成功但引用保存失败时，重试复用同一个任务', async () => {
    const { controller, workflow, generation } = createController()
    vi.mocked(workflow.apis.update).mockRejectedValueOnce(new Error('后端保存失败'))

    await expect(
      controller.generateCharacter('character-1', { spriteWidth: 64, spriteHeight: 64 }),
    ).rejects.toThrow('后端保存失败')
    expect(controller.getWorkflow().nodes[0].generations).toEqual([])

    await controller.generateCharacter('character-1', { spriteWidth: 64, spriteHeight: 64 })

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
    expect(controller.getWorkflow().nodes[0]).toMatchObject({
      phase: 'generating_character_candidates',
      generations: [{ taskId: 'task-1', role: 'character_candidates' }],
    })
  })

  it('同一节点并发点击只创建一个生成任务', async () => {
    const { controller, generation } = createController()

    await Promise.all([
      controller.generateCharacter('character-1', { spriteWidth: 64, spriteHeight: 64 }),
      controller.generateCharacter('character-1', { spriteWidth: 64, spriteHeight: 64 }),
    ])

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
  })

  it('完整动画必须是 32 帧，通过审核后节点才完成', async () => {
    const frames = Array.from({ length: 32 }, (_, index) => ({
      url: `https://img/frame-${index}.png`,
    }))
    const run = createRun([
      characterNode({
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'https://img/knight.png',
      }),
      {
        id: 'action-walk',
        type: 'action',
        status: 'active',
        phase: 'generating_animation',
        dependsOnNodeIds: ['character-1'],
        generations: [{ taskId: 'task-animation', role: 'animation' }],
        error: null,
        input: actionInput(),
        selectedFirstFrameUrl: 'https://img/first.png',
      },
    ])
    const { controller } = createController(run)

    await controller.applyGenerationResult({
      nodeId: 'action-walk',
      taskId: 'task-animation',
      generation: {
        id: 'task-animation',
        projectId: '1',
        type: 'complete_animation',
        status: 'completed',
        result: { type: 'complete_animation', frames },
        error: null,
      },
    })
    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'reviewing_animation',
    })

    await controller.approveAction('action-walk')
    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'passed',
      phase: 'completed',
    })
  })

  it('同一 Action 节点依次生成首帧和 32 帧动画', async () => {
    const run = createRun([
      characterNode({
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'https://img/knight.png',
      }),
      {
        id: 'action-walk',
        type: 'action',
        status: 'active',
        phase: 'configuring_action',
        dependsOnNodeIds: ['character-1'],
        generations: [],
        error: null,
        input: actionInput(),
        selectedFirstFrameUrl: null,
      },
    ])
    const { controller, generation } = createController(run)

    await controller.generateActionFrame('action-walk', {
      characterId: 'character-backend-1',
      referenceMedia: [],
    })
    generation.emit({
      taskId: 'task-1',
      type: 'first_frame',
      status: 'completed',
      result: { type: 'first_frame', image: { url: 'https://img/first.png' } },
      error: null,
    })
    await flushAsyncWork()
    await controller.confirmActionFrame('action-walk', 'https://img/first.png')

    await controller.generateAnimation('action-walk', {
      characterId: 'character-backend-1',
      referenceMedia: [],
    })
    generation.emit({
      taskId: 'task-2',
      type: 'complete_animation',
      status: 'completed',
      result: {
        type: 'complete_animation',
        frames: Array.from({ length: 32 }, (_, index) => ({
          url: `https://img/frame-${index}.png`,
        })),
      },
      error: null,
    })
    await flushAsyncWork()
    await controller.approveAction('action-walk')

    expect(generation.apis.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'first_frame',
        characterId: 'character-backend-1',
        outfitId: 'outfit-1',
      }),
    )
    expect(generation.apis.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'complete_animation',
        firstFrameUrl: 'https://img/first.png',
      }),
    )
    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'passed',
      phase: 'completed',
      generations: [
        { taskId: 'task-1', role: 'action_frame_candidates' },
        { taskId: 'task-2', role: 'animation' },
      ],
    })
  })

  it('恢复动画阶段时不会让旧首帧任务把节点倒退', async () => {
    const run = createRun([
      characterNode({
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'https://img/knight.png',
      }),
      {
        id: 'action-walk',
        type: 'action',
        status: 'active',
        phase: 'generating_animation',
        dependsOnNodeIds: ['character-1'],
        generations: [
          { taskId: 'task-first-frame', role: 'action_frame_candidates' },
          { taskId: 'task-animation', role: 'animation' },
        ],
        error: null,
        input: actionInput(),
        selectedFirstFrameUrl: 'https://img/first.png',
      },
    ])
    const { controller, generation } = createController(run)
    generation.snapshots.set('task-first-frame', {
      id: 'task-first-frame',
      projectId: '1',
      type: 'first_frame',
      status: 'completed',
      result: { type: 'first_frame', image: { url: 'https://img/first.png' } },
      error: null,
    })
    generation.snapshots.set('task-animation', {
      id: 'task-animation',
      projectId: '1',
      type: 'complete_animation',
      status: 'running',
      result: null,
      error: null,
    })

    await controller.resume()
    await controller.applyGenerationResult({
      nodeId: 'action-walk',
      taskId: 'task-first-frame',
      generation: generation.snapshots.get('task-first-frame')!,
    })

    expect(generation.apis.get).toHaveBeenCalledTimes(1)
    expect(generation.apis.get).toHaveBeenCalledWith('1', 'task-animation')
    expect(controller.getWorkflow().nodes[1].phase).toBe('generating_animation')
  })
})
