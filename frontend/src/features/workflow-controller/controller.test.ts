import { describe, expect, it, vi } from 'vitest'

import type {
  ActionFirstFrameWorkflowNode,
  ActionFullFrameWorkflowNode,
  ActionGenerationMethodWorkflowNode,
  CharacterSetupWorkflowNode,
  CharacterTemplateWorkflowNode,
  Generation,
  GenerationApis,
  GenerationEvent,
  ReviewWorkflowNode,
  DirectionalMovement,
  WorkflowActionInput,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import { WorkflowRunConflictError } from '@/entities'
import { createWorkflowController } from '.'

function setupNode(
  overrides: Partial<CharacterSetupWorkflowNode> = {},
): CharacterSetupWorkflowNode {
  return {
    id: 'setup-1',
    type: 'character-setup',
    status: 'active',
    phase: 'configuring',
    dependsOnNodeIds: [],
    generations: [],
    error: null,
    input: { prompt: '像素骑士', referenceMedia: [] },
    ...overrides,
  }
}

function templateNode(
  overrides: Partial<CharacterTemplateWorkflowNode> = {},
): CharacterTemplateWorkflowNode {
  return {
    id: 'template-1',
    type: 'character-template',
    status: 'locked',
    phase: 'ready',
    dependsOnNodeIds: ['setup-1'],
    generations: [],
    error: null,
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

function firstFrameNode(
  overrides: Partial<ActionFirstFrameWorkflowNode> = {},
): ActionFirstFrameWorkflowNode {
  return {
    id: 'action-walk',
    type: 'action-first-frame',
    status: 'active',
    phase: 'configuring',
    dependsOnNodeIds: ['template-1'],
    generations: [],
    error: null,
    input: actionInput(),
    selectedFirstFrameUrl: null,
    ...overrides,
  }
}

function fullFrameNode(
  overrides: Partial<ActionFullFrameWorkflowNode> = {},
): ActionFullFrameWorkflowNode {
  return {
    id: 'action-walk:action-full-frame',
    type: 'action-full-frame',
    status: 'locked',
    phase: 'ready',
    dependsOnNodeIds: ['action-walk:action-generation-method'],
    generations: [],
    error: null,
    ...overrides,
  }
}

function generationMethodNode(
  overrides: Partial<ActionGenerationMethodWorkflowNode> = {},
): ActionGenerationMethodWorkflowNode {
  return {
    id: 'action-walk:action-generation-method',
    type: 'action-generation-method',
    status: 'locked',
    phase: 'selecting',
    dependsOnNodeIds: ['action-walk'],
    generations: [],
    error: null,
    method: null,
    ...overrides,
  }
}

function reviewNode(overrides: Partial<ReviewWorkflowNode> = {}): ReviewWorkflowNode {
  return {
    id: 'action-walk:review',
    type: 'review',
    status: 'locked',
    phase: 'reviewing',
    dependsOnNodeIds: ['action-walk:action-full-frame'],
    generations: [],
    error: null,
    ...overrides,
  }
}

function characterNodes(): WorkflowNode[] {
  return [setupNode(), templateNode()]
}

function completedCharacterNodes(): WorkflowNode[] {
  return [
    setupNode({ status: 'passed', phase: 'completed' }),
    templateNode({
      status: 'passed',
      phase: 'completed',
      selectedImageUrl: 'https://img/knight.png',
    }),
  ]
}

function actionNodes(): WorkflowNode[] {
  return [firstFrameNode(), generationMethodNode(), fullFrameNode(), reviewNode()]
}

function createRun(nodes: WorkflowNode[] = characterNodes()): WorkflowRun {
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
    subscribe: vi.fn((_projectId, id, expectationOrOnEvent, onEvent) => {
      const listener = typeof expectationOrOnEvent === 'function' ? expectationOrOnEvent : onEvent
      if (!listener) throw new Error('缺少 Generation 事件处理器')
      listeners.set(id, listener)
      return () => listeners.delete(id)
    }) as unknown as GenerationApis['subscribe'],
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

function createController(
  run = createRun(),
  directionalMovement: DirectionalMovement = 'single',
  runClientBake?: (taskId: string) => Promise<boolean>,
) {
  const workflow = createWorkflowApis(run)
  const generation = createGenerationHarness()
  const asyncErrors: Error[] = []
  const bakedTasks: string[] = []
  const controller = createWorkflowController({
    workflow: run,
    workflowRunApis: workflow.apis,
    generationApis: generation.apis,
    createId: () => 'action-created',
    now: () => '2026-08-09T00:00:00.000Z',
    onAsyncError: (error) => asyncErrors.push(error),
    directionalMovement,
    // 默认注入空实现:真实现会动态 import three.js 并起 WebGL,jsdom 里跑不了,
    // 而且只有一条用例关心它。
    runClientBake:
      runClientBake ??
      (async (taskId) => {
        bakedTasks.push(String(taskId))
        return false
      }),
  })
  return { controller, workflow, generation, asyncErrors, bakedTasks }
}

function completedAnimationEvent(taskId = 'task-2'): GenerationEvent {
  return {
    taskId,
    type: 'complete_animation',
    status: 'completed',
    result: {
      type: 'complete_animation',
      frames: Array.from({ length: 32 }, (_, index) => ({
        index,
        url: `https://img/frame-${index}.png`,
        durationMs: index % 2 === 0 ? 100 : null,
      })),
    },
    error: null,
  }
}

function imageCandidates(prefix: string) {
  return [1, 2, 3].map((index) => ({ url: `${prefix}-${index}.png` }))
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('WorkflowController', () => {
  it('从角色描述创建两节点 Run 并提交母版生成', async () => {
    const workflow = createWorkflowApis()
    const generation = createGenerationHarness()
    const prepareProject = vi.fn(async () => ({
      id: 'project-agent',
      spriteSize: { width: 256, height: 256 },
    }))
    const controller = createWorkflowController({
      workflowRunApis: workflow.apis,
      generationApis: generation.apis,
      prepareProject,
      onAsyncError: () => undefined,
    })

    await expect(
      controller.startCharacterGeneration({ prompt: '  银发像素骑士  ' }),
    ).resolves.toEqual({ runId: 'run-1' })

    expect(prepareProject).toHaveBeenCalledWith('银发像素骑士', 'single', {
      gameStyle: undefined,
    })
    expect(workflow.apis.create).toHaveBeenCalledWith({
      projectId: 'project-agent',
      nodes: [
        expect.objectContaining({
          id: 'character-setup',
          type: 'character-setup',
          input: { prompt: '银发像素骑士', referenceMedia: [] },
        }),
        expect.objectContaining({
          id: 'character-template',
          type: 'character-template',
          dependsOnNodeIds: ['character-setup'],
        }),
      ],
    })
    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'character_template',
      projectId: 'project-agent',
      prompt: '银发像素骑士',
      referenceMedia: [],
      spriteWidth: 256,
      spriteHeight: 256,
      direction: 'east',
    })
  })

  it('uses the uploaded reference when Agent starts character generation', async () => {
    const workflow = createWorkflowApis()
    const generation = createGenerationHarness()
    const controller = createWorkflowController({
      workflowRunApis: workflow.apis,
      generationApis: generation.apis,
      prepareProject: vi.fn(async () => ({
        id: 'project-agent',
        spriteSize: { width: 256, height: 256 },
      })),
      onAsyncError: () => undefined,
    })

    await controller.startCharacterGeneration({
      prompt: '银发像素骑士全身像',
      referenceMedia: ['https://cdn.windup.test/hero.png' as never],
    })

    expect(generation.apis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'character_template',
        prompt: '银发像素骑士全身像',
        referenceMedia: ['https://cdn.windup.test/hero.png'],
      }),
    )
  })

  it('为 Agent 自动交付持久化动作意图并只生成一个母版候选', async () => {
    const workflow = createWorkflowApis()
    const generation = createGenerationHarness()
    const controller = createWorkflowController({
      workflowRunApis: workflow.apis,
      generationApis: generation.apis,
      prepareProject: vi.fn(async () => ({
        id: 'project-agent',
        spriteSize: { width: 256, height: 256 },
      })),
      onAsyncError: () => undefined,
    })

    await controller.startCharacterGeneration({
      prompt: '背着邮包的像素邮差，全身像',
      automaticDelivery: {
        actionPrompt: '轻快地向前行走',
        actionType: 'walk',
        locomotion: true,
      },
    })

    expect(workflow.apis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            type: 'character-setup',
            automation: {
              mode: 'automatic',
              actionPrompt: '轻快地向前行走',
              actionType: 'walk',
              locomotion: true,
            },
          }),
        ]),
      }),
    )
    expect(generation.apis.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'character_template', candidateCount: 1 }),
    )
  })

  it('persists the Agent pixel-art suggestion on the setup node', async () => {
    const workflow = createWorkflowApis()
    const generation = createGenerationHarness()
    const controller = createWorkflowController({
      workflowRunApis: workflow.apis,
      generationApis: generation.apis,
      prepareProject: vi.fn(async () => ({
        id: 'project-agent',
        spriteSize: { width: 64, height: 64 },
      })),
      onAsyncError: () => undefined,
    })

    await controller.startCharacterGeneration({
      prompt: '魔幻像素风战士',
      suggestPixelPerfect: true,
      automaticDelivery: { actionPrompt: '疯狂跳舞' },
    })

    expect(workflow.apis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            type: 'character-setup',
            pixelPerfectSuggested: true,
          }),
        ]),
      }),
    )
  })

  it('按 Quick Start 选择四向项目时只提交三张南向正视母版候选', async () => {
    const workflow = createWorkflowApis()
    const generation = createGenerationHarness()
    const prepareProject = vi.fn(async () => ({
      id: 'project-four-way',
      spriteSize: { width: 256, height: 256 },
      directionalMovement: 'four-way' as const,
    }))
    const controller = createWorkflowController({
      workflowRunApis: workflow.apis,
      generationApis: generation.apis,
      prepareProject,
      onAsyncError: () => undefined,
    })

    await controller.startCharacterGeneration({
      prompt: '四向像素骑士',
      directionalMovement: 'four-way',
    })

    expect(prepareProject).toHaveBeenCalledWith('四向像素骑士', 'four-way', {
      gameStyle: undefined,
    })
    expect(generation.apis.create).toHaveBeenCalledTimes(1)
    expect(vi.mocked(generation.apis.create).mock.calls.map(([input]) => input.direction)).toEqual([
      'south',
    ])
  })

  it('uses the merged view-sheet contract for a four-way character and confirms one whole candidate', async () => {
    const run = createRun([
      setupNode({
        status: 'passed',
        phase: 'completed',
        input: {
          prompt: '四向像素骑士',
          referenceMedia: [],
          characterId: '7',
        },
      }),
      templateNode({
        status: 'active',
        phase: 'selecting',
        selectedImageUrl: 'https://img/south.png',
        selectedImages: { south: 'https://img/south.png' },
      }),
    ])
    const { controller, generation } = createController(run, 'four-way')

    await controller.generateCharacterViewSheet('template-1', {
      characterId: '7',
      prompt: '四向像素骑士',
      spriteWidth: 64,
      spriteHeight: 96,
    })

    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'character_four_view',
      projectId: '1',
      characterId: '7',
      prompt: '四向像素骑士',
      referenceMedia: [],
      spriteWidth: 64,
      spriteHeight: 96,
      candidateCount: 1,
    })
    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      phase: 'generating',
      generations: expect.arrayContaining([
        expect.objectContaining({ taskId: 'task-1', role: 'character_four_view' }),
      ]),
    })

    const cells = [
      {
        direction: 'south' as const,
        imageUrl: 'https://img/south.png',
        sourceDirection: null,
        mirrorX: false,
      },
      {
        direction: 'east' as const,
        imageUrl: 'https://img/east.png',
        sourceDirection: null,
        mirrorX: false,
      },
      {
        direction: 'north' as const,
        imageUrl: 'https://img/north.png',
        sourceDirection: null,
        mirrorX: false,
      },
      {
        direction: 'west' as const,
        imageUrl: 'https://img/west.png',
        sourceDirection: 'east' as const,
        mirrorX: true,
      },
    ]
    generation.emit({
      taskId: 'task-1',
      type: 'character_four_view',
      status: 'completed',
      result: {
        type: 'character_four_view',
        sheets: [{ sheetUrl: 'https://img/sheet.png', cells }],
        quality: null,
      },
      error: null,
    })
    await flushAsyncWork()

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'selecting',
    })

    await expect(
      controller.confirmCharacterViewSheet(
        'template-1',
        cells.map((cell) =>
          cell.direction === 'west' ? { ...cell, sourceDirection: 'north' as const } : cell,
        ),
      ),
    ).rejects.toThrow('方向 sheet 的镜像关系与项目方向模式不一致')

    await controller.confirmCharacterViewSheet('template-1', cells)

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'passed',
      phase: 'completed',
      selectedImageUrl: 'https://img/south.png',
      selectedImages: {
        south: 'https://img/south.png',
        east: 'https://img/east.png',
        north: 'https://img/north.png',
        west: 'https://img/west.png',
      },
    })
  })

  it('未注入项目准备能力时拒绝 Quick Start 生成命令', async () => {
    const { controller } = createController()

    await expect(controller.startCharacterGeneration({ prompt: '银发像素骑士' })).rejects.toThrow(
      'WorkflowController 未配置 Quick Start 项目准备能力',
    )
  })

  it('只在角色设定节点仍处于配置阶段时更新提示词和参考媒体', async () => {
    const { controller } = createController()

    await controller.updateCharacterSetup('setup-1', {
      prompt: '披着红色斗篷的像素骑士',
      referenceMedia: ['https://img/reference.png' as never],
    })

    expect(controller.getWorkflow().nodes[0]).toMatchObject({
      input: {
        prompt: '披着红色斗篷的像素骑士',
        referenceMedia: ['https://img/reference.png'],
      },
    })
  })

  it('接受上传母版时完成角色设定和母版节点', async () => {
    const { controller } = createController()

    await controller.acceptUploadedCharacterTemplate(
      'setup-1',
      'https://img/uploaded-template.png',
      'character-1',
    )

    expect(controller.getWorkflow().nodes).toMatchObject([
      {
        type: 'character-setup',
        status: 'passed',
        phase: 'completed',
        input: { characterId: 'character-1' },
      },
      {
        type: 'character-template',
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'https://img/uploaded-template.png',
      },
    ])
  })

  it('多方向项目把上传的南向图登记为方向 sheet 的已确认母版', async () => {
    const { controller } = createController(createRun(), 'four-way')

    await controller.acceptUploadedCharacterTemplate(
      'setup-1',
      'https://img/south.png',
      'character-1',
      'south',
    )

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'selecting',
      selectedImageUrl: 'https://img/south.png',
      selectedImages: { south: 'https://img/south.png' },
    })
  })

  it('显式补源方向时跳过已经上传的东向图片', async () => {
    const { controller, generation } = createController(createRun(), 'four-way')
    await controller.acceptUploadedCharacterTemplate(
      'setup-1',
      'https://img/east.png',
      'character-1',
      'east',
    )

    await controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
      directions: ['east', 'north', 'south'],
    })

    expect(generation.apis.create).toHaveBeenCalledTimes(2)
    expect(vi.mocked(generation.apis.create).mock.calls.map(([input]) => input.direction)).toEqual([
      'north',
      'south',
    ])
  })

  it('母版确认和上传都拒绝错误节点状态与角色改绑', async () => {
    const { controller: lockedController } = createController()
    await expect(
      lockedController.confirmCharacterTemplate(
        'template-1',
        'https://img/knight.png',
        'character-1',
      ),
    ).rejects.toThrow('角色母版节点当前不能确认候选图')
    await expect(
      lockedController.confirmCharacterTemplate(
        'setup-1' as never,
        'https://img/knight.png',
        'character-1',
      ),
    ).rejects.toThrow('目标节点不是角色母版')

    const boundRun = createRun([
      setupNode({
        status: 'passed',
        phase: 'completed',
        input: {
          prompt: '像素骑士',
          referenceMedia: [],
          characterId: 'character-existing',
        },
      }),
      templateNode({ status: 'active', phase: 'selecting' }),
    ])
    const { controller: boundController } = createController(boundRun)
    await expect(
      boundController.confirmCharacterTemplate(
        'template-1',
        'https://img/knight.png',
        'character-other',
      ),
    ).rejects.toThrow('WorkflowRun 已绑定到另一角色，不能改绑')

    const uploadRun = createRun([
      setupNode({
        input: {
          prompt: '像素骑士',
          referenceMedia: [],
          characterId: 'character-existing',
        },
      }),
      templateNode(),
    ])
    const { controller: uploadController } = createController(uploadRun)
    await expect(
      uploadController.acceptUploadedCharacterTemplate(
        'setup-1',
        'https://img/uploaded.png',
        'character-other',
      ),
    ).rejects.toThrow('WorkflowRun 已绑定到另一角色，不能改绑')
  })

  it('页面通过订阅接收命令保存和 SSE 写回后的同一份 WorkflowRun', async () => {
    const { controller, generation } = createController()
    let renderedWorkflow = controller.getWorkflow()
    const unsubscribe = controller.subscribe((workflow) => {
      renderedWorkflow = workflow
    })

    await controller.generateCharacterTemplate('setup-1', { spriteWidth: 64, spriteHeight: 64 })

    expect(renderedWorkflow.nodes[1]).toMatchObject({
      type: 'character-template',
      phase: 'generating',
    })

    generation.emit({
      taskId: 'task-1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        images: imageCandidates('https://img/knight'),
      },
      error: null,
    })
    await flushAsyncWork()

    expect(renderedWorkflow.nodes[1]).toMatchObject({
      type: 'character-template',
      phase: 'selecting',
    })
    unsubscribe()
  })

  it('订阅忽略进行中事件并转发订阅错误', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        phase: 'generating',
        generations: [{ taskId: 'task-first-frame', role: 'first_frame' }],
      }),
      ...actionNodes().slice(1),
    ])
    const { controller, generation, asyncErrors } = createController(run)
    generation.snapshots.set('task-first-frame', {
      id: 'task-first-frame',
      projectId: '1',
      type: 'first_frame',
      status: 'running',
      result: null,
      error: null,
    })
    vi.mocked(generation.apis.subscribe).mockImplementation(
      (_projectId, _taskId, _expectation, onEvent, onError) => {
        onEvent?.({
          taskId: 'task-first-frame',
          type: 'first_frame',
          status: 'running',
          result: null,
          error: null,
        })
        onError?.(new Error('stream failed'))
        return () => undefined
      },
    )

    await controller.resume()
    expect(asyncErrors).toEqual([new Error('stream failed')])
    expect(controller.getWorkflow().nodes.find((node) => node.id === 'action-walk')).toMatchObject({
      phase: 'generating',
    })
  })

  it('订阅终态落库失败时上报异步错误', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        phase: 'generating',
        generations: [{ taskId: 'task-first-frame', role: 'first_frame' }],
      }),
      ...actionNodes().slice(1),
    ])
    const { controller, workflow, generation, asyncErrors } = createController(run)
    generation.snapshots.set('task-first-frame', {
      id: 'task-first-frame',
      projectId: '1',
      type: 'first_frame',
      status: 'running',
      result: null,
      error: null,
    })
    let onEvent: ((event: GenerationEvent) => void) | undefined
    vi.mocked(generation.apis.subscribe).mockImplementation(
      (_projectId, _taskId, _expectation, listener) => {
        onEvent = listener
        return () => undefined
      },
    )

    await controller.resume()
    vi.mocked(workflow.apis.update).mockRejectedValueOnce(new Error('save failed'))
    onEvent?.({
      taskId: 'task-first-frame',
      type: 'first_frame',
      status: 'completed',
      result: {
        type: 'first_frame',
        images: [{ url: 'first.png' }, { url: 'second.png' }, { url: 'third.png' }],
      },
      error: null,
    })
    await flushAsyncWork()

    expect(asyncErrors).toEqual([new Error('save failed')])
  })

  it('按节点角色恢复生成快照', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        phase: 'generating',
        generations: [{ taskId: 'task-first-frame', role: 'first_frame' }],
      }),
      ...actionNodes().slice(1),
    ])
    const { controller, generation } = createController(run)
    generation.snapshots.set('task-first-frame', {
      id: 'task-first-frame',
      projectId: '1',
      type: 'first_frame',
      status: 'running',
      result: null,
      error: null,
    })

    await expect(controller.getGeneration('action-walk', 'first_frame')).resolves.toMatchObject({
      id: 'task-first-frame',
    })
    expect(generation.apis.get).toHaveBeenCalledWith('1', 'task-first-frame', {
      type: 'first_frame',
      actionType: 'walk',
    })
  })

  it('按角色母版节点恢复生成快照', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-template', role: 'character_template' }],
      }),
    ])
    const { controller, generation } = createController(run)
    generation.snapshots.set('task-template', {
      id: 'task-template',
      projectId: '1',
      type: 'character_template',
      status: 'running',
      result: null,
      error: null,
    })

    await expect(
      controller.getGeneration('template-1', 'character_template'),
    ).resolves.toMatchObject({
      id: 'task-template',
    })
    expect(generation.apis.get).toHaveBeenCalledWith('1', 'task-template', {
      type: 'character_template',
    })
  })

  it('按完整动画节点解析动作生成期望', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'first.png',
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-animation', role: 'complete_animation' }],
      }),
    ])
    const { controller, generation } = createController(run)
    generation.snapshots.set('task-animation', {
      id: 'task-animation',
      projectId: '1',
      type: 'complete_animation',
      status: 'running',
      result: null,
      error: null,
    })

    await expect(
      controller.getGeneration('action-walk:action-full-frame', 'complete_animation'),
    ).resolves.toMatchObject({ id: 'task-animation' })
    expect(generation.apis.get).toHaveBeenCalledWith('1', 'task-animation', {
      type: 'complete_animation',
      actionType: 'walk',
    })
  })

  it('修改命令不再返回第二份 WorkflowRun', async () => {
    const { controller } = createController(createRun(completedCharacterNodes()))

    await expect(
      controller.addAction({ nodeId: 'action-walk', input: actionInput() }),
    ).resolves.toBeUndefined()
  })

  it('一个实例只绑定一条 WorkflowRun，创建后不能换成另一条', async () => {
    const workflow = createWorkflowApis()
    const generation = createGenerationHarness()
    const controller = createWorkflowController({
      workflowRunApis: workflow.apis,
      generationApis: generation.apis,
      onAsyncError: vi.fn(),
    })

    await controller.create({ projectId: '1', nodes: characterNodes() })

    expect(controller.getWorkflow()).toMatchObject({ id: 'run-1', projectId: '1' })
    await expect(
      controller.create({
        projectId: '2',
        nodes: [setupNode({ id: 'other-setup' }), templateNode({ id: 'other-template' })],
      }),
    ).rejects.toThrow('已经绑定')
  })

  it('保存归一化后的角色名称且不修改角色提示词', async () => {
    const { controller, workflow } = createController()

    await controller.setCharacterName('setup-1', '  雾港旅人  ')

    expect(workflow.getSaved().nodes[0]).toMatchObject({
      type: 'character-setup',
      input: {
        name: '雾港旅人',
        prompt: '像素骑士',
        referenceMedia: [],
      },
    })
  })

  it('纯空白角色名称按未填写保存', async () => {
    const { controller } = createController()

    await controller.setCharacterName('setup-1', '   ')

    expect(controller.getWorkflow().nodes[0]).toMatchObject({
      type: 'character-setup',
      input: { name: null },
    })
  })

  it('拒绝超过 20 个字符的角色名称', async () => {
    const { controller } = createController()

    await expect(controller.setCharacterName('setup-1', 'x'.repeat(21))).rejects.toThrow(
      '角色名称不能超过 20 个字符',
    )
  })

  it('adds a complete first-frame, method, full-frame, and review chain for one Action', async () => {
    const { controller } = createController(createRun(completedCharacterNodes()))

    await controller.addAction({ nodeId: 'action-walk', input: actionInput() })

    expect(controller.getWorkflow().nodes.slice(2)).toMatchObject([
      {
        id: 'action-walk',
        type: 'action-first-frame',
        status: 'active',
        dependsOnNodeIds: ['template-1'],
      },
      {
        id: 'action-walk:action-generation-method',
        type: 'action-generation-method',
        status: 'locked',
        dependsOnNodeIds: ['action-walk'],
        method: null,
      },
      {
        id: 'action-walk:action-full-frame',
        type: 'action-full-frame',
        status: 'locked',
        dependsOnNodeIds: ['action-walk:action-generation-method'],
        input: { prompt: null },
      },
      {
        id: 'action-walk:review',
        type: 'review',
        status: 'locked',
        dependsOnNodeIds: ['action-walk:action-full-frame'],
      },
    ])
  })

  it('新增 Action 只能依赖一个角色母版节点', async () => {
    const { controller } = createController(createRun(completedCharacterNodes()))

    await expect(
      controller.addAction({
        nodeId: 'action-invalid',
        dependsOnNodeIds: ['setup-1'],
        input: actionInput(),
      }),
    ).rejects.toThrow('必须且只能依赖一个角色母版节点')
  })

  it('归档已发布 Action 时只标记对应四节点分支并保留其他节点', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({ status: 'passed', phase: 'completed', selectedFirstFrameUrl: 'walk.png' }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({ status: 'passed', phase: 'completed' }),
      reviewNode({ status: 'passed', phase: 'completed' }),
      firstFrameNode({
        id: 'action-jump',
        status: 'passed',
        phase: 'completed',
        input: actionInput({ name: '跳跃', type: 'jump' }),
        selectedFirstFrameUrl: 'jump.png',
      }),
      generationMethodNode({
        id: 'action-jump:action-generation-method',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['action-jump'],
        method: 'video-cropping',
      }),
      fullFrameNode({
        id: 'action-jump:action-full-frame',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['action-jump:action-generation-method'],
      }),
      reviewNode({
        id: 'action-jump:review',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['action-jump:action-full-frame'],
      }),
    ])
    const { controller, workflow } = createController(run)

    await controller.archiveAction('action-walk:action-full-frame')
    const archived = controller.getWorkflow()

    expect(archived.nodes.filter((node) => node.deletedAt).map((node) => node.id)).toEqual([
      'action-walk',
      'action-walk:action-generation-method',
      'action-walk:action-full-frame',
      'action-walk:review',
    ])
    expect(archived.nodes.find((node) => node.id === 'setup-1')?.deletedAt).toBeUndefined()
    expect(archived.nodes.find((node) => node.id === 'template-1')?.deletedAt).toBeUndefined()
    expect(archived.nodes.find((node) => node.id === 'action-jump')?.deletedAt).toBeUndefined()
    expect(workflow.getSaved()).toEqual(archived)
  })

  it('选择三渲二生产方式后按该造型的 outfitId 提交完整动画请求', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'https://img/first.png',
      }),
      generationMethodNode({ status: 'active' }),
      fullFrameNode(),
      reviewNode(),
    ])
    const { controller, generation } = createController(run)

    await controller.selectActionGenerationMethod(
      'action-walk:action-generation-method',
      '3d-to-2d',
    )
    await controller.generateCompleteAnimation('action-walk:action-full-frame', {
      characterId: 'character-backend-1',
      referenceMedia: [],
    })

    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'action-walk:action-generation-method',
          method: '3d-to-2d',
        }),
      ]),
    )
    expect(generation.apis.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'complete_animation', outfitId: 'outfit-1' }),
    )
  })

  it('完整动画保存并使用自己的提示词，不复用动作首帧提示词', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        input: actionInput({ prompt: '挥拳前保持蓄势姿势' }),
        selectedFirstFrameUrl: 'https://img/first.png',
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({ status: 'active' }),
      reviewNode(),
    ])
    const { controller, generation } = createController(run)

    await controller.generateCompleteAnimation('action-walk:action-full-frame', {
      characterId: 'character-backend-1',
      referenceMedia: [],
      prompt: '向前挥拳、击中后自然收势，保持身体重心连续',
    })

    expect(generation.apis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'complete_animation',
        prompt: '向前挥拳、击中后自然收势，保持身体重心连续',
      }),
    )
    expect(
      controller.getWorkflow().nodes.find((node) => node.id === 'action-walk:action-full-frame'),
    ).toMatchObject({
      input: { prompt: '向前挥拳、击中后自然收势，保持身体重心连续' },
    })
    expect(controller.getWorkflow().nodes.find((node) => node.id === 'action-walk')).toMatchObject({
      input: { prompt: '挥拳前保持蓄势姿势' },
    })
  })

  it('角色母版通过后按显式边同时解锁多个 Action 首帧节点', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({ status: 'active', phase: 'selecting' }),
      firstFrameNode({ id: 'action-walk', status: 'locked' }),
      firstFrameNode({
        id: 'action-jump',
        status: 'locked',
        input: actionInput({ name: '跳跃', type: 'jump' }),
      }),
    ])
    const { controller } = createController(run)

    await controller.confirmCharacterTemplate('template-1', 'https://img/knight.png', 'character-1')

    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'setup-1',
          input: expect.objectContaining({ characterId: 'character-1' }),
        }),
        expect.objectContaining({ id: 'template-1', status: 'passed', phase: 'completed' }),
        expect.objectContaining({ id: 'action-walk', status: 'active' }),
        expect.objectContaining({ id: 'action-jump', status: 'active' }),
      ]),
    )
  })

  it('提交角色设定后在母版节点记录任务并进入候选选择', async () => {
    const { controller, workflow, generation, asyncErrors } = createController()

    await controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
      input: { prompt: '戴红围巾的像素骑士', referenceMedia: [] },
    })

    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'character_template',
      projectId: '1',
      prompt: '戴红围巾的像素骑士',
      referenceMedia: [],
      spriteWidth: 64,
      spriteHeight: 64,
      direction: 'east',
    })
    expect(workflow.getSaved().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'setup-1', status: 'passed', phase: 'completed' }),
        expect.objectContaining({
          id: 'template-1',
          phase: 'generating',
          generations: [{ taskId: 'task-1', role: 'character_template' }],
        }),
      ]),
    )

    generation.emit({
      taskId: 'task-1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        images: imageCandidates('https://img/knight'),
      },
      error: null,
    })
    await flushAsyncWork()

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      type: 'character-template',
      status: 'active',
      phase: 'selecting',
      error: null,
    })
    expect(asyncErrors).toEqual([])
  })

  it('服务端回包已改变母版阶段时拒绝继续创建生成任务', async () => {
    const { controller, workflow, generation } = createController()
    const update = vi.mocked(workflow.apis.update)
    const save = update.getMockImplementation()!
    update.mockImplementationOnce(async (run) => {
      const saved = await save(run)
      return {
        ...saved,
        nodes: saved.nodes.map((node) =>
          node.id === 'template-1' && node.type === 'character-template'
            ? { ...node, phase: 'selecting' as const }
            : node,
        ),
      }
    })

    await expect(
      controller.generateCharacterTemplate('setup-1', { spriteWidth: 64, spriteHeight: 64 }),
    ).rejects.toThrow('角色母版节点当前不能开始生成')
    expect(generation.apis.create).not.toHaveBeenCalled()
  })

  it('角色母版重生成使用调用方提供的上一版图片作为参考', async () => {
    const previousImage = 'https://img/knight-previous.png'
    const { controller, generation } = createController(createRun(completedCharacterNodes()))

    await controller.restartFromNode('template-1')
    await controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
      sourceImageUrl: previousImage,
    })

    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'character_template',
      projectId: '1',
      prompt: '像素骑士',
      referenceMedia: [previousImage],
      spriteWidth: 64,
      spriteHeight: 64,
      direction: 'east',
    })
  })

  it.each([
    ['four-way', ['east', 'north', 'south']],
    ['eight-way', ['east', 'north', 'south', 'north_east', 'south_east']],
  ] as const)('按项目方向为 %s 创建全部源方向的候选任务', async (movement, directions) => {
    const { controller, generation } = createController(createRun(), movement)

    await controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })

    expect(generation.apis.create).toHaveBeenCalledTimes(directions.length)
    for (const [index, direction] of directions.entries()) {
      generation.emit({
        taskId: `task-${index + 1}`,
        type: 'character_template',
        status: 'completed',
        result: {
          type: 'character_template',
          direction,
          images: imageCandidates(direction),
        },
        error: null,
      })
    }
    await flushAsyncWork()

    const template = controller.getWorkflow().nodes[1]
    expect(template).toMatchObject({
      phase: 'selecting',
      status: 'active',
      generations: directions.map((_, index) => ({
        taskId: `task-${index + 1}`,
        role: 'character_template',
      })),
    })
  })

  it('一个方向提交失败时先保留其它已创建任务，重试只补缺失方向', async () => {
    const { controller, generation } = createController(createRun(), 'four-way')
    const create = vi.mocked(generation.apis.create)
    const originalCreate = create.getMockImplementation()!
    const finishSuccessfulCreates: Array<() => void> = []
    create.mockImplementation((input) => {
      if (input.direction === 'north') {
        return Promise.reject(new Error('north submit failed'))
      }
      return new Promise((resolve) => {
        finishSuccessfulCreates.push(() => void resolve(originalCreate(input)))
      })
    })

    const generationRequest = controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    let requestState: 'pending' | 'rejected' = 'pending'
    void generationRequest.catch(() => {
      requestState = 'rejected'
    })
    await flushAsyncWork()

    expect(requestState).toBe('pending')
    finishSuccessfulCreates.forEach((finish) => finish())
    await expect(generationRequest).rejects.toThrow('north submit failed')

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'generating',
      generations: [
        { taskId: 'task-1', role: 'character_template' },
        { taskId: 'task-2', role: 'character_template', direction: 'south' },
      ],
    })

    create.mockImplementation(originalCreate)
    await controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })

    expect(create).toHaveBeenCalledTimes(4)
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'north' }))
    expect(controller.getWorkflow().nodes[1]?.generations).toHaveLength(3)
  })

  it('四向动作只为三个源方向生成并逐方向确认首帧', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'https://img/east.png',
        selectedImages: {
          east: 'https://img/east.png',
          north: 'https://img/north.png',
          south: 'https://img/south.png',
        },
      }),
      ...actionNodes(),
    ])
    const { controller, generation } = createController(run, 'four-way')

    await controller.generateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    for (const [index, direction] of ['east', 'north', 'south'].entries()) {
      generation.emit({
        taskId: `task-${index + 1}`,
        type: 'first_frame',
        status: 'completed',
        result: {
          type: 'first_frame',
          direction: direction as 'east' | 'west' | 'north' | 'south',
          images: imageCandidates(direction),
        },
        error: null,
      })
    }
    await flushAsyncWork()

    await controller.confirmFirstFrame('action-walk', 'east-1', 'east')
    await controller.confirmFirstFrame('action-walk', 'north-1', 'north')
    expect(controller.getWorkflow().nodes.find((node) => node.id === 'action-walk')).toMatchObject({
      status: 'active',
      phase: 'selecting',
      selectedFirstFrameUrls: { east: 'east-1', north: 'north-1' },
    })

    await controller.confirmFirstFrame('action-walk', 'south-1', 'south')
    expect(controller.getWorkflow().nodes.find((node) => node.id === 'action-walk')).toMatchObject({
      status: 'passed',
      phase: 'completed',
      selectedFirstFrameUrls: {
        east: 'east-1',
        north: 'north-1',
        south: 'south-1',
      },
    })
  })

  it('非东向确认优先沿用方向选择表中的东向兼容值', async () => {
    const template = createController(
      createRun([
        setupNode({ status: 'passed', phase: 'completed' }),
        templateNode({
          status: 'active',
          phase: 'selecting',
          selectedImageUrl: null,
          selectedImages: { east: 'east-template.png' },
        }),
      ]),
      'four-way',
    )
    await template.controller.confirmCharacterTemplate(
      'template-1',
      'north-template.png',
      'character-1',
      'north',
    )
    expect(template.controller.getWorkflow().nodes[1]).toMatchObject({
      selectedImageUrl: 'east-template.png',
    })

    const firstFrame = createController(
      createRun([
        ...completedCharacterNodes(),
        firstFrameNode({
          status: 'active',
          phase: 'selecting',
          selectedFirstFrameUrl: null,
          selectedFirstFrameUrls: { east: 'east-frame.png' },
        }),
      ]),
      'four-way',
    )
    await firstFrame.controller.confirmFirstFrame('action-walk', 'north-frame.png', 'north')
    expect(firstFrame.controller.getWorkflow().nodes[2]).toMatchObject({
      selectedFirstFrameUrl: 'east-frame.png',
    })
  })

  it('非东向确认在尚无东向选择时不伪造兼容值', async () => {
    const template = createController(
      createRun([
        setupNode({ status: 'passed', phase: 'completed' }),
        templateNode({
          status: 'active',
          phase: 'selecting',
          selectedImageUrl: null,
          selectedImages: undefined,
        }),
      ]),
      'four-way',
    )
    await template.controller.confirmCharacterTemplate(
      'template-1',
      'north-template.png',
      'character-1',
      'north',
    )
    expect(template.controller.getWorkflow().nodes[1]).toMatchObject({ selectedImageUrl: null })

    const firstFrame = createController(
      createRun([
        ...completedCharacterNodes(),
        firstFrameNode({
          status: 'active',
          phase: 'selecting',
          selectedFirstFrameUrl: null,
          selectedFirstFrameUrls: undefined,
        }),
      ]),
      'four-way',
    )
    await firstFrame.controller.confirmFirstFrame('action-walk', 'north-frame.png', 'north')
    expect(firstFrame.controller.getWorkflow().nodes[2]).toMatchObject({
      selectedFirstFrameUrl: null,
    })
  })

  it('四向旧角色只有东向兼容字段时拒绝创建任何首帧任务', async () => {
    const run = createRun([...completedCharacterNodes(), ...actionNodes()])
    const { controller, generation } = createController(run, 'four-way')

    await expect(
      controller.generateFirstFrame('action-walk', { spriteWidth: 64, spriteHeight: 64 }),
    ).rejects.toThrow('角色母版尚未确认方向 north')

    expect(generation.apis.create).not.toHaveBeenCalled()
  })

  it('四向旧首帧只有东向兼容字段时拒绝创建任何完整动画任务', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'https://img/east.png',
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({ status: 'active' }),
      reviewNode(),
    ])
    const { controller, generation } = createController(run, 'four-way')

    await expect(
      controller.generateCompleteAnimation('action-walk:action-full-frame', {
        characterId: 'character-1',
        referenceMedia: [],
      }),
    ).rejects.toThrow('动作首帧尚未确认方向 north')

    expect(generation.apis.create).not.toHaveBeenCalled()
  })

  it('生成入口拒绝不属于目标阶段的节点', async () => {
    const { controller, generation } = createController(
      createRun([...completedCharacterNodes(), ...actionNodes()]),
    )

    await expect(
      controller.generateFirstFrame('template-1', { spriteWidth: 64, spriteHeight: 64 }),
    ).rejects.toThrow('目标节点不是动作首帧')
    await expect(
      controller.generateCompleteAnimation('action-walk', {
        characterId: 'character-1',
        referenceMedia: [],
      }),
    ).rejects.toThrow('目标节点不是完整动画')
    expect(generation.apis.create).not.toHaveBeenCalled()
  })

  it('生成入口在提交前重新校验节点阶段和动作生成方式', async () => {
    const selectingFirstFrame = createController(
      createRun([
        ...completedCharacterNodes(),
        firstFrameNode({ status: 'active', phase: 'selecting' }),
      ]),
    )
    await expect(
      selectingFirstFrame.controller.generateFirstFrame('action-walk', {
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    ).rejects.toThrow('动作首帧节点当前不能生成')

    const generatingFullFrame = createController(
      createRun([
        ...completedCharacterNodes(),
        firstFrameNode({
          status: 'passed',
          phase: 'completed',
          selectedFirstFrameUrl: 'first.png',
        }),
        generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
        fullFrameNode({ status: 'active', phase: 'generating' }),
      ]),
    )
    await expect(
      generatingFullFrame.controller.generateCompleteAnimation('action-walk:action-full-frame', {
        characterId: 'character-1',
        referenceMedia: [],
      }),
    ).rejects.toThrow('完整动画节点当前不能生成')

    const missingMethod = createController(
      createRun([
        ...completedCharacterNodes(),
        firstFrameNode({
          status: 'passed',
          phase: 'completed',
          selectedFirstFrameUrl: 'first.png',
        }),
        generationMethodNode({ status: 'passed', phase: 'completed', method: null }),
        fullFrameNode({ status: 'active', phase: 'ready' }),
      ]),
    )
    await expect(
      missingMethod.controller.generateCompleteAnimation('action-walk:action-full-frame', {
        characterId: 'character-1',
        referenceMedia: [],
      }),
    ).rejects.toThrow('尚未选择动作生成方式')
  })

  it('四向允许确认源方向、拒绝镜像与超规格方向，并在服务端返回错误方向时终止节点', async () => {
    const confirmation = createController(
      createRun([
        setupNode({ status: 'passed', phase: 'completed' }),
        templateNode({ status: 'active', phase: 'selecting' }),
      ]),
      'four-way',
    )

    await confirmation.controller.confirmCharacterTemplate(
      'template-1',
      'north.png',
      'character-1',
      'north',
    )
    expect(confirmation.controller.getWorkflow().nodes[1]).toMatchObject({
      selectedImages: { north: 'north.png' },
    })
    await expect(
      confirmation.controller.confirmCharacterTemplate(
        'template-1',
        'west.png',
        'character-1',
        'west',
      ),
    ).rejects.toThrow('方向 west 是镜像方向，不能单独生成或确认')
    await expect(
      confirmation.controller.confirmCharacterTemplate(
        'template-1',
        'north-east.png',
        'character-1',
        'north_east',
      ),
    ).rejects.toThrow('方向 north_east 是镜像方向，不能单独生成或确认')

    const { controller, generation } = createController(createRun(), 'four-way')

    await controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    generation.emit({
      taskId: 'task-1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        direction: 'north',
        images: [{ url: 'north-1.png' }, { url: 'north-2.png' }],
      },
      error: null,
    })
    await flushAsyncWork()

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'failed',
      error: '生成结果方向与 WorkflowRun 任务方向不一致',
    })
  })

  it('四向节点等待全部方向，并传播其它方向的失败或错向结果', async () => {
    const references = (['east', 'west', 'north', 'south'] as const).map((direction) => ({
      taskId: `task-${direction}`,
      role: 'character_template' as const,
      direction,
    }))
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({ status: 'active', phase: 'generating', generations: references }),
    ])
    const current = {
      id: 'task-east',
      projectId: '1',
      type: 'character_template' as const,
      status: 'completed' as const,
      result: {
        type: 'character_template' as const,
        direction: 'east' as const,
        images: [{ url: 'east-1.png' }, { url: 'east-2.png' }],
      },
      error: null,
    }
    const failed = createController(run, 'four-way')
    failed.generation.snapshots.set('task-north', {
      id: 'task-north',
      projectId: '1',
      type: 'character_template',
      status: 'failed',
      result: null,
      error: 'north provider failed',
    })
    failed.generation.snapshots.set('task-west', {
      id: 'task-west',
      projectId: '1',
      type: 'character_template',
      status: 'pending',
      result: null,
      error: null,
    })
    failed.generation.snapshots.set('task-south', {
      id: 'task-south',
      projectId: '1',
      type: 'character_template',
      status: 'pending',
      result: null,
      error: null,
    })
    failed.generation.snapshots.set('task-west', {
      id: 'task-west',
      projectId: '1',
      type: 'character_template',
      status: 'pending',
      result: null,
      error: null,
    })

    await failed.controller.applyGenerationResult({
      nodeId: 'template-1',
      taskId: 'task-east',
      generation: current,
    })
    expect(failed.controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'failed',
      error: 'north provider failed',
    })

    const mismatched = createController(run, 'four-way')
    for (const [taskId, direction] of [
      ['task-west', 'west'],
      ['task-north', 'south'],
      ['task-south', 'south'],
    ] as const) {
      mismatched.generation.snapshots.set(taskId, {
        id: taskId,
        projectId: '1',
        type: 'character_template',
        status: 'completed',
        result: {
          type: 'character_template',
          direction,
          images: [{ url: `${direction}-1.png` }, { url: `${direction}-2.png` }],
        },
        error: null,
      })
    }
    await mismatched.controller.applyGenerationResult({
      nodeId: 'template-1',
      taskId: 'task-east',
      generation: current,
    })
    expect(mismatched.controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'failed',
      error: '生成结果方向与 WorkflowRun 任务方向不一致',
    })

    const incomplete = createController(
      createRun([
        setupNode({ status: 'passed', phase: 'completed' }),
        templateNode({
          status: 'active',
          phase: 'generating',
          generations: [references[0]!],
        }),
      ]),
      'four-way',
    )
    await incomplete.controller.applyGenerationResult({
      nodeId: 'template-1',
      taskId: 'task-east',
      generation: current,
    })
    expect(incomplete.controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'selecting',
    })
  })

  it('非东向任务失败时保留服务端错误而不误报方向不一致', async () => {
    const references = (['east', 'north', 'south'] as const).map((direction) => ({
      taskId: `task-${direction}`,
      role: 'character_template' as const,
      direction,
    }))
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({ status: 'active', phase: 'generating', generations: references }),
    ])
    const { controller, generation } = createController(run, 'four-way')
    generation.snapshots.set('task-east', {
      id: 'task-east',
      projectId: '1',
      type: 'character_template',
      status: 'running',
      result: null,
      error: null,
    })
    generation.snapshots.set('task-south', {
      id: 'task-south',
      projectId: '1',
      type: 'character_template',
      status: 'running',
      result: null,
      error: null,
    })

    await controller.applyGenerationResult({
      nodeId: 'template-1',
      taskId: 'task-north',
      generation: {
        id: 'task-north',
        projectId: '1',
        type: 'character_template',
        status: 'failed',
        result: null,
        error: 'north provider failed',
      },
    })

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'failed',
      error: 'north provider failed',
    })
  })

  it('只重试失败方向并保留其它方向的任务引用', async () => {
    const { controller, generation } = createController(createRun(), 'four-way')

    await controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    for (const [index, direction] of ['east', 'north', 'south'].entries()) {
      generation.emit({
        taskId: `task-${index + 1}`,
        type: 'character_template',
        status: direction === 'north' ? 'failed' : 'completed',
        result:
          direction === 'north'
            ? null
            : {
                type: 'character_template',
                direction: direction as 'east' | 'south',
                images: [{ url: `${direction}-1.png` }, { url: `${direction}-2.png` }],
              },
        error: direction === 'north' ? 'north provider failed' : null,
      })
    }
    await flushAsyncWork()

    await controller.retryGenerationDirection('template-1', 'north', {
      spriteWidth: 64,
      spriteHeight: 64,
    })

    expect(generation.apis.create).toHaveBeenCalledTimes(4)
    expect(generation.apis.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'character_template', direction: 'north' }),
    )
    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'generating',
      generations: [
        { taskId: 'task-1', role: 'character_template' },
        { taskId: 'task-3', role: 'character_template', direction: 'south' },
        { taskId: 'task-4', role: 'character_template', direction: 'north' },
      ],
    })
  })

  it('已确认母版后的方向重试继续锁定母版且只生成一张', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'failed',
        phase: 'generating',
        error: 'north provider failed',
        selectedImageUrl: 'east-master.png',
        selectedImages: { east: 'east-master.png' },
        generations: [
          { taskId: 'task-east', role: 'character_template' },
          { taskId: 'task-north', role: 'character_template', direction: 'north' },
        ],
      }),
    ])
    const { controller, generation } = createController(run, 'four-way')
    generation.snapshots.set('task-east', {
      id: 'task-east',
      projectId: '1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        direction: 'east',
        images: [{ url: 'east-master.png' }],
      },
      error: null,
    })

    await controller.retryGenerationDirection('template-1', 'north', {
      spriteWidth: 64,
      spriteHeight: 64,
    })

    expect(generation.apis.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'character_template',
        direction: 'north',
        candidateCount: 1,
        referenceMedia: ['east-master.png'],
      }),
    )
  })

  it('动作首帧只重试失败方向并使用同方向角色母版', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'east-template.png',
        selectedImages: {
          east: 'east-template.png',
          north: 'north-template.png',
          south: 'south-template.png',
        },
      }),
      firstFrameNode({
        status: 'failed',
        phase: 'generating',
        generations: [
          { taskId: 'task-east', role: 'first_frame' },
          { taskId: 'task-north', role: 'first_frame', direction: 'north' },
          { taskId: 'task-south', role: 'first_frame', direction: 'south' },
        ],
        selectedFirstFrameUrl: 'east-frame.png',
        selectedFirstFrameUrls: {
          east: 'east-frame.png',
          north: 'north-frame.png',
          south: 'south-frame.png',
        },
        error: 'north provider failed',
      }),
      generationMethodNode(),
      fullFrameNode(),
      reviewNode(),
    ])
    const { controller, generation } = createController(run, 'four-way')
    for (const direction of ['east', 'south'] as const) {
      generation.snapshots.set(`task-${direction}`, {
        id: `task-${direction}`,
        projectId: '1',
        type: 'first_frame',
        status: 'completed',
        result: {
          type: 'first_frame',
          direction,
          images: [{ url: `${direction}-frame.png` }, { url: `${direction}-alt.png` }],
        },
        error: null,
      })
    }

    await controller.retryGenerationDirection('action-walk', 'north', {
      spriteWidth: 64,
      spriteHeight: 64,
    })

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'first_frame',
      projectId: '1',
      actionType: 'walk',
      prompt: '行走',
      spriteWidth: 64,
      spriteHeight: 64,
      referenceMedia: ['north-template.png'],
      direction: 'north',
    })
    const retriedFirstFrame = controller.getWorkflow().nodes[2]
    if (retriedFirstFrame?.type !== 'action-first-frame') {
      throw new Error('测试运行缺少动作首帧节点')
    }
    expect(retriedFirstFrame).toMatchObject({
      status: 'active',
      phase: 'generating',
      selectedFirstFrameUrl: 'east-frame.png',
    })
    expect(retriedFirstFrame.selectedFirstFrameUrls).toEqual({
      east: 'east-frame.png',
      south: 'south-frame.png',
    })
    expect(retriedFirstFrame.generations).toEqual([
      { taskId: 'task-east', role: 'first_frame' },
      { taskId: 'task-south', role: 'first_frame', direction: 'south' },
      { taskId: 'task-1', role: 'first_frame', direction: 'north' },
    ])
  })

  it('完整动画只重试失败方向并沿用同方向首帧和独立动作描述', async () => {
    const run = createRun([
      setupNode({
        status: 'passed',
        phase: 'completed',
        input: { prompt: '像素骑士', referenceMedia: [], characterId: 'character-1' },
      }),
      templateNode({
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'east-template.png',
      }),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        input: actionInput({ prompt: '挥拳前保持蓄势姿势' }),
        selectedFirstFrameUrl: 'east-frame.png',
        selectedFirstFrameUrls: {
          east: 'east-frame.png',
          north: 'north-frame.png',
          south: 'south-frame.png',
        },
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({
        status: 'failed',
        phase: 'generating',
        input: { prompt: '向前挥拳、击中后自然收势' },
        generations: [
          { taskId: 'task-east', role: 'complete_animation' },
          { taskId: 'task-north', role: 'complete_animation', direction: 'north' },
          { taskId: 'task-south', role: 'complete_animation', direction: 'south' },
        ],
        error: 'north provider failed',
      }),
      reviewNode(),
    ])
    const { controller, generation } = createController(run, 'four-way')
    for (const direction of ['east', 'south'] as const) {
      generation.snapshots.set(`task-${direction}`, {
        id: `task-${direction}`,
        projectId: '1',
        type: 'complete_animation',
        status: 'completed',
        result: {
          type: 'complete_animation',
          direction,
          frames: [{ index: 0, url: `${direction}-frame.png`, durationMs: 80 }],
        },
        error: null,
      })
    }

    await controller.retryGenerationDirection('action-walk:action-full-frame', 'north', {
      spriteWidth: 64,
      spriteHeight: 64,
      referenceMedia: ['north-reference.png' as never],
    })

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'complete_animation',
      projectId: '1',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      method: 'video-cropping',
      actionType: 'walk',
      firstFrameUrl: 'north-frame.png',
      prompt: '向前挥拳、击中后自然收势',
      referenceMedia: ['north-reference.png'],
      direction: 'north',
    })
    const retriedFullFrame = controller.getWorkflow().nodes[4]
    if (retriedFullFrame?.type !== 'action-full-frame') {
      throw new Error('测试运行缺少完整动画节点')
    }
    expect(retriedFullFrame).toMatchObject({
      status: 'active',
      phase: 'generating',
      error: null,
    })
    expect(retriedFullFrame.generations).toEqual([
      { taskId: 'task-east', role: 'complete_animation' },
      { taskId: 'task-south', role: 'complete_animation', direction: 'south' },
      { taskId: 'task-1', role: 'complete_animation', direction: 'north' },
    ])
  })

  it('重试东向时只清空对应的兼容选择字段', async () => {
    const templateRetry = createController(
      createRun([
        setupNode({ status: 'passed', phase: 'completed' }),
        templateNode({
          status: 'failed',
          phase: 'generating',
          generations: [{ taskId: 'template-east', role: 'character_template' }],
          selectedImageUrl: 'east-template.png',
          selectedImages: { east: 'east-template.png', north: 'north-template.png' },
          error: 'east failed',
        }),
      ]),
    )

    await templateRetry.controller.retryGenerationDirection('template-1', 'east', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    const retriedTemplate = templateRetry.controller.getWorkflow().nodes[1]
    expect(retriedTemplate).toMatchObject({
      selectedImageUrl: null,
    })
    if (!retriedTemplate || retriedTemplate.type !== 'character-template') {
      throw new Error('missing template')
    }
    expect(retriedTemplate.selectedImages).toEqual({ north: 'north-template.png' })

    const firstFrameRetry = createController(
      createRun([
        ...completedCharacterNodes(),
        firstFrameNode({
          status: 'failed',
          phase: 'generating',
          generations: [{ taskId: 'first-east', role: 'first_frame' }],
          selectedFirstFrameUrl: 'east-frame.png',
          selectedFirstFrameUrls: { east: 'east-frame.png', north: 'north-frame.png' },
          error: 'east failed',
        }),
      ]),
    )

    await firstFrameRetry.controller.retryGenerationDirection('action-walk', 'east', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    const retriedFirstFrame = firstFrameRetry.controller.getWorkflow().nodes[2]
    expect(retriedFirstFrame).toMatchObject({
      selectedFirstFrameUrl: null,
    })
    if (!retriedFirstFrame || retriedFirstFrame.type !== 'action-first-frame') {
      throw new Error('missing first frame')
    }
    expect(retriedFirstFrame.selectedFirstFrameUrls).toEqual({ north: 'north-frame.png' })
  })

  it('方向重试在创建任务前校验同方向依赖', async () => {
    const missingTemplate = createController(
      createRun([
        setupNode({ status: 'passed', phase: 'completed' }),
        templateNode({
          status: 'passed',
          phase: 'completed',
          selectedImageUrl: 'east-template.png',
          selectedImages: { east: 'east-template.png', south: 'south-template.png' },
        }),
        firstFrameNode({
          status: 'failed',
          phase: 'generating',
          generations: [{ taskId: 'first-north', role: 'first_frame', direction: 'north' }],
          error: 'north failed',
        }),
      ]),
      'four-way',
    )
    await expect(
      missingTemplate.controller.retryGenerationDirection('action-walk', 'north', {
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    ).rejects.toThrow('角色母版尚未确认方向 north')
    expect(missingTemplate.generation.apis.create).not.toHaveBeenCalled()

    const fullFrameNodes = (
      setup = setupNode({
        status: 'passed',
        phase: 'completed',
        input: { prompt: '像素骑士', referenceMedia: [], characterId: 'character-1' },
      }),
      method: 'video-cropping' | null = 'video-cropping',
      selectedFirstFrameUrls: Record<string, string> = {
        east: 'east-frame.png',
        north: 'north-frame.png',
        south: 'south-frame.png',
      },
    ) => [
      setup,
      templateNode({ status: 'passed', phase: 'completed', selectedImageUrl: 'east-template.png' }),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'east-frame.png',
        selectedFirstFrameUrls,
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method }),
      fullFrameNode({
        status: 'failed',
        phase: 'generating',
        generations: [{ taskId: 'full-north', role: 'complete_animation', direction: 'north' }],
        error: 'north failed',
      }),
      reviewNode(),
    ]

    const missingMethod = createController(createRun(fullFrameNodes(undefined, null)), 'four-way')
    await expect(
      missingMethod.controller.retryGenerationDirection('action-walk:action-full-frame', 'north', {
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    ).rejects.toThrow('尚未选择动作生成方式')
    expect(missingMethod.generation.apis.create).not.toHaveBeenCalled()

    const missingCharacter = createController(
      createRun(fullFrameNodes(setupNode({ status: 'passed', phase: 'completed' }))),
      'four-way',
    )
    await expect(
      missingCharacter.controller.retryGenerationDirection(
        'action-walk:action-full-frame',
        'north',
        { spriteWidth: 64, spriteHeight: 64 },
      ),
    ).rejects.toThrow('characterId 不能为空')
    expect(missingCharacter.generation.apis.create).not.toHaveBeenCalled()

    const missingFirstFrame = createController(
      createRun(fullFrameNodes(undefined, 'video-cropping', { east: 'east-frame.png' })),
      'four-way',
    )
    await expect(
      missingFirstFrame.controller.retryGenerationDirection(
        'action-walk:action-full-frame',
        'north',
        { spriteWidth: 64, spriteHeight: 64 },
      ),
    ).rejects.toThrow('动作首帧尚未确认方向 north')
    expect(missingFirstFrame.generation.apis.create).not.toHaveBeenCalled()
  })

  it('完整动画方向重试未传引用媒体时显式使用空数组', async () => {
    const run = createRun([
      setupNode({
        status: 'passed',
        phase: 'completed',
        input: { prompt: '像素骑士', referenceMedia: [], characterId: 'character-1' },
      }),
      templateNode({ status: 'passed', phase: 'completed', selectedImageUrl: 'east-template.png' }),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'east-frame.png',
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({
        status: 'failed',
        phase: 'generating',
        generations: [{ taskId: 'full-east', role: 'complete_animation' }],
        error: 'east failed',
      }),
      reviewNode(),
    ])
    const { controller, generation } = createController(run)

    await controller.retryGenerationDirection('action-walk:action-full-frame', 'east', {
      spriteWidth: 64,
      spriteHeight: 64,
    })

    expect(generation.apis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'complete_animation',
        referenceMedia: [],
        direction: 'east',
      }),
    )
  })

  it('失败任务没有可用错误文本时使用可诊断的默认错误', async () => {
    const { controller, generation } = createController(
      createRun([
        setupNode({ status: 'passed', phase: 'completed' }),
        templateNode({
          status: 'active',
          phase: 'generating',
          generations: [
            { taskId: 'task-east', role: 'character_template' },
            { taskId: 'task-north', role: 'character_template', direction: 'north' },
            { taskId: 'task-south', role: 'character_template', direction: 'south' },
          ],
        }),
      ]),
      'four-way',
    )
    generation.snapshots.set('task-north', {
      id: 'task-north',
      projectId: '1',
      type: 'character_template',
      status: 'failed',
      result: null,
      error: '   ',
    })
    generation.snapshots.set('task-south', {
      id: 'task-south',
      projectId: '1',
      type: 'character_template',
      status: 'running',
      result: null,
      error: null,
    })

    await controller.applyGenerationResult({
      nodeId: 'template-1',
      taskId: 'task-east',
      generation: {
        id: 'task-east',
        projectId: '1',
        type: 'character_template',
        status: 'completed',
        result: {
          type: 'character_template',
          direction: 'east',
          images: [{ url: 'east-1.png' }, { url: 'east-2.png' }],
        },
        error: null,
      },
    })

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'failed',
      error: '方向生成任务失败',
    })
  })

  it('查询任务时可回退到唯一的非东向结果', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-north', role: 'character_template', direction: 'north' }],
      }),
    ])
    const { controller, generation } = createController(run, 'four-way')
    generation.snapshots.set('task-north', {
      id: 'task-north',
      projectId: '1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        direction: 'north',
        images: [{ url: 'north-1.png' }, { url: 'north-2.png' }],
      },
      error: null,
    })

    await expect(
      controller.getGeneration('template-1', 'character_template'),
    ).resolves.toMatchObject({
      id: 'task-north',
      result: { direction: 'north' },
    })
  })

  it('损坏运行把生成引用挂到非生成节点时安全忽略结果', async () => {
    const setup = setupNode({
      status: 'active',
      phase: 'configuring',
      generations: [{ taskId: 'orphan-task', role: 'character_template' }],
    })
    const { controller } = createController(createRun([setup]))
    const before = controller.getWorkflow()

    await controller.applyGenerationResult({
      nodeId: setup.id,
      taskId: 'orphan-task',
      generation: {
        id: 'orphan-task',
        projectId: '1',
        type: 'character_template',
        status: 'completed',
        result: {
          type: 'character_template',
          images: [{ url: 'one.png' }, { url: 'two.png' }],
        },
        error: null,
      },
    })

    expect(controller.getWorkflow()).toEqual(before)
    await expect(controller.getGenerations(setup.id, 'character_template')).rejects.toThrow(
      '不是生成节点',
    )
  })

  it('方向重试拒绝非生成节点、不可重试状态和缺失任务引用', async () => {
    const { controller } = createController(
      createRun([
        setupNode({ status: 'passed', phase: 'completed' }),
        templateNode({
          status: 'passed',
          phase: 'completed',
          selectedImageUrl: 'east-template.png',
          generations: [{ taskId: 'task-east', role: 'character_template' }],
        }),
        firstFrameNode({ status: 'failed', phase: 'generating' }),
        generationMethodNode({ status: 'failed', phase: 'selecting' }),
      ]),
      'four-way',
    )

    await expect(
      controller.retryGenerationDirection('action-walk:action-generation-method', 'north', {
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    ).rejects.toThrow('目标节点不是生成节点')
    await expect(
      controller.retryGenerationDirection('template-1', 'east', {
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    ).rejects.toThrow('当前方向不能重新生成')
    await expect(
      controller.retryGenerationDirection('action-walk', 'north', {
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    ).rejects.toThrow('方向 north 没有可替换的生成任务')
  })

  it('方向重试提交失败时恢复原节点及失败信息', async () => {
    const original = templateNode({
      status: 'failed',
      phase: 'generating',
      generations: [{ taskId: 'task-north', role: 'character_template', direction: 'north' }],
      error: 'north provider failed',
      selectedImageUrl: 'east-template.png',
      selectedImages: { east: 'east-template.png', north: 'north-template.png' },
    })
    const { controller, generation } = createController(
      createRun([setupNode({ status: 'passed', phase: 'completed' }), original]),
      'four-way',
    )
    vi.mocked(generation.apis.create).mockRejectedValueOnce(new Error('retry request failed'))

    await expect(
      controller.retryGenerationDirection('template-1', 'north', {
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    ).rejects.toThrow('retry request failed')

    expect(controller.getWorkflow().nodes[1]).toEqual(original)
  })

  it('刷新后恢复其它方向订阅失败时仍保留新建的重试任务引用', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'failed',
        phase: 'generating',
        error: 'north provider failed',
        generations: [
          { taskId: 'task-east', role: 'character_template' },
          { taskId: 'task-north', role: 'character_template', direction: 'north' },
          { taskId: 'task-south', role: 'character_template', direction: 'south' },
        ],
      }),
    ])
    const { controller, generation } = createController(run, 'four-way')
    generation.snapshots.set('task-east', {
      id: 'task-east',
      projectId: '1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        direction: 'east',
        images: [{ url: 'east-1.png' }, { url: 'east-2.png' }],
      },
      error: null,
    })
    generation.snapshots.set('task-north', {
      id: 'task-north',
      projectId: '1',
      type: 'character_template',
      status: 'failed',
      result: null,
      error: 'north provider failed',
    })
    generation.snapshots.set('task-south', {
      id: 'task-south',
      projectId: '1',
      type: 'character_template',
      status: 'running',
      result: null,
      error: null,
    })
    const readGeneration = vi.mocked(generation.apis.get)
    const readSnapshot = readGeneration.getMockImplementation()!
    let failSouthRestore = false
    readGeneration.mockImplementation(async (projectId, taskId, expectation) => {
      if (failSouthRestore && taskId === 'task-south') {
        throw new Error('south subscription restore failed')
      }
      return readSnapshot(projectId, taskId, expectation)
    })

    await controller.resume()
    expect(generation.apis.subscribe).not.toHaveBeenCalled()
    failSouthRestore = true
    await expect(
      controller.retryGenerationDirection('template-1', 'north', {
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    ).rejects.toThrow('south subscription restore failed')

    expect(generation.apis.subscribe).toHaveBeenCalledWith(
      '1',
      'task-south',
      expect.objectContaining({ type: 'character_template', direction: 'south' }),
      expect.any(Function),
      expect.any(Function),
    )
    expect(controller.getWorkflow().nodes[1]?.generations).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: 'task-1', direction: 'north' })]),
    )
  })

  it('新方向任务引用落库后订阅失败时不回滚到旧失败任务', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'failed',
        phase: 'generating',
        error: 'north provider failed',
        generations: [
          { taskId: 'task-east', role: 'character_template' },
          { taskId: 'task-north', role: 'character_template', direction: 'north' },
          { taskId: 'task-south', role: 'character_template', direction: 'south' },
        ],
      }),
    ])
    const { controller, workflow, generation } = createController(run, 'four-way')
    vi.mocked(generation.apis.subscribe).mockImplementationOnce(() => {
      throw new Error('新任务订阅失败')
    })

    await expect(
      controller.retryGenerationDirection('template-1', 'north', {
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    ).rejects.toThrow('新任务订阅失败')

    expect(workflow.getSaved().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'generating',
      error: null,
      generations: [
        { taskId: 'task-east', role: 'character_template' },
        { taskId: 'task-south', role: 'character_template', direction: 'south' },
        { taskId: 'task-1', role: 'character_template', direction: 'north' },
      ],
    })
    expect(generation.apis.create).toHaveBeenCalledTimes(1)
  })

  it('角色母版微调由 Controller 读取上一版图片并组合临时描述', async () => {
    const previousImage = 'https://img/knight.png'
    const { controller, generation } = createController(createRun(completedCharacterNodes()))

    await controller.regenerateCharacterTemplate('template-1', {
      spriteWidth: 64,
      spriteHeight: 64,
      mode: 'refine',
      adjustmentPrompt: '换成水彩风格',
    })

    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'character_template',
      projectId: '1',
      prompt: '像素骑士\n换成水彩风格',
      referenceMedia: [previousImage],
      spriteWidth: 64,
      spriteHeight: 64,
      direction: 'east',
    })
    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'setup-1',
          input: expect.objectContaining({ prompt: '像素骑士' }),
        }),
      ]),
    )
  })

  it('角色母版重新生成沿用原始输入且不携带上一版图片', async () => {
    const { controller, generation } = createController(createRun(completedCharacterNodes()))

    await controller.regenerateCharacterTemplate('template-1', {
      spriteWidth: 64,
      spriteHeight: 64,
      mode: 'regenerate',
    })

    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'character_template',
      projectId: '1',
      prompt: '像素骑士',
      referenceMedia: [],
      spriteWidth: 64,
      spriteHeight: 64,
      direction: 'east',
    })
  })

  it('角色母版尚未确认图片时拒绝重新生成', async () => {
    const { controller, generation } = createController()

    await expect(
      controller.regenerateCharacterTemplate('template-1', {
        spriteWidth: 64,
        spriteHeight: 64,
        mode: 'regenerate',
      }),
    ).rejects.toThrow('角色母版当前不能重新生成')
    expect(generation.apis.create).not.toHaveBeenCalled()
  })

  it('四向微调在重启节点前拒绝缺失的同方向参考图', async () => {
    const templateRun = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'east-template.png',
        selectedImages: {
          east: 'east-template.png',
          west: 'west-template.png',
          south: 'south-template.png',
        },
      }),
    ])
    const template = createController(templateRun, 'four-way')
    const templateBefore = template.controller.getWorkflow()
    await expect(
      template.controller.regenerateCharacterTemplate('template-1', {
        spriteWidth: 64,
        spriteHeight: 64,
        mode: 'refine',
        adjustmentPrompt: '加强阴影',
      }),
    ).rejects.toThrow('角色母版尚未确认方向 north')
    expect(template.generation.apis.create).not.toHaveBeenCalled()
    expect(template.controller.getWorkflow()).toEqual(templateBefore)

    const firstFrameRun = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'east-frame.png',
        selectedFirstFrameUrls: {
          east: 'east-frame.png',
          west: 'west-frame.png',
          south: 'south-frame.png',
        },
      }),
    ])
    const firstFrame = createController(firstFrameRun, 'four-way')
    const firstFrameBefore = firstFrame.controller.getWorkflow()
    await expect(
      firstFrame.controller.regenerateFirstFrame('action-walk', {
        spriteWidth: 64,
        spriteHeight: 64,
        mode: 'refine',
        adjustmentPrompt: '调整姿势',
      }),
    ).rejects.toThrow('动作首帧尚未确认方向 north')
    expect(firstFrame.generation.apis.create).not.toHaveBeenCalled()
    expect(firstFrame.controller.getWorkflow()).toEqual(firstFrameBefore)
  })

  it('角色母版重新生成提交失败后还原用户已确认的图片', async () => {
    const previousImage = 'https://img/knight.png'
    const { controller, generation } = createController(createRun(completedCharacterNodes()))
    vi.mocked(generation.apis.create).mockRejectedValueOnce(new Error('生成服务暂时不可用'))

    await expect(
      controller.regenerateCharacterTemplate('template-1', {
        spriteWidth: 64,
        spriteHeight: 64,
        mode: 'refine',
        adjustmentPrompt: '换成水彩风格',
      }),
    ).rejects.toThrow('生成服务暂时不可用')

    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'template-1',
          status: 'passed',
          phase: 'completed',
          selectedImageUrl: previousImage,
        }),
      ]),
    )
  })

  it('角色母版回滚持久化失败时暴露工作流冲突', async () => {
    const { controller, workflow, generation } = createController(
      createRun(completedCharacterNodes()),
    )
    const update = vi.mocked(workflow.apis.update)
    const save = update.getMockImplementation()!
    update
      .mockImplementationOnce(save)
      .mockRejectedValueOnce(new Error('任务引用保存失败'))
      .mockRejectedValueOnce(new Error('回滚保存失败'))

    await expect(
      controller.regenerateCharacterTemplate('template-1', {
        spriteWidth: 64,
        spriteHeight: 64,
        mode: 'refine',
        adjustmentPrompt: '换成水彩风格',
      }),
    ).rejects.toMatchObject({ name: 'WorkflowRunConflictError' })
    expect(generation.apis.create).toHaveBeenCalledTimes(1)
  })

  it('角色母版任务已创建但挂载失败时重试复用同一个任务', async () => {
    const { controller, workflow, generation } = createController(
      createRun(completedCharacterNodes()),
    )
    const update = vi.mocked(workflow.apis.update)
    const save = update.getMockImplementation()!
    update.mockImplementationOnce(save).mockRejectedValueOnce(new Error('任务引用保存失败'))

    const options = {
      spriteWidth: 64,
      spriteHeight: 64,
      mode: 'refine' as const,
      adjustmentPrompt: '换成水彩风格',
    }
    await expect(controller.regenerateCharacterTemplate('template-1', options)).rejects.toThrow(
      '任务引用保存失败',
    )
    await controller.regenerateCharacterTemplate('template-1', options)

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'template-1',
          phase: 'generating',
          generations: [{ taskId: 'task-1', role: 'character_template' }],
        }),
      ]),
    )
  })

  it('角色母版任务已创建但订阅失败时重试复用同一个任务', async () => {
    const { controller, generation } = createController(createRun(completedCharacterNodes()))
    vi.mocked(generation.apis.subscribe).mockImplementationOnce(() => {
      throw new Error('生成任务订阅失败')
    })

    const options = {
      spriteWidth: 64,
      spriteHeight: 64,
      mode: 'regenerate' as const,
    }
    await expect(controller.regenerateCharacterTemplate('template-1', options)).rejects.toThrow(
      '生成任务订阅失败',
    )
    await controller.regenerateCharacterTemplate('template-1', options)

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'template-1',
          phase: 'generating',
          generations: [{ taskId: 'task-1', role: 'character_template' }],
        }),
      ]),
    )
  })

  it('角色母版挂载时发现节点已被其他任务占用则保留现有引用', async () => {
    const { controller, workflow, generation } = createController(
      createRun(completedCharacterNodes()),
    )
    const update = vi.mocked(workflow.apis.update)
    const save = update.getMockImplementation()!
    update.mockImplementationOnce(save).mockImplementationOnce(async (run) => {
      const saved = await save(run)
      return {
        ...saved,
        nodes: saved.nodes.map((node) =>
          node.id === 'template-1'
            ? { ...node, generations: [{ taskId: 'other-task', role: 'character_template' }] }
            : node,
        ),
      }
    })

    await controller.regenerateCharacterTemplate('template-1', {
      spriteWidth: 64,
      spriteHeight: 64,
      mode: 'regenerate',
    })

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'template-1',
          generations: [{ taskId: 'other-task', role: 'character_template' }],
        }),
      ]),
    )
  })

  it('角色母版任务已被并发请求挂载时复用相同引用', async () => {
    const { controller, workflow, generation } = createController(
      createRun(completedCharacterNodes()),
    )
    const update = vi.mocked(workflow.apis.update)
    const save = update.getMockImplementation()!
    update.mockImplementationOnce(save).mockImplementationOnce(async (run) => {
      const saved = await save(run)
      return {
        ...saved,
        nodes: saved.nodes.map((node) =>
          node.id === 'template-1'
            ? { ...node, generations: [{ taskId: 'task-1', role: 'character_template' as const }] }
            : node,
        ),
      }
    })

    await controller.regenerateCharacterTemplate('template-1', {
      spriteWidth: 64,
      spriteHeight: 64,
      mode: 'regenerate',
    })

    expect(generation.apis.create).toHaveBeenCalledOnce()
    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      generations: [{ taskId: 'task-1', role: 'character_template' }],
    })
  })

  it('角色设定已落库但生成请求失败后可以重试', async () => {
    const { controller, generation } = createController()
    vi.mocked(generation.apis.create).mockRejectedValueOnce(new Error('生成服务暂时不可用'))

    await expect(
      controller.generateCharacterTemplate('setup-1', { spriteWidth: 64, spriteHeight: 64 }),
    ).rejects.toThrow('生成服务暂时不可用')
    await controller.generateCharacterTemplate('setup-1', { spriteWidth: 64, spriteHeight: 64 })
    expect(controller.getWorkflow()).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'template-1',
          phase: 'generating',
          generations: [{ taskId: 'task-1', role: 'character_template' }],
        }),
      ]),
    })
  })

  it('角色设定并发提交只创建一个母版生成任务', async () => {
    const { controller, generation } = createController()
    const options = { spriteWidth: 64, spriteHeight: 64 }

    await Promise.all([
      controller.generateCharacterTemplate('setup-1', options),
      controller.generateCharacterTemplate('setup-1', options),
    ])

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
  })

  it('SSE 与紧随其后的查询同时返回终态时只保存一次结果', async () => {
    const workflow = createWorkflowApis()
    const terminalEvent: GenerationEvent = {
      taskId: 'task-terminal',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        images: imageCandidates('https://img/knight'),
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
      subscribe: vi.fn((_projectId, _taskId, _expectation, onEvent) => {
        onEvent(terminalEvent)
        return () => undefined
      }) as unknown as GenerationApis['subscribe'],
    }
    const controller = createWorkflowController({
      workflow: createRun(),
      workflowRunApis: workflow.apis,
      generationApis,
      onAsyncError: vi.fn(),
    })

    await controller.generateCharacterTemplate('setup-1', { spriteWidth: 64, spriteHeight: 64 })

    expect(workflow.apis.update).toHaveBeenCalledTimes(3)
    expect(controller.getWorkflow().nodes[1].phase).toBe('selecting')
  })

  it('中断后忽略迟到结果，恢复时查询终态再推进', async () => {
    const { controller, generation } = createController()
    await controller.generateCharacterTemplate('setup-1', { spriteWidth: 64, spriteHeight: 64 })
    await controller.interrupt()

    generation.emit({
      taskId: 'task-1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        images: imageCandidates('https://img/knight'),
      },
      error: null,
    })
    await flushAsyncWork()
    expect(controller.getWorkflow().nodes[1].phase).toBe('generating')

    await controller.resume()
    expect(controller.getWorkflow().nodes[1].phase).toBe('selecting')
  })

  it('刷新后恢复历史双候选角色母版任务', async () => {
    const { controller, generation } = createController()
    await controller.generateCharacterTemplate('setup-1', { spriteWidth: 64, spriteHeight: 64 })
    await controller.interrupt()
    generation.snapshots.set('task-1', {
      id: 'task-1',
      projectId: '1',
      type: 'character_template',
      status: 'completed',
      result: {
        type: 'character_template',
        images: [{ url: 'https://img/legacy-1.png' }, { url: 'https://img/legacy-2.png' }],
      },
      error: null,
    })

    await controller.resume()

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'selecting',
      error: null,
    })
  })

  it('首帧订阅后的补偿查询沿用节点的图片结果预期', async () => {
    const run = createRun([...completedCharacterNodes(), ...actionNodes()])
    const workflow = createWorkflowApis(run)
    const terminalGeneration: Generation = {
      id: 'task-terminal',
      projectId: '1',
      type: 'first_frame',
      status: 'completed',
      result: {
        type: 'first_frame',
        images: imageCandidates('https://img/walk'),
      },
      error: null,
    }
    const generationApis: GenerationApis = {
      create: vi.fn(async () => ({
        ...terminalGeneration,
        status: 'pending',
        result: null,
      })) as GenerationApis['create'],
      get: vi.fn(async () => terminalGeneration),
      subscribe: vi.fn(() => () => undefined) as GenerationApis['subscribe'],
    }
    const controller = createWorkflowController({
      workflow: run,
      workflowRunApis: workflow.apis,
      generationApis,
      onAsyncError: vi.fn(),
    })

    await controller.generateFirstFrame('action-walk', { spriteWidth: 64, spriteHeight: 96 })

    expect(generationApis.get).toHaveBeenCalledWith('1', 'task-terminal', {
      type: 'first_frame',
      actionType: 'walk',
    })
    expect(controller.getWorkflow().nodes[2]).toMatchObject({
      status: 'active',
      phase: 'selecting',
    })
  })

  it('从母版节点重做会清空下游任务，旧事件不能覆盖新执行线', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-old', role: 'character_template' }],
      }),
      ...actionNodes().map((node) => ({ ...node, status: 'locked' as const })),
    ])
    const { controller } = createController(run)

    await controller.restartFromNode('template-1')
    await controller.applyGenerationResult({
      nodeId: 'template-1',
      taskId: 'task-old',
      generation: {
        id: 'task-old',
        projectId: '1',
        type: 'character_template',
        status: 'completed',
        result: {
          type: 'character_template',
          images: [
            { url: 'https://img/stale-1.png' },
            { url: 'https://img/stale-2.png' },
            { url: 'https://img/stale-3.png' },
          ],
        },
        error: null,
      },
    })

    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'template-1',
          status: 'active',
          phase: 'ready',
          generations: [],
        }),
        expect.objectContaining({ id: 'action-walk', status: 'locked', generations: [] }),
        expect.objectContaining({
          id: 'action-walk:action-full-frame',
          status: 'locked',
          generations: [],
        }),
      ]),
    )
  })

  it('重做一个 Action 只重置它的后代并保留显式边和其他并行 Action', async () => {
    const jumpNodes: WorkflowNode[] = [
      firstFrameNode({
        id: 'action-jump',
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-jump', role: 'first_frame' }],
        input: actionInput({ name: '跳跃', type: 'jump' }),
      }),
      generationMethodNode({
        id: 'action-jump:action-generation-method',
        dependsOnNodeIds: ['action-jump'],
      }),
      fullFrameNode({
        id: 'action-jump:action-full-frame',
        dependsOnNodeIds: ['action-jump:action-generation-method'],
      }),
      reviewNode({
        id: 'action-jump:review',
        dependsOnNodeIds: ['action-jump:action-full-frame'],
      }),
    ]
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'walk.png',
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-walk', role: 'complete_animation' }],
      }),
      reviewNode(),
      ...jumpNodes,
    ])
    const { controller } = createController(run)

    await controller.restartFromNode('action-walk:action-generation-method')

    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'action-walk:action-generation-method',
          status: 'active',
          dependsOnNodeIds: ['action-walk'],
        }),
        expect.objectContaining({
          id: 'action-walk:action-full-frame',
          status: 'locked',
          dependsOnNodeIds: ['action-walk:action-generation-method'],
        }),
        expect.objectContaining({
          id: 'action-walk:review',
          status: 'locked',
          dependsOnNodeIds: ['action-walk:action-full-frame'],
        }),
        expect.objectContaining({
          id: 'action-jump',
          status: 'active',
          phase: 'generating',
          generations: [{ taskId: 'task-jump', role: 'first_frame' }],
        }),
      ]),
    )
  })

  it('生成请求尚未返回时重做，旧任务不能挂回新执行线', async () => {
    const run = createRun([...completedCharacterNodes(), ...actionNodes()])
    const workflow = createWorkflowApis(run)
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
      workflow: run,
      workflowRunApis: workflow.apis,
      generationApis,
      onAsyncError: vi.fn(),
    })

    const oldSubmission = controller.generateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 96,
    })
    await Promise.resolve()
    await controller.restartFromNode('action-walk')

    const newSubmission = controller.generateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 96,
    })
    await Promise.resolve()
    expect(createGeneration).toHaveBeenCalledTimes(2)

    pendingResolvers[0]?.({
      id: 'task-old',
      projectId: '1',
      type: 'first_frame',
      status: 'pending',
      result: null,
      error: null,
    })
    await oldSubmission
    const sameNewSubmission = controller.generateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 96,
    })
    expect(createGeneration).toHaveBeenCalledTimes(2)

    pendingResolvers[1]?.({
      id: 'task-new',
      projectId: '1',
      type: 'first_frame',
      status: 'pending',
      result: null,
      error: null,
    })
    await Promise.all([newSubmission, sameNewSubmission])

    expect(controller.getWorkflow().nodes[2].generations).toEqual([
      { taskId: 'task-new', role: 'first_frame' },
    ])
  })

  it.each([
    ['角色设定', 'setup-1'],
    ['角色母版', 'template-1'],
  ])('角色母版请求尚未返回时从%s node 重做，新提交不会复用旧命令', async (_label, nodeId) => {
    const run = createRun()
    const workflow = createWorkflowApis(run)
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
      workflow: run,
      workflowRunApis: workflow.apis,
      generationApis,
      onAsyncError: vi.fn(),
    })

    const oldSubmission = controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    await flushAsyncWork()
    expect(createGeneration).toHaveBeenCalledTimes(1)

    await controller.restartFromNode(nodeId)
    const newSubmission = controller.generateCharacterTemplate('setup-1', {
      spriteWidth: 64,
      spriteHeight: 64,
    })
    await flushAsyncWork()

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
    pendingResolvers[1]?.({
      id: 'task-new',
      projectId: '1',
      type: 'character_template',
      status: 'pending',
      result: null,
      error: null,
    })
    await newSubmission

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      id: 'template-1',
      phase: 'generating',
      generations: [{ taskId: 'task-new', role: 'character_template' }],
    })
  })

  it('已归档 Action 的历史节点不能被重做为活动节点', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({ status: 'passed', phase: 'completed', selectedFirstFrameUrl: 'walk.png' }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({ status: 'passed', phase: 'completed' }),
      reviewNode({ status: 'passed', phase: 'completed' }),
    ])
    const { controller } = createController(run)
    await controller.archiveAction('action-walk:action-full-frame')

    await expect(controller.restartFromNode('action-walk')).rejects.toThrow(
      '已归档节点不能重新执行',
    )
  })

  it.each([
    ['角色设定', 'setup-1'],
    ['角色母版', 'template-1'],
  ])('从共享%s节点重做时完整保留已归档 Action 历史', async (_label, nodeId) => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        generations: [{ taskId: 'task-first-frame', role: 'first_frame' }],
        selectedFirstFrameUrl: 'walk.png',
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({
        status: 'passed',
        phase: 'completed',
        generations: [{ taskId: 'task-animation', role: 'complete_animation' }],
      }),
      reviewNode({ status: 'passed', phase: 'completed' }),
    ])
    const { controller } = createController(run)
    await controller.archiveAction('action-walk:action-full-frame')
    const archivedBefore = controller
      .getWorkflow()
      .nodes.filter((node) => node.deletedAt)
      .map((node) => structuredClone(node))

    await controller.restartFromNode(nodeId)

    expect(controller.getWorkflow().nodes.filter((node) => node.deletedAt)).toEqual(archivedBefore)
  })

  it('归档节点即使状态异常变为 active 也不能再次提交生成任务', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'active',
        deletedAt: '2026-08-09T00:00:00.000Z',
      }),
    ])
    const { controller, generation } = createController(run)

    await expect(
      controller.generateFirstFrame('action-walk', {
        spriteWidth: 64,
        spriteHeight: 96,
      }),
    ).rejects.toThrow('已归档节点不能执行')
    expect(generation.apis.create).not.toHaveBeenCalled()
  })

  it('创建或恢复节点可用性时不会激活已归档节点', async () => {
    const workflow = createWorkflowApis(createRun([]))
    const generation = createGenerationHarness()
    const controller = createWorkflowController({
      workflowRunApis: workflow.apis,
      generationApis: generation.apis,
      onAsyncError: vi.fn(),
    })

    await controller.create({
      projectId: '1',
      nodes: [
        ...completedCharacterNodes(),
        firstFrameNode({
          status: 'locked',
          deletedAt: '2026-08-09T00:00:00.000Z',
        }),
      ],
    })

    expect(controller.getWorkflow().nodes[2]).toMatchObject({
      status: 'locked',
      deletedAt: '2026-08-09T00:00:00.000Z',
    })
  })

  it('上游节点完成并解锁下游时跳过已归档节点', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({ status: 'active', phase: 'selecting' }),
      firstFrameNode({
        status: 'locked',
        deletedAt: '2026-08-09T00:00:00.000Z',
      }),
    ])
    const { controller } = createController(run)

    await controller.confirmCharacterTemplate('template-1', 'https://img/knight.png', 'character-1')

    expect(controller.getWorkflow().nodes[2]).toMatchObject({
      status: 'locked',
      deletedAt: '2026-08-09T00:00:00.000Z',
    })
  })

  it('保存失败时不发布未落库的新状态', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({ status: 'active', phase: 'selecting' }),
    ])
    const { controller, workflow } = createController(run)
    vi.mocked(workflow.apis.update).mockRejectedValueOnce(new Error('后端保存失败'))

    await expect(
      controller.confirmCharacterTemplate('template-1', 'https://img/knight.png', 'character-1'),
    ).rejects.toThrow('后端保存失败')

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'selecting',
      selectedImageUrl: null,
    })
  })

  it('PATCH 已落库但响应丢失时接纳回读快照并将命令视为成功', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({ status: 'active', phase: 'selecting' }),
    ])
    const { controller, workflow } = createController(run)
    const update = vi.mocked(workflow.apis.update)
    const get = vi.mocked(workflow.apis.get)
    const persist = update.getMockImplementation()!
    const read = get.getMockImplementation()!
    update.mockImplementationOnce(async (candidate) => {
      await persist(candidate)
      throw new WorkflowRunConflictError('执行记录版本冲突')
    })
    get.mockImplementationOnce(async (id) => {
      const reverseObjectKeys = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(reverseObjectKeys)
        if (value === null || typeof value !== 'object') return value
        return Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([key, item]) => [key, reverseObjectKeys(item)]),
        )
      }
      return reverseObjectKeys(await read(id)) as WorkflowRun
    })

    await controller.confirmCharacterTemplate('template-1', 'https://img/knight.png', 'character-1')

    expect(controller.getWorkflow()).toMatchObject({
      version: 2,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'setup-1',
          input: expect.objectContaining({ characterId: 'character-1' }),
        }),
        expect.objectContaining({ id: 'template-1', status: 'passed' }),
      ]),
    })
  })

  it('生成任务创建成功但引用保存失败时，重试复用同一个任务', async () => {
    const run = createRun([...completedCharacterNodes(), ...actionNodes()])
    const { controller, workflow, generation } = createController(run)
    vi.mocked(workflow.apis.update).mockRejectedValueOnce(new Error('后端保存失败'))

    await expect(
      controller.generateFirstFrame('action-walk', {
        spriteWidth: 64,
        spriteHeight: 96,
      }),
    ).rejects.toThrow('后端保存失败')
    expect(controller.getWorkflow().nodes[2].generations).toEqual([])

    await controller.generateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 96,
    })

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
    expect(controller.getWorkflow().nodes[2]).toMatchObject({
      phase: 'generating',
      generations: [{ taskId: 'task-1', role: 'first_frame' }],
    })
  })

  it('同一节点并发点击只创建一个生成任务', async () => {
    const run = createRun([...completedCharacterNodes(), ...actionNodes()])
    const { controller, generation } = createController(run)
    const options = { spriteWidth: 64, spriteHeight: 96 }

    await Promise.all([
      controller.generateFirstFrame('action-walk', options),
      controller.generateFirstFrame('action-walk', options),
    ])

    expect(generation.apis.create).toHaveBeenCalledTimes(1)
  })

  it('完整动画完成后只解锁自己的审核节点', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'https://img/first.png',
      }),
      generationMethodNode({
        status: 'passed',
        phase: 'completed',
        method: 'video-cropping',
      }),
      fullFrameNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-animation', role: 'complete_animation' }],
      }),
      reviewNode(),
    ])
    const { controller } = createController(run)

    await controller.applyGenerationResult({
      nodeId: 'action-walk:action-full-frame',
      taskId: 'task-animation',
      generation: {
        id: 'task-animation',
        projectId: '1',
        ...completedAnimationEvent('task-animation'),
      },
    })

    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'action-walk:action-full-frame',
          status: 'passed',
          phase: 'completed',
        }),
        expect.objectContaining({
          id: 'action-walk:review',
          status: 'active',
          phase: 'reviewing',
        }),
      ]),
    )

    await controller.approveReview('action-walk:review')
    expect(controller.getWorkflow().nodes[5]).toMatchObject({
      status: 'passed',
      phase: 'completed',
    })
  })

  it('完整动画节点拒绝图片任务结果', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'https://img/first.png',
      }),
      generationMethodNode({
        status: 'passed',
        phase: 'completed',
        method: 'video-cropping',
      }),
      fullFrameNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-animation', role: 'complete_animation' }],
      }),
      reviewNode(),
    ])
    const { controller } = createController(run)

    await controller.applyGenerationResult({
      nodeId: 'action-walk:action-full-frame',
      taskId: 'task-animation',
      generation: {
        id: 'task-animation',
        projectId: '1',
        type: 'first_frame',
        status: 'completed',
        result: {
          type: 'first_frame',
          images: [{ url: 'wrong-1.png' }, { url: 'wrong-2.png' }],
        },
        error: null,
      },
    })

    expect(controller.getWorkflow().nodes[4]).toMatchObject({
      status: 'failed',
      error: '完整动画结果格式无效',
    })
  })

  it('角色母版节点拒绝没有候选的结果', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-template', role: 'character_template' }],
      }),
    ])
    const { controller } = createController(run)

    await controller.applyGenerationResult({
      nodeId: 'template-1',
      taskId: 'task-template',
      generation: {
        id: 'task-template',
        projectId: '1',
        type: 'character_template',
        status: 'completed',
        result: { type: 'character_template', images: [] },
        error: null,
      },
    })

    expect(controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'failed',
      error: '角色候选图结果格式无效',
    })
  })

  it('动作首帧节点拒绝其它类型的生成结果', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        phase: 'generating',
        generations: [{ taskId: 'task-first', role: 'first_frame' }],
      }),
    ])
    const { controller } = createController(run)

    await controller.applyGenerationResult({
      nodeId: 'action-walk',
      taskId: 'task-first',
      generation: {
        id: 'task-first',
        projectId: '1',
        type: 'character_template',
        status: 'completed',
        result: {
          type: 'character_template',
          images: [{ url: 'wrong-1.png' }, { url: 'wrong-2.png' }],
        },
        error: null,
      },
    })

    expect(controller.getWorkflow().nodes[2]).toMatchObject({
      status: 'failed',
      error: '动作首帧结果格式无效',
    })
  })

  it('完整动画节点拒绝没有帧的结果', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({ status: 'passed', phase: 'completed', selectedFirstFrameUrl: 'first.png' }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: 'video-cropping' }),
      fullFrameNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-animation', role: 'complete_animation' }],
      }),
      reviewNode(),
    ])
    const { controller } = createController(run)

    await controller.applyGenerationResult({
      nodeId: 'action-walk:action-full-frame',
      taskId: 'task-animation',
      generation: {
        id: 'task-animation',
        projectId: '1',
        type: 'complete_animation',
        status: 'completed',
        result: {
          type: 'complete_animation',
          frames: [],
        },
        error: null,
      },
    })

    expect(controller.getWorkflow().nodes[4]).toMatchObject({
      status: 'failed',
      error: '完整动画结果没有帧',
    })
  })

  it('一个并行 Action 失败不会阻止另一个 Action 接收生成结果', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        phase: 'generating',
        generations: [{ taskId: 'task-walk', role: 'first_frame' }],
      }),
      firstFrameNode({
        id: 'action-jump',
        phase: 'generating',
        generations: [{ taskId: 'task-jump', role: 'first_frame' }],
        input: actionInput({ name: '跳跃', type: 'jump' }),
      }),
    ])
    const { controller } = createController(run)

    await controller.applyGenerationResult({
      nodeId: 'action-walk',
      taskId: 'task-walk',
      generation: {
        id: 'task-walk',
        projectId: '1',
        type: 'first_frame',
        status: 'failed',
        result: null,
        error: '行走首帧失败',
      },
    })
    await controller.applyGenerationResult({
      nodeId: 'action-jump',
      taskId: 'task-jump',
      generation: {
        id: 'task-jump',
        projectId: '1',
        type: 'first_frame',
        status: 'completed',
        result: {
          type: 'first_frame',
          images: imageCandidates('jump'),
        },
        error: null,
      },
    })

    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'action-walk', status: 'failed' }),
        expect.objectContaining({ id: 'action-jump', status: 'active', phase: 'selecting' }),
      ]),
    )
  })

  it('一个 Action 依次使用独立的首帧、生成方式、完整动画和审核节点', async () => {
    const run = createRun([...completedCharacterNodes(), ...actionNodes()])
    const { controller, generation } = createController(run)

    await controller.generateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 96,
    })
    generation.emit({
      taskId: 'task-1',
      type: 'first_frame',
      status: 'completed',
      result: {
        type: 'first_frame',
        images: [
          { url: 'https://img/first.png' },
          { url: 'https://img/first-2.png' },
          { url: 'https://img/first-3.png' },
        ],
      },
      error: null,
    })
    await flushAsyncWork()
    await controller.confirmFirstFrame('action-walk', 'https://img/first.png')
    await controller.selectActionGenerationMethod(
      'action-walk:action-generation-method',
      'video-cropping',
    )

    await controller.generateCompleteAnimation('action-walk:action-full-frame', {
      characterId: 'character-backend-1',
      referenceMedia: [],
    })
    generation.emit(completedAnimationEvent())
    await flushAsyncWork()
    await controller.approveReview('action-walk:review')

    expect(generation.apis.create).toHaveBeenNthCalledWith(1, {
      type: 'first_frame',
      projectId: '1',
      actionType: 'walk',
      prompt: '行走',
      spriteWidth: 64,
      spriteHeight: 96,
      referenceMedia: ['https://img/knight.png'],
      direction: 'east',
    })
    expect(generation.apis.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'complete_animation',
        firstFrameUrl: 'https://img/first.png',
      }),
    )
    expect(controller.getWorkflow().nodes.slice(2)).toMatchObject([
      {
        type: 'action-first-frame',
        status: 'passed',
        generations: [{ taskId: 'task-1', role: 'first_frame' }],
      },
      {
        type: 'action-generation-method',
        status: 'passed',
        method: 'video-cropping',
      },
      {
        type: 'action-full-frame',
        status: 'passed',
        generations: [{ taskId: 'task-2', role: 'complete_animation' }],
      },
      { type: 'review', status: 'passed' },
    ])
  })

  it('动作首帧重生成使用调用方提供的上一版图片作为参考', async () => {
    const previousImage = 'https://img/first-frame-previous.png'
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: previousImage,
      }),
      generationMethodNode(),
      fullFrameNode(),
      reviewNode(),
    ])
    const { controller, generation } = createController(run)

    await controller.restartFromNode('action-walk')
    await controller.generateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 96,
      sourceImageUrl: previousImage,
    })

    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'first_frame',
      projectId: '1',
      actionType: 'walk',
      prompt: '行走',
      referenceMedia: [previousImage],
      spriteWidth: 64,
      spriteHeight: 96,
      direction: 'east',
    })
  })

  it('动作首帧微调由 Controller 读取上一版图片并组合临时描述', async () => {
    const previousImage = 'https://img/first-frame-previous.png'
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: previousImage,
        input: actionInput({ prompt: '向前行走' }),
      }),
      generationMethodNode(),
      fullFrameNode(),
      reviewNode(),
    ])
    const { controller, generation } = createController(run)

    await controller.regenerateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 96,
      mode: 'refine',
      adjustmentPrompt: '抬高手臂',
    })

    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'first_frame',
      projectId: '1',
      actionType: 'walk',
      prompt: '向前行走\n抬高手臂',
      referenceMedia: [previousImage],
      spriteWidth: 64,
      spriteHeight: 96,
      direction: 'east',
    })
  })

  it('四向角色母版微调分别使用同方向已确认图片', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'east-template.png',
        selectedImages: {
          east: 'east-template.png',
          north: 'north-template.png',
          south: 'south-template.png',
        },
      }),
    ])
    const { controller, generation } = createController(run, 'four-way')

    await controller.regenerateCharacterTemplate('template-1', {
      spriteWidth: 64,
      spriteHeight: 96,
      mode: 'refine',
      adjustmentPrompt: '增加轮廓光',
    })

    expect(
      vi.mocked(generation.apis.create).mock.calls.map(([input]) => ({
        direction: input.direction,
        referenceMedia: input.referenceMedia,
      })),
    ).toEqual([
      { direction: 'east', referenceMedia: ['east-template.png'] },
      { direction: 'north', referenceMedia: ['north-template.png'] },
      { direction: 'south', referenceMedia: ['south-template.png'] },
    ])
  })

  it('四向动作首帧微调分别使用同方向已确认图片', async () => {
    const run = createRun([
      setupNode({ status: 'passed', phase: 'completed' }),
      templateNode({
        status: 'passed',
        phase: 'completed',
        selectedImageUrl: 'east-template.png',
        selectedImages: {
          east: 'east-template.png',
          north: 'north-template.png',
          south: 'south-template.png',
        },
      }),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'east-frame.png',
        selectedFirstFrameUrls: {
          east: 'east-frame.png',
          north: 'north-frame.png',
          south: 'south-frame.png',
        },
      }),
      generationMethodNode(),
      fullFrameNode(),
      reviewNode(),
    ])
    const { controller, generation } = createController(run, 'four-way')

    await controller.regenerateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 96,
      mode: 'refine',
      adjustmentPrompt: '增加轮廓光',
    })

    expect(
      vi.mocked(generation.apis.create).mock.calls.map(([input]) => ({
        direction: input.direction,
        referenceMedia: input.referenceMedia,
      })),
    ).toEqual([
      { direction: 'east', referenceMedia: ['east-frame.png'] },
      { direction: 'north', referenceMedia: ['north-frame.png'] },
      { direction: 'south', referenceMedia: ['south-frame.png'] },
    ])
  })

  it('动作首帧重新生成沿用原始输入且不携带上一版图片', async () => {
    const previousImage = 'https://img/first-frame-previous.png'
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: previousImage,
      }),
      generationMethodNode(),
      fullFrameNode(),
      reviewNode(),
    ])
    const { controller, generation } = createController(run)

    await controller.regenerateFirstFrame('action-walk', {
      spriteWidth: 64,
      spriteHeight: 96,
      mode: 'regenerate',
    })

    expect(generation.apis.create).toHaveBeenCalledWith({
      type: 'first_frame',
      projectId: '1',
      actionType: 'walk',
      prompt: '行走',
      referenceMedia: ['https://img/knight.png'],
      spriteWidth: 64,
      spriteHeight: 96,
      direction: 'east',
    })
  })

  it('动作首帧尚未确认时拒绝重新生成', async () => {
    const run = createRun([...completedCharacterNodes(), ...actionNodes()])
    const { controller, generation } = createController(run)

    await expect(
      controller.regenerateFirstFrame('action-walk', {
        spriteWidth: 64,
        spriteHeight: 96,
        mode: 'regenerate',
      }),
    ).rejects.toThrow('动作首帧当前不能重新生成')
    expect(generation.apis.create).not.toHaveBeenCalled()
  })

  it('动作首帧重新生成提交失败后还原用户已确认的首帧', async () => {
    const previousImage = 'https://img/first-frame-previous.png'
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: previousImage,
      }),
      generationMethodNode(),
      fullFrameNode(),
      reviewNode(),
    ])
    const { controller, generation } = createController(run)
    vi.mocked(generation.apis.create).mockRejectedValueOnce(new Error('生成服务暂时不可用'))

    await expect(
      controller.regenerateFirstFrame('action-walk', {
        spriteWidth: 64,
        spriteHeight: 96,
        mode: 'refine',
        adjustmentPrompt: '抬高手臂',
      }),
    ).rejects.toThrow('生成服务暂时不可用')

    expect(controller.getWorkflow().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'action-walk',
          status: 'passed',
          phase: 'completed',
          selectedFirstFrameUrl: previousImage,
        }),
      ]),
    )
  })

  it('生成动作首帧时使用清理后的自定义提示词', async () => {
    const run = createRun([...completedCharacterNodes(), ...actionNodes()])
    const firstFrame = run.nodes.find((node) => node.type === 'action-first-frame')
    if (!firstFrame || firstFrame.type !== 'action-first-frame') throw new Error('missing frame')
    firstFrame.input.prompt = '  挥手并转身  '
    const { controller, generation } = createController(run)

    await controller.generateFirstFrame(firstFrame.id, { spriteWidth: 64, spriteHeight: 96 })

    expect(generation.apis.create).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '挥手并转身' }),
    )
  })

  it('动作首帧候选图包含空地址时标记节点失败', async () => {
    const run = createRun([...completedCharacterNodes(), ...actionNodes()])
    const firstFrame = run.nodes.find((node) => node.id === 'action-walk')
    if (!firstFrame || firstFrame.type !== 'action-first-frame') throw new Error('missing frame')
    firstFrame.phase = 'generating'
    firstFrame.generations = [{ taskId: 'task-first-frame', role: 'first_frame' }]
    const { controller } = createController(run)

    await controller.applyGenerationResult({
      nodeId: 'action-walk',
      taskId: 'task-first-frame',
      generation: {
        id: 'task-first-frame',
        projectId: '1',
        type: 'first_frame',
        status: 'completed',
        result: {
          type: 'first_frame',
          images: [{ url: 'first.png' }, { url: '' }, { url: 'third.png' }],
        },
        error: null,
      },
    })

    expect(controller.getWorkflow().nodes.find((node) => node.id === 'action-walk')).toMatchObject({
      status: 'failed',
      error: '动作首帧结果格式无效',
    })
  })

  it('恢复时只查询当前生成节点，不重复恢复已经通过的首帧任务', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        generations: [{ taskId: 'task-first-frame', role: 'first_frame' }],
        selectedFirstFrameUrl: 'https://img/first.png',
      }),
      generationMethodNode({
        status: 'passed',
        phase: 'completed',
        method: 'video-cropping',
      }),
      fullFrameNode({
        status: 'active',
        phase: 'generating',
        generations: [{ taskId: 'task-animation', role: 'complete_animation' }],
      }),
      reviewNode(),
    ])
    const { controller, generation } = createController(run)
    generation.snapshots.set('task-first-frame', {
      id: 'task-first-frame',
      projectId: '1',
      type: 'first_frame',
      status: 'completed',
      result: {
        type: 'first_frame',
        images: [{ url: 'https://img/first.png' }, { url: 'https://img/first-2.png' }],
      },
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

    expect(generation.apis.get).toHaveBeenCalledTimes(1)
    expect(generation.apis.get).toHaveBeenCalledWith('1', 'task-animation', {
      type: 'complete_animation',
      actionType: 'walk',
    })
    expect(controller.getWorkflow().nodes[4].phase).toBe('generating')
  })
})

describe('三渲二出帧交给浏览器', () => {
  it('整段动作开始跑之后，问一次这条任务要不要浏览器出帧', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'https://img/first.png',
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: '3d-to-2d' }),
      fullFrameNode({ status: 'active' }),
      reviewNode(),
    ])
    const { controller, bakedTasks } = createController(run)

    await controller.generateCompleteAnimation('action-walk:action-full-frame', {
      characterId: 'character-backend-1',
      referenceMedia: [],
    })
    await flushAsyncWork()

    expect(bakedTasks).toHaveLength(1)
  })

  it('出帧失败交给 onAsyncError，不把这条 Run 卡死', async () => {
    const run = createRun([
      ...completedCharacterNodes(),
      firstFrameNode({
        status: 'passed',
        phase: 'completed',
        selectedFirstFrameUrl: 'https://img/first.png',
      }),
      generationMethodNode({ status: 'passed', phase: 'completed', method: '3d-to-2d' }),
      fullFrameNode({ status: 'active' }),
      reviewNode(),
    ])
    const { controller, asyncErrors } = createController(run, 'single', async () => {
      throw new Error('WebGL 上下文创建失败')
    })

    await controller.generateCompleteAnimation('action-walk:action-full-frame', {
      characterId: 'character-backend-1',
      referenceMedia: [],
    })
    await flushAsyncWork()

    expect(asyncErrors.map((error) => error.message)).toContain('WebGL 上下文创建失败')
  })
})
