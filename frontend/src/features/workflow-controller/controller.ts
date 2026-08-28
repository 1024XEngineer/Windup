import type {
  ActionFirstFrameWorkflowNode,
  ActionFullFrameWorkflowNode,
  ActionGenerationMethod,
  ActionGenerationMethodWorkflowNode,
  ActionDirection,
  CharacterTemplateGenerationInput,
  CharacterViewSheetCell,
  CharacterViewSheetGenerationInput,
  CharacterSetupWorkflowNode,
  CharacterTemplateWorkflowNode,
  CompleteAnimationGenerationInput,
  CreateWorkflowRunInput,
  FirstFrameGenerationInput,
  Generation,
  GenerationApis,
  GenerationEvent,
  WorkflowGenerationExpectation,
  GeneratedImage,
  ImageCandidateCount,
  MediaReference,
  Project,
  ProjectApis,
  ReviewWorkflowNode,
  WorkflowActionInput,
  WorkflowCharacterInput,
  WorkflowGenerationRef,
  WorkflowGenerationRole,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunApis,
  DirectionalMovement,
} from '@/entities'
import {
  type ArtStyle,
  getDirectionProfile,
  isImageCandidateCount,
  WorkflowRunConflictError,
} from '@/entities'

export interface AddActionInput {
  /** 首帧节点 ID；完整动画和审核节点在此 ID 后追加稳定后缀。 */
  nodeId?: WorkflowNode['id']
  /** 默认依赖当前图中已确认的角色母版节点。 */
  dependsOnNodeIds?: readonly WorkflowNode['id'][]
  input: WorkflowActionInput
}

export interface GenerateCharacterTemplateOptions {
  spriteWidth: number
  spriteHeight: number
  /** 重生成时用上一版图片约束本次结果；不覆盖角色设定中的原始参考素材。 */
  sourceImageUrl?: GeneratedImage['url']
  /** 调用方显式补方向时，为该方向提供上一版已确认图片。 */
  sourceImageUrls?: Partial<Record<ActionDirection, GeneratedImage['url']>>
  /** 只影响本次请求的 prompt 覆盖值；不改写角色设定节点的原始输入。 */
  prompt?: string
  /** 手动编辑器提交时覆盖 configuring 节点的初始输入；节点通过后不再改写。 */
  input?: WorkflowCharacterInput
  /** 只提交本阶段需要的方向；缺省使用项目身份锚（单向 east，多向 south）。 */
  directions?: readonly ActionDirection[]
  /** 本阶段每个方向的候选数；母版三选一，派生方向通常每向一张。 */
  candidateCount?: ImageCandidateCount
}

export interface GenerateActionOptions {
  characterId: string
  /** 由上传/媒体边界提供，Controller 不把展示 URL 冒充 MediaReference。 */
  referenceMedia: readonly MediaReference[]
  /** 完整动画自己的动作过程描述，不读取动作首帧描述。 */
  prompt?: string
}

export interface GenerateCharacterViewSheetOptions {
  characterId: string
  prompt: string
  negativePrompt?: string
  spriteWidth: number
  spriteHeight: number
  candidateCount?: ImageCandidateCount
}

export interface GenerateFirstFrameOptions {
  spriteWidth: number
  spriteHeight: number
  /** 重生成时用上一版首帧约束本次结果；不改写已确认的角色母版。 */
  sourceImageUrl?: GeneratedImage['url']
  /** 多方向微调时，每个源方向必须使用自己上一版的已确认首帧。 */
  sourceImageUrls?: Partial<Record<ActionDirection, GeneratedImage['url']>>
  /** 只影响本次请求的 prompt 覆盖值；不改写动作节点的原始输入。 */
  prompt?: string
  /** 多方向重生成时分别覆盖各真实源方向，避免退回共享动作描述。 */
  directionPrompts?: Partial<Record<ActionDirection, string>>
  /** 本阶段每个方向的候选数；自动交付固定为一张。 */
  candidateCount?: ImageCandidateCount
}

export type RegenerationMode = 'regenerate' | 'refine'

export interface RegenerateImageOptions {
  spriteWidth: number
  spriteHeight: number
  mode: RegenerationMode
  /** 微调时追加到原始描述的临时说明；重新生成模式下不得提交。 */
  adjustmentPrompt?: string
  /** 候选态微调时由宿主句柄解析出的参考图；Controller 不接触候选序号。 */
  sourceImageUrl?: GeneratedImage['url']
}

export interface RetryGenerationDirectionOptions {
  spriteWidth: number
  spriteHeight: number
  /** 完整动画重试时沿用调用入口持有的额外参考媒体；图片任务忽略此字段。 */
  referenceMedia?: readonly MediaReference[]
}

export interface ApplyGenerationResultInput {
  nodeId: WorkflowNode['id']
  taskId: Generation['id']
  generation: Generation
}

export interface PrepareQuickStartProjectOptions {
  gameStyle?: ArtStyle
  autoPixelate?: boolean
  /** 传入时复用已有项目；缺省时保持 Quick Start 自动建项目。 */
  projectId?: Project['id']
}

export type PrepareQuickStartProject = (
  prompt: string,
  directionalMovement?: DirectionalMovement,
  options?: PrepareQuickStartProjectOptions,
) => Promise<Pick<Project, 'id' | 'spriteSize'> & Partial<Pick<Project, 'directionalMovement'>>>

export interface StartCharacterGenerationInput {
  prompt: string
  /** 用户在 Agent 对话中上传的原始图片；与优化后的文字共同约束角色母版。 */
  referenceMedia?: readonly MediaReference[]
  directionalMovement?: DirectionalMovement
  gameStyle?: ArtStyle
  autoPixelate?: boolean
  projectId?: Project['id']
  automaticDelivery?: {
    actionPrompt?: string
    actionType?: 'idle' | 'walk' | 'attack' | 'jump'
    locomotion?: true
  }
  /** 仅记录 Agent 的像素素材意图，生成阶段不据此改变原图。 */
  suggestPixelPerfect?: boolean
}

export interface StartCharacterGenerationResult {
  runId: WorkflowRun['id']
}

export interface CreateWorkflowControllerOptions {
  /** 已从 WorkflowRunApis.get 取回的运行记录；不传时只能先调用 create。 */
  workflow?: WorkflowRun
  workflowRunApis: WorkflowRunApis
  generationApis: GenerationApis
  createId?: () => string
  now?: () => string
  /** 只有纯文本入口需要；调用时机仍由 Controller 的生成命令持有。 */
  prepareProject?: PrepareQuickStartProject
  /** SSE 回调无法 await，异步保存错误通过此处交给装配层展示或记录。 */
  onAsyncError: (error: Error) => void
  /** 项目方向模式；缺省按旧单向 WorkflowRun 兼容。 */
  directionalMovement?: DirectionalMovement
  /**
   * 三渲二出帧在浏览器里跑（#714）。缺省用真实实现；测试注入替身，避免在 jsdom 里
   * 起 WebGL。返回 false 表示这条任务不需要浏览器出帧（走 i2v 或已收口）。
   */
  runClientBake?: (taskId: Generation['id']) => Promise<boolean>
}

/**
 * 一个 Controller 只维护一条 WorkflowRun。
 *
 * Quick Start 与 Workflow Editor 调用同一组业务方法，区别只在于前者自动选择并连续
 * 调用、后者等待用户逐步点击。Controller 不识别入口，也不保存第二份流程模型。
 */
export interface WorkflowController {
  create(input: CreateWorkflowRunInput): Promise<void>
  /** 从纯文本入口创建一条 Run 并提交角色母版生成；提交后不参与后续流程。 */
  startCharacterGeneration(
    input: StartCharacterGenerationInput,
  ): Promise<StartCharacterGenerationResult>
  /** 页面首次读取当前快照；后续变化统一通过 subscribe 接收。 */
  getWorkflow(): WorkflowRun
  subscribe(listener: (workflow: WorkflowRun) => void): () => void

  setCharacterName(nodeId: CharacterSetupWorkflowNode['id'], name: string | null): Promise<void>
  addAction(input: AddActionInput): Promise<void>
  generateCharacterTemplate(
    nodeId: CharacterSetupWorkflowNode['id'],
    options: GenerateCharacterTemplateOptions,
  ): Promise<void>
  regenerateCharacterTemplate(
    nodeId: CharacterTemplateWorkflowNode['id'],
    options: RegenerateImageOptions,
  ): Promise<void>
  /** 仅在入口节点尚未提交时修改角色描述和参考媒体。 */
  updateCharacterSetup(
    nodeId: CharacterSetupWorkflowNode['id'],
    input: Pick<WorkflowCharacterInput, 'prompt' | 'referenceMedia'>,
  ): Promise<void>
  /** 使用用户上传的角色母版，显式跳过角色候选图生成。 */
  acceptUploadedCharacterTemplate(
    nodeId: CharacterSetupWorkflowNode['id'],
    selectedImageUrl: string,
    characterId: string,
    direction?: ActionDirection,
  ): Promise<void>
  confirmCharacterTemplate(
    nodeId: CharacterTemplateWorkflowNode['id'],
    selectedImageUrl: string,
    characterId: string,
    direction?: ActionDirection,
  ): Promise<void>
  generateCharacterViewSheet(
    nodeId: CharacterTemplateWorkflowNode['id'],
    options: GenerateCharacterViewSheetOptions,
  ): Promise<void>
  confirmCharacterViewSheet(
    nodeId: CharacterTemplateWorkflowNode['id'],
    cells: readonly CharacterViewSheetCell[],
  ): Promise<void>
  generateFirstFrame(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    options: GenerateFirstFrameOptions,
  ): Promise<void>
  /** 在生成前保存各真实源方向的首帧描述；镜像方向没有独立提示词。 */
  updateFirstFrameDirectionPrompts(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    prompts: Partial<Record<ActionDirection, string>>,
  ): Promise<void>
  regenerateFirstFrame(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    options: RegenerateImageOptions,
  ): Promise<void>
  confirmFirstFrame(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    selectedFirstFrameUrl: string,
    direction?: ActionDirection,
  ): Promise<void>
  selectActionGenerationMethod(
    nodeId: ActionGenerationMethodWorkflowNode['id'],
    method: ActionGenerationMethod,
  ): Promise<void>
  generateCompleteAnimation(
    nodeId: ActionFullFrameWorkflowNode['id'],
    options: GenerateActionOptions,
  ): Promise<void>
  approveReview(nodeId: ReviewWorkflowNode['id']): Promise<void>
  /** 已发布 Action 删除后，保留其四节点历史并标记为已删除。 */
  archiveAction(nodeId: ActionFullFrameWorkflowNode['id']): Promise<void>

  /** 刷新恢复时查询已记录的 Generation，再恢复 SSE。 */
  resume(): Promise<void>
  /** 停止本实例的自动处理；后端没有 cancel，所以不会伪装成取消了服务端任务。 */
  interrupt(): Promise<void>
  restartFromNode(nodeId: WorkflowNode['id']): Promise<void>
  applyGenerationResult(input: ApplyGenerationResultInput): Promise<void>
  getGeneration(
    nodeId: WorkflowNode['id'],
    role: WorkflowGenerationRole,
  ): Promise<Generation | null>
  /** 读取同一节点下各真实源方向的任务结果。 */
  getGenerations(nodeId: WorkflowNode['id'], role: WorkflowGenerationRole): Promise<Generation[]>
  /** 只替换一个失败或待选源方向的任务，保留同节点其它方向的引用与结果。 */
  retryGenerationDirection(
    nodeId: WorkflowNode['id'],
    direction: ActionDirection,
    options: RetryGenerationDirectionOptions,
  ): Promise<void>
  dispose(): void
}

interface ActiveSubscription {
  nodeId: WorkflowNode['id']
  taskId: Generation['id']
  stop: () => void
}

interface PendingGenerationAttachment {
  nodeId: WorkflowNode['id']
  role: WorkflowGenerationRole
  direction: ActionDirection
  expectedEpoch: number
  regeneration: boolean
  generation: Generation
}

export function createAutoPrepareProject(
  projectApis: Pick<ProjectApis, 'create' | 'get' | 'setAutoPixelate'>,
): PrepareQuickStartProject {
  return async (prompt, directionalMovement = 'single', options) => {
    if (options?.projectId) {
      let project = await projectApis.get(options.projectId)
      if (
        options.autoPixelate !== undefined &&
        (project.autoPixelate ?? true) !== options.autoPixelate
      ) {
        project = await projectApis.setAutoPixelate(project.id, options.autoPixelate)
      }
      return {
        id: project.id,
        spriteSize: project.spriteSize,
        directionalMovement: project.directionalMovement,
      }
    }
    const project = await projectApis.create({
      nameContext: prompt.trim().replace(/\s+/gu, ' '),
      perspective: 'side',
      directionalMovement,
      spriteSize: { width: 256, height: 256 },
      gameStyle: options?.gameStyle,
      autoPixelate: options?.autoPixelate,
    })
    return {
      id: project.id,
      spriteSize: project.spriteSize,
      directionalMovement: project.directionalMovement,
    }
  }
}

/**
 * 三渲二出帧的默认实现。**动态 import** —— three.js 只有这条路线用得着,静态引进来
 * 会让每个进首页的用户都先下一份它。
 */
async function defaultRunClientBake(taskId: Generation['id']): Promise<boolean> {
  const { attachClientBake } = await import('@/features/client-bake/attach')
  return attachClientBake(Number(taskId))
}

export function createWorkflowController({
  workflow,
  workflowRunApis,
  generationApis,
  createId = createBrowserSafeId,
  now = () => new Date().toISOString(),
  prepareProject,
  onAsyncError,
  directionalMovement = 'single',
  runClientBake = defaultRunClientBake,
}: CreateWorkflowControllerOptions): WorkflowController {
  let current = workflow ? structuredClone(workflow) : null
  let interrupted = false
  let saveQueue: Promise<void> = Promise.resolve()
  const characterCommands = new Map<WorkflowNode['id'], Promise<WorkflowRun>>()
  const submissions = new Map<string, Promise<WorkflowRun>>()
  const subscriptions = new Map<string, ActiveSubscription>()
  const nodeEpochs = new Map<WorkflowNode['id'], number>()
  const unattachedGenerations = new Map<string, PendingGenerationAttachment>()
  const regenerationKeys = new Set<string>()
  const settlements = new Map<string, Promise<WorkflowRun>>()
  const listeners = new Set<(workflow: WorkflowRun) => void>()
  let currentDirectionalMovement = directionalMovement
  let generationDirections = getDirectionProfile(directionalMovement).sourceDirections

  function selectedDirectionUrl(
    values: Partial<Record<ActionDirection, string>> | undefined,
    legacyEastUrl: string | null | undefined,
    direction: ActionDirection,
  ) {
    return values?.[direction] ?? (direction === 'east' ? legacyEastUrl : undefined)
  }

  function requireWorkflow(): WorkflowRun {
    if (!current) throw new Error('WorkflowController 尚未绑定 WorkflowRun')
    return current
  }

  function snapshot(): WorkflowRun {
    return structuredClone(requireWorkflow())
  }

  function notifyListeners() {
    for (const listener of listeners) {
      try {
        listener(snapshot())
      } catch (cause) {
        onAsyncError(asError(cause))
      }
    }
  }

  function subscribe(listener: (workflow: WorkflowRun) => void) {
    listeners.add(listener)
    listener(snapshot())
    return () => listeners.delete(listener)
  }

  function ensureRunning() {
    if (interrupted) throw new Error('WorkflowController 已中断，请先调用 resume')
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = saveQueue.then(operation)
    saveQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function persist(transform: (run: WorkflowRun) => WorkflowRun): Promise<WorkflowRun> {
    return enqueue(async () => {
      const before = requireWorkflow()
      const candidate = transform(before)
      if (candidate === before) return structuredClone(before)

      // 只有更新响应或回读结果确认已落库后才替换内存快照，避免页面显示“假成功”。
      let saved: WorkflowRun
      try {
        saved = await workflowRunApis.update(candidate)
      } catch (cause) {
        try {
          const latest = await workflowRunApis.get(candidate.id)
          if (!hasSamePersistedState(candidate, latest)) throw cause
          saved = latest
        } catch {
          throw cause
        }
      }
      current = structuredClone(saved)
      notifyListeners()
      return structuredClone(saved)
    })
  }

  function create(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
    return enqueue(async () => {
      if (current) throw new Error('WorkflowController 已经绑定一条 WorkflowRun')
      const created = await workflowRunApis.create({
        ...input,
        nodes: normalizeAvailability(input.nodes),
      })
      current = structuredClone(created)
      notifyListeners()
      return structuredClone(created)
    })
  }

  function getWorkflow() {
    return snapshot()
  }

  async function startCharacterGeneration({
    prompt,
    referenceMedia = [],
    directionalMovement: selectedDirectionalMovement = 'single',
    gameStyle,
    autoPixelate,
    projectId,
    automaticDelivery,
    suggestPixelPerfect = false,
  }: StartCharacterGenerationInput): Promise<StartCharacterGenerationResult> {
    ensureRunning()
    if (!prepareProject) {
      throw new Error('WorkflowController 未配置 Quick Start 项目准备能力')
    }
    const normalizedPrompt = nonEmpty(prompt, '角色描述')
    const actionPrompt = automaticDelivery?.actionPrompt?.trim() || null
    const actionType = actionPrompt ? automaticDelivery?.actionType : undefined
    const locomotion = actionPrompt ? automaticDelivery?.locomotion : undefined
    const project = await prepareProject(normalizedPrompt, selectedDirectionalMovement, {
      gameStyle,
      ...(autoPixelate === undefined ? {} : { autoPixelate }),
      projectId,
    })
    generationDirections = getDirectionProfile(
      project.directionalMovement ?? selectedDirectionalMovement,
    ).sourceDirections
    currentDirectionalMovement = project.directionalMovement ?? selectedDirectionalMovement
    await create({
      projectId: project.id,
      nodes: [
        {
          id: 'character-setup',
          type: 'character-setup',
          status: 'active',
          phase: 'configuring',
          dependsOnNodeIds: [],
          generations: [],
          error: null,
          input: { prompt: normalizedPrompt, referenceMedia: [...referenceMedia] },
          ...(suggestPixelPerfect || autoPixelate === false ? { pixelPerfectSuggested: true } : {}),
          ...(automaticDelivery
            ? {
                automation: {
                  mode: 'automatic' as const,
                  actionPrompt,
                  ...(actionType ? { actionType } : {}),
                  ...(locomotion ? { locomotion } : {}),
                },
              }
            : {}),
        },
        {
          id: 'character-template',
          type: 'character-template',
          status: 'locked',
          phase: 'ready',
          dependsOnNodeIds: ['character-setup'],
          generations: [],
          error: null,
          selectedImageUrl: null,
        },
      ],
    })
    await generateCharacterTemplate('character-setup', {
      spriteWidth: project.spriteSize.width,
      spriteHeight: project.spriteSize.height,
      directions: [currentDirectionalMovement === 'single' ? 'east' : 'south'],
      ...(automaticDelivery ? { candidateCount: 1 as const } : {}),
    })
    return { runId: requireWorkflow().id }
  }

  function setCharacterName(
    nodeId: CharacterSetupWorkflowNode['id'],
    name: string | null,
  ): Promise<WorkflowRun> {
    ensureRunning()
    const normalizedName = name?.trim() || null
    if (normalizedName && normalizedName.length > 20) {
      throw new Error('角色名称不能超过 20 个字符')
    }
    return persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'character-setup') throw new Error('目标节点不是角色设定')
        if (node.input.name === normalizedName) return run
        return replaceNode(run, {
          ...node,
          input: { ...node.input, name: normalizedName },
        })
      }),
    )
  }

  function addAction({ nodeId = createId(), dependsOnNodeIds, input }: AddActionInput) {
    ensureRunning()
    return persist((run) => {
      const methodId = `${nodeId}:action-generation-method`
      const fullFrameId = `${nodeId}:action-full-frame`
      const reviewId = `${nodeId}:review`
      const newIds = [nodeId, methodId, fullFrameId, reviewId]
      const duplicateId = newIds.find((id) => run.nodes.some((node) => node.id === id))
      if (duplicateId) throw new Error(`WorkflowNode 已存在：${duplicateId}`)
      const dependencies = dependsOnNodeIds
        ? [...dependsOnNodeIds]
        : run.nodes.filter((node) => node.type === 'character-template').map((node) => node.id)
      if (dependencies.length === 0) throw new Error('新增 Action 前必须存在角色母版节点')
      assertDependenciesExist(run.nodes, dependencies)
      if (
        dependencies.length !== 1 ||
        findNode(run, dependencies[0]!).type !== 'character-template'
      ) {
        throw new Error('Action 首帧必须且只能依赖一个角色母版节点')
      }
      const firstFrameNode: ActionFirstFrameWorkflowNode = {
        id: nodeId,
        type: 'action-first-frame',
        status: dependencies.every((id) => isPassed(run.nodes, id)) ? 'active' : 'locked',
        phase: 'configuring',
        dependsOnNodeIds: dependencies,
        generations: [],
        error: null,
        input: structuredClone(input),
        selectedFirstFrameUrl: null,
      }
      const fullFrameNode: ActionFullFrameWorkflowNode = {
        id: fullFrameId,
        type: 'action-full-frame',
        status: 'locked',
        phase: 'ready',
        dependsOnNodeIds: [methodId],
        generations: [],
        error: null,
        input: { prompt: null },
      }
      const methodNode: ActionGenerationMethodWorkflowNode = {
        id: methodId,
        type: 'action-generation-method',
        status: 'locked',
        phase: 'selecting',
        dependsOnNodeIds: [firstFrameNode.id],
        generations: [],
        error: null,
        method: null,
      }
      const reviewNode: ReviewWorkflowNode = {
        id: reviewId,
        type: 'review',
        status: 'locked',
        phase: 'reviewing',
        dependsOnNodeIds: [fullFrameNode.id],
        generations: [],
        error: null,
      }
      return {
        ...run,
        nodes: [...run.nodes, firstFrameNode, methodNode, fullFrameNode, reviewNode],
      }
    })
  }

  function generateCharacterTemplate(
    nodeId: CharacterSetupWorkflowNode['id'],
    options: GenerateCharacterTemplateOptions,
  ): Promise<WorkflowRun> {
    ensurePositiveInteger(options.spriteWidth, 'spriteWidth')
    ensurePositiveInteger(options.spriteHeight, 'spriteHeight')
    ensureRunning()
    const active = characterCommands.get(nodeId)
    if (active) return active

    const command = performCharacterGeneration(nodeId, options).finally(() => {
      if (characterCommands.get(nodeId) === command) characterCommands.delete(nodeId)
    })
    characterCommands.set(nodeId, command)
    return command
  }

  async function performCharacterGeneration(
    nodeId: CharacterSetupWorkflowNode['id'],
    options: GenerateCharacterTemplateOptions,
  ): Promise<WorkflowRun> {
    const before = requireWorkflow()
    const setupBefore = findNode(before, nodeId)
    if (setupBefore.type !== 'character-setup') throw new Error('目标节点不是角色设定')

    const advanced =
      setupBefore.status === 'passed' && setupBefore.phase === 'completed'
        ? before
        : await persist((run) => {
            const setupNode = findNode(run, nodeId)
            if (setupNode.type !== 'character-setup') throw new Error('目标节点不是角色设定')
            if (setupNode.status !== 'active' || setupNode.phase !== 'configuring') {
              throw new Error('角色设定节点当前不能提交')
            }
            const input = options.input
              ? {
                  prompt: nonEmpty(options.input.prompt, '角色描述'),
                  referenceMedia: [...options.input.referenceMedia],
                }
              : setupNode.input
            return unlockReadyNodes(
              replaceNode(run, {
                ...setupNode,
                input,
                status: 'passed',
                phase: 'completed',
                error: null,
              }),
            )
          })
    const templateNode = findSingleDependentNode(advanced, nodeId, 'character-template')
    const requestedDirections = options.directions ?? [
      currentDirectionalMovement === 'single' ? 'east' : 'south',
    ]
    for (const direction of requestedDirections) {
      assertGenerationDirection(direction, generationDirections)
    }
    const missingDirections = requestedDirections.filter(
      (direction) =>
        !selectedDirectionUrl(
          templateNode.selectedImages,
          templateNode.selectedImageUrl,
          direction,
        ),
    )
    return submitDirectionalGenerations(
      templateNode.id,
      'character_template',
      (run, node, direction) => {
        if (node.type !== 'character-template') throw new Error('目标节点不是角色母版')
        const hasSelectedDirection = generationDirections.some((generationDirection) =>
          Boolean(
            selectedDirectionUrl(node.selectedImages, node.selectedImageUrl, generationDirection),
          ),
        )
        if (
          node.phase !== 'ready' &&
          node.phase !== 'generating' &&
          !(node.phase === 'selecting' && hasSelectedDirection)
        ) {
          throw new Error('角色母版节点当前不能开始生成')
        }
        const setupNode = findSingleDependencyNode(run, node, 'character-setup')
        const sourceImage = generatedImageReference(
          options.sourceImageUrls?.[direction] ?? options.sourceImageUrl,
        )
        const input: CharacterTemplateGenerationInput = {
          type: 'character_template',
          projectId: run.projectId,
          prompt:
            options.prompt === undefined
              ? setupNode.input.prompt
              : nonEmpty(options.prompt, 'prompt'),
          referenceMedia: sourceImage ? [sourceImage] : setupNode.input.referenceMedia,
          spriteWidth: options.spriteWidth,
          spriteHeight: options.spriteHeight,
          direction,
          ...(options.candidateCount === undefined
            ? {}
            : { candidateCount: options.candidateCount }),
        }
        return input
      },
      missingDirections,
    )
  }

  function confirmCharacterTemplate(
    nodeId: CharacterTemplateWorkflowNode['id'],
    selectedImageUrl: string,
    characterId: string,
    direction: ActionDirection = 'east',
  ) {
    ensureRunning()
    const imageUrl = nonEmpty(selectedImageUrl, 'selectedImageUrl')
    const normalizedCharacterId = nonEmpty(characterId, 'characterId')
    assertGenerationDirection(direction, generationDirections)
    return persist((run) => {
      const templateNode = findNode(run, nodeId)
      if (templateNode.type !== 'character-template') throw new Error('目标节点不是角色母版')
      if (templateNode.status !== 'active' || templateNode.phase !== 'selecting') {
        throw new Error('角色母版节点当前不能确认候选图')
      }
      const setupNode = findSingleDependencyNode(run, templateNode, 'character-setup')
      if (setupNode.input.characterId && setupNode.input.characterId !== normalizedCharacterId) {
        throw new Error('WorkflowRun 已绑定到另一角色，不能改绑')
      }
      return unlockReadyNodes({
        ...run,
        nodes: run.nodes.map((node) => {
          if (node.id === setupNode.id) {
            return {
              ...setupNode,
              input: { ...setupNode.input, characterId: normalizedCharacterId },
            }
          }
          if (node.id === templateNode.id) {
            const selectedImages = {
              ...(templateNode.selectedImages ?? {}),
              [direction]: imageUrl,
            }
            const complete = generationDirections.every((generationDirection) => {
              return Boolean(selectedImages[generationDirection])
            })
            return {
              ...templateNode,
              selectedImageUrl:
                direction === 'east' ||
                (direction === 'south' &&
                  currentDirectionalMovement !== 'single' &&
                  !templateNode.selectedImageUrl)
                  ? imageUrl
                  : (templateNode.selectedImageUrl ?? selectedImages.east ?? null),
              selectedImages,
              phase: complete ? 'completed' : 'selecting',
              status: complete ? 'passed' : 'active',
            }
          }
          return node
        }),
      })
    })
  }

  function generateCharacterViewSheet(
    nodeId: CharacterTemplateWorkflowNode['id'],
    options: GenerateCharacterViewSheetOptions,
  ) {
    ensureRunning()
    if (currentDirectionalMovement === 'single') {
      return Promise.reject(new Error('单向项目不需要生成方向 sheet'))
    }
    ensurePositiveInteger(options.spriteWidth, 'spriteWidth')
    ensurePositiveInteger(options.spriteHeight, 'spriteHeight')
    const candidateCount = options.candidateCount ?? 1
    const role =
      currentDirectionalMovement === 'four-way'
        ? ('character_four_view' as const)
        : ('character_eight_view' as const)
    return submitGeneration(nodeId, role, (run, node) => {
      if (node.type !== 'character-template') throw new Error('目标节点不是角色母版')
      if (node.phase !== 'selecting' || !node.selectedImageUrl) {
        throw new Error('必须先确认南向正视母版')
      }
      const setupNode = findSingleDependencyNode(run, node, 'character-setup')
      const characterId = nonEmpty(options.characterId, 'characterId')
      if (setupNode.input.characterId !== characterId) {
        throw new Error('方向 sheet 与 WorkflowRun 绑定的角色不一致')
      }
      const input: CharacterViewSheetGenerationInput = {
        type:
          currentDirectionalMovement === 'four-way'
            ? 'character_four_view'
            : 'character_eight_view',
        projectId: run.projectId,
        characterId,
        prompt: options.prompt,
        ...(options.negativePrompt === undefined ? {} : { negativePrompt: options.negativePrompt }),
        referenceMedia: [],
        spriteWidth: options.spriteWidth,
        spriteHeight: options.spriteHeight,
        candidateCount,
      }
      return input
    })
  }

  function confirmCharacterViewSheet(
    nodeId: CharacterTemplateWorkflowNode['id'],
    cells: readonly CharacterViewSheetCell[],
  ) {
    ensureRunning()
    if (currentDirectionalMovement === 'single') {
      return Promise.reject(new Error('单向项目不能确认方向 sheet'))
    }
    const expectedDirections = getDirectionProfile(currentDirectionalMovement).logicalDirections
    const byDirection = new Map(cells.map((cell) => [cell.direction, cell]))
    if (
      cells.length !== expectedDirections.length ||
      expectedDirections.some((direction) => !byDirection.has(direction))
    ) {
      return Promise.reject(new Error('方向 sheet 的格子集合与项目方向模式不一致'))
    }
    const south = byDirection.get('south')
    if (!south || south.mirrorX || south.sourceDirection !== null) {
      return Promise.reject(new Error('方向 sheet 缺少真实南向正视母版'))
    }
    const mirrorSources: Partial<Record<ActionDirection, ActionDirection>> = {
      west: 'east',
      ...(currentDirectionalMovement === 'eight-way'
        ? { north_west: 'north_east' as const, south_west: 'south_east' as const }
        : {}),
    }
    if (
      expectedDirections.some((direction) => {
        const cell = byDirection.get(direction)!
        const expectedSourceDirection = mirrorSources[direction] ?? null
        return (
          cell.sourceDirection !== expectedSourceDirection ||
          cell.mirrorX !== (expectedSourceDirection !== null)
        )
      })
    ) {
      return Promise.reject(new Error('方向 sheet 的镜像关系与项目方向模式不一致'))
    }
    const selectedImages = Object.fromEntries(
      expectedDirections.map((direction) => [direction, byDirection.get(direction)!.imageUrl]),
    ) as Partial<Record<ActionDirection, string>>
    return persist((run) => {
      const node = findNode(run, nodeId)
      if (node.type !== 'character-template') throw new Error('目标节点不是角色母版')
      if (node.status !== 'active' || node.phase !== 'selecting' || !node.selectedImageUrl) {
        throw new Error('角色母版节点当前不能确认方向 sheet')
      }
      if (selectedImages.south !== node.selectedImageUrl) {
        throw new Error('方向 sheet 的南向格与已确认母版不一致')
      }
      return unlockReadyNodes(
        replaceNode(run, {
          ...node,
          selectedImages,
          status: 'passed',
          phase: 'completed',
          error: null,
        }),
      )
    })
  }

  function updateCharacterSetup(
    nodeId: CharacterSetupWorkflowNode['id'],
    input: Pick<WorkflowCharacterInput, 'prompt' | 'referenceMedia'>,
  ) {
    ensureRunning()
    const prompt = nonEmpty(input.prompt, 'prompt')
    return persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'character-setup') throw new Error('目标节点不是角色设定')
        if (node.status !== 'active' || node.phase !== 'configuring') {
          throw new Error('角色设定节点当前不能修改')
        }
        return replaceNode(run, {
          ...node,
          input: {
            ...node.input,
            prompt,
            referenceMedia: [...input.referenceMedia],
          },
        })
      }),
    )
  }

  function acceptUploadedCharacterTemplate(
    nodeId: CharacterSetupWorkflowNode['id'],
    selectedImageUrl: string,
    characterId: string,
    direction: ActionDirection = 'east',
  ) {
    ensureRunning()
    const imageUrl = nonEmpty(selectedImageUrl, 'selectedImageUrl')
    const normalizedCharacterId = nonEmpty(characterId, 'characterId')
    assertGenerationDirection(direction, generationDirections)
    return persist((run) => {
      const setupNode = findNode(run, nodeId)
      if (setupNode.type !== 'character-setup') throw new Error('目标节点不是角色设定')
      const templateNode = findSingleDependentNode(run, setupNode.id, 'character-template')
      const isFirstUpload =
        setupNode.status === 'active' &&
        setupNode.phase === 'configuring' &&
        templateNode.status === 'locked' &&
        templateNode.phase === 'ready'
      const isAdditionalDirection =
        setupNode.status === 'passed' &&
        setupNode.phase === 'completed' &&
        templateNode.status === 'active' &&
        templateNode.phase === 'selecting'
      if (!isFirstUpload && !isAdditionalDirection) {
        throw new Error('角色设定节点当前不能使用上传母版')
      }
      if (setupNode.input.characterId && setupNode.input.characterId !== normalizedCharacterId) {
        throw new Error('WorkflowRun 已绑定到另一角色，不能改绑')
      }
      return unlockReadyNodes({
        ...run,
        nodes: run.nodes.map((node) => {
          if (node.id === setupNode.id) {
            return {
              ...setupNode,
              status: 'passed',
              phase: 'completed',
              error: null,
              input: { ...setupNode.input, characterId: normalizedCharacterId },
            }
          }
          if (node.id === templateNode.id) {
            const selectedImages = {
              ...(templateNode.selectedImages ?? {}),
              [direction]: imageUrl,
            }
            const complete = generationDirections.every((generationDirection) => {
              return Boolean(selectedImages[generationDirection])
            })
            return {
              ...templateNode,
              selectedImageUrl:
                direction === 'east' ||
                (direction === 'south' &&
                  currentDirectionalMovement !== 'single' &&
                  !templateNode.selectedImageUrl)
                  ? imageUrl
                  : (templateNode.selectedImageUrl ?? selectedImages.east ?? null),
              selectedImages,
              status: complete ? 'passed' : 'active',
              phase: complete ? 'completed' : 'selecting',
            }
          }
          return node
        }),
      })
    })
  }

  function generateFirstFrame(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    options: GenerateFirstFrameOptions,
  ) {
    const before = requireWorkflow()
    const targetNode = findNode(before, nodeId)
    if (targetNode.type !== 'action-first-frame') throw new Error('目标节点不是动作首帧')
    const targetTemplate = findSingleDependencyNode(before, targetNode, 'character-template')
    for (const direction of generationDirections) {
      if (
        !selectedDirectionUrl(
          targetTemplate.selectedImages,
          targetTemplate.selectedImageUrl,
          direction,
        )
      ) {
        throw new Error(`角色母版尚未确认方向 ${direction}`)
      }
    }
    const lockCharacterId =
      currentDirectionalMovement === 'single'
        ? undefined
        : nonEmpty(
            findSingleDependencyNode(before, targetTemplate, 'character-setup').input.characterId ??
              '',
            'characterId',
          )
    return submitDirectionalGenerations(
      nodeId,
      'first_frame',
      (run, node, direction) => {
        if (node.type !== 'action-first-frame') throw new Error('目标节点不是动作首帧')
        if (node.phase !== 'configuring') throw new Error('动作首帧节点当前不能生成')
        const templateNode = findSingleDependencyNode(run, node, 'character-template')
        const characterTemplateReference = selectedDirectionUrl(
          templateNode.selectedImages,
          templateNode.selectedImageUrl,
          direction,
        )
        if (!characterTemplateReference) throw new Error(`角色母版尚未确认方向 ${direction}`)
        const sourceImage = generatedImageReference(
          options.sourceImageUrls?.[direction] ?? options.sourceImageUrl,
        )
        const input: FirstFrameGenerationInput = {
          type: 'first_frame',
          projectId: run.projectId,
          actionType: node.input.type,
          prompt:
            options.directionPrompts?.[direction] !== undefined
              ? nonEmpty(options.directionPrompts[direction] ?? '', 'directionPrompt')
              : options.prompt === undefined
                ? node.input.directionPrompts?.[direction]?.trim() ||
                  node.input.prompt?.trim() ||
                  node.input.name
                : nonEmpty(options.prompt, 'prompt'),
          spriteWidth: options.spriteWidth,
          spriteHeight: options.spriteHeight,
          referenceMedia: [sourceImage ?? (characterTemplateReference as MediaReference)],
          direction,
          ...(lockCharacterId === undefined ? {} : { characterId: lockCharacterId }),
          ...(options.candidateCount === undefined
            ? {}
            : { candidateCount: options.candidateCount }),
        }
        return input
      },
      generationDirections,
    )
  }

  function updateFirstFrameDirectionPrompts(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    prompts: Partial<Record<ActionDirection, string>>,
  ) {
    ensureRunning()
    const invalidDirection = Object.keys(prompts).find(
      (direction) => !generationDirections.includes(direction as ActionDirection),
    )
    if (invalidDirection) {
      throw new Error(`方向 ${invalidDirection} 是镜像方向，不能保存独立提示词`)
    }
    const normalized = Object.fromEntries(
      generationDirections.flatMap((direction) => {
        const prompt = prompts[direction]?.trim()
        return prompt ? [[direction, prompt]] : []
      }),
    ) as Partial<Record<ActionDirection, string>>
    return persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'action-first-frame') throw new Error('目标节点不是动作首帧')
        if (node.phase !== 'configuring') throw new Error('动作首帧已开始生成，不能修改方向提示词')
        return replaceNode(run, {
          ...node,
          input: {
            ...node.input,
            ...(Object.keys(normalized).length > 0
              ? { directionPrompts: normalized }
              : { directionPrompts: undefined }),
          },
        })
      }),
    )
  }

  async function regenerateCharacterTemplate(
    nodeId: CharacterTemplateWorkflowNode['id'],
    options: RegenerateImageOptions,
  ): Promise<WorkflowRun> {
    ensurePositiveInteger(options.spriteWidth, 'spriteWidth')
    ensurePositiveInteger(options.spriteHeight, 'spriteHeight')
    const before = requireWorkflow()
    const templateNode = findNode(before, nodeId)
    if (templateNode.type !== 'character-template') throw new Error('目标节点不是角色母版')
    const isCompletedTemplate =
      templateNode.status === 'passed' &&
      templateNode.phase === 'completed' &&
      Boolean(templateNode.selectedImageUrl)
    const isCandidateSelection =
      templateNode.status === 'active' &&
      templateNode.phase === 'selecting' &&
      !templateNode.selectedImageUrl
    if (!isCompletedTemplate && !isCandidateSelection) {
      throw new Error('角色母版当前不能重新生成')
    }
    const setupNode = findSingleDependencyNode(before, templateNode, 'character-setup')
    const prompt = adjustedPrompt(setupNode.input.prompt, options)
    const anchorDirection: ActionDirection =
      currentDirectionalMovement === 'single' ? 'east' : 'south'
    const sourceImageUrls =
      options.mode === 'refine'
        ? isCandidateSelection
          ? { [anchorDirection]: nonEmpty(options.sourceImageUrl ?? '', 'sourceImageUrl') }
          : {
              [anchorDirection]: nonEmpty(
                selectedDirectionUrl(
                  templateNode.selectedImages,
                  templateNode.selectedImageUrl,
                  anchorDirection,
                ) ?? '',
                `角色母版方向 ${anchorDirection}`,
              ),
            }
        : undefined
    const requestedDirections = [anchorDirection]
    const keys = requestedDirections.map((direction) =>
      generationKey(nodeId, 'character_template', direction),
    )
    const pending = keys.flatMap((key) => {
      const attachment = unattachedGenerations.get(key)
      return attachment?.regeneration ? [attachment] : []
    })
    await restartFromNode(nodeId)
    return runRegenerationAttempt(before, nodeId, keys, pending, () => {
      return generateCharacterTemplate(setupNode.id, {
        spriteWidth: options.spriteWidth,
        spriteHeight: options.spriteHeight,
        sourceImageUrls,
        prompt,
        directions: requestedDirections,
        ...(isCandidateSelection ? { candidateCount: 3 as const } : {}),
      })
    })
  }

  async function regenerateFirstFrame(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    options: RegenerateImageOptions,
  ): Promise<WorkflowRun> {
    ensurePositiveInteger(options.spriteWidth, 'spriteWidth')
    ensurePositiveInteger(options.spriteHeight, 'spriteHeight')
    const before = requireWorkflow()
    const firstFrameNode = findNode(before, nodeId)
    if (firstFrameNode.type !== 'action-first-frame') throw new Error('目标节点不是动作首帧')
    if (
      firstFrameNode.status !== 'passed' ||
      firstFrameNode.phase !== 'completed' ||
      !firstFrameNode.selectedFirstFrameUrl
    ) {
      throw new Error('动作首帧当前不能重新生成')
    }
    const basePrompt = firstFrameNode.input.prompt?.trim() || firstFrameNode.input.name
    const directionPrompts = Object.fromEntries(
      generationDirections.map((direction) => [
        direction,
        adjustedPrompt(
          firstFrameNode.input.directionPrompts?.[direction]?.trim() || basePrompt,
          options,
        ),
      ]),
    ) as Partial<Record<ActionDirection, string>>
    const sourceImageUrls =
      options.mode === 'refine'
        ? Object.fromEntries(
            generationDirections.map((direction) => {
              const imageUrl = selectedDirectionUrl(
                firstFrameNode.selectedFirstFrameUrls,
                firstFrameNode.selectedFirstFrameUrl,
                direction,
              )
              if (!imageUrl) throw new Error(`动作首帧尚未确认方向 ${direction}`)
              return [direction, imageUrl]
            }),
          )
        : undefined
    const keys = generationDirections.map((direction) =>
      generationKey(nodeId, 'first_frame', direction),
    )
    const pending = keys.flatMap((key) => {
      const attachment = unattachedGenerations.get(key)
      return attachment?.regeneration ? [attachment] : []
    })
    await restartFromNode(nodeId)
    return runRegenerationAttempt(before, nodeId, keys, pending, () => {
      return generateFirstFrame(nodeId, {
        spriteWidth: options.spriteWidth,
        spriteHeight: options.spriteHeight,
        sourceImageUrls,
        directionPrompts,
      })
    })
  }

  async function runRegenerationAttempt(
    before: WorkflowRun,
    nodeId: WorkflowNode['id'],
    keys: readonly string[],
    pending: readonly PendingGenerationAttachment[],
    generate: () => Promise<WorkflowRun>,
  ): Promise<WorkflowRun> {
    try {
      for (const attachment of pending) {
        const retryAttachment = { ...attachment, expectedEpoch: nodeEpoch(nodeId) }
        const key = generationKey(
          retryAttachment.nodeId,
          retryAttachment.role,
          retryAttachment.direction,
        )
        unattachedGenerations.set(key, retryAttachment)
        await attachGeneration(retryAttachment)
      }
      keys.forEach((key) => regenerationKeys.add(key))
      return await generate()
    } catch (cause) {
      try {
        await rollbackRegeneration(before, nodeId)
      } catch (rollbackCause) {
        throw createRegenerationRecoveryError(cause, rollbackCause)
      }
      throw cause
    } finally {
      keys.forEach((key) => regenerationKeys.delete(key))
    }
  }

  /**
   * 重新生成必须先回退节点才能提交请求，提交失败时把回退过的节点还原成用户确认过的样子。
   * 不还原的话这条执行线会丢掉已接受的图片：重新生成还能从原始输入重来，微调却连参考图
   * 和临时描述都没有了，用户只能拿一张全新的图重新对齐。
   *
   * 还原本身失败由调用方转换成 WorkflowRun 冲突，页面必须先刷新快照，不能继续使用不完整状态。
   */
  async function rollbackRegeneration(before: WorkflowRun, nodeId: WorkflowNode['id']) {
    const affectedIds = collectDescendantIds(before.nodes, nodeId)
    const restored = new Map(
      before.nodes.filter((node) => affectedIds.has(node.id)).map((node) => [node.id, node]),
    )
    for (const [key, pending] of unattachedGenerations) {
      const belongsToAffectedBranch = [...affectedIds].some((affectedId) =>
        key.startsWith(`${affectedId}:`),
      )
      if (belongsToAffectedBranch && !pending.regeneration) {
        unattachedGenerations.delete(key)
      }
    }
    await persist((latest) => ({
      ...latest,
      nodes: normalizeAvailability(latest.nodes.map((node) => restored.get(node.id) ?? node)),
    }))
  }

  function confirmFirstFrame(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    selectedFirstFrameUrl: string,
    direction: ActionDirection = 'east',
  ) {
    ensureRunning()
    const imageUrl = nonEmpty(selectedFirstFrameUrl, 'selectedFirstFrameUrl')
    assertGenerationDirection(direction, generationDirections)
    return persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'action-first-frame') throw new Error('目标节点不是动作首帧')
        if (node.status !== 'active' || node.phase !== 'selecting') {
          throw new Error('动作首帧节点当前不能确认首帧')
        }
        const selectedFirstFrameUrls = {
          ...(node.selectedFirstFrameUrls ?? {}),
          [direction]: imageUrl,
        }
        const complete = generationDirections.every((generationDirection) =>
          Boolean(selectedFirstFrameUrls[generationDirection]),
        )
        return unlockReadyNodes(
          replaceNode(run, {
            ...node,
            selectedFirstFrameUrl:
              direction === 'east'
                ? imageUrl
                : (node.selectedFirstFrameUrl ?? node.selectedFirstFrameUrls?.east ?? null),
            selectedFirstFrameUrls,
            status: complete ? 'passed' : 'active',
            phase: complete ? 'completed' : 'selecting',
          }),
        )
      }),
    )
  }

  async function retryGenerationDirection(
    nodeId: WorkflowNode['id'],
    direction: ActionDirection,
    options: RetryGenerationDirectionOptions,
  ): Promise<WorkflowRun> {
    ensureRunning()
    assertGenerationDirection(direction, generationDirections)
    const before = requireWorkflow()
    const originalNode = structuredClone(findNode(before, nodeId))
    const role = generationRoleForNode(originalNode)
    if (!role) throw new Error('目标节点不是生成节点')
    if (originalNode.status !== 'failed' && originalNode.phase !== 'selecting') {
      throw new Error('当前方向不能重新生成')
    }
    const reference = originalNode.generations.find(
      (item) => item.role === role && generationReferenceDirection(item) === direction,
    )
    if (!reference) throw new Error(`方向 ${direction} 没有可替换的生成任务`)
    if (originalNode.type !== 'action-full-frame') {
      ensurePositiveInteger(options.spriteWidth, 'spriteWidth')
      ensurePositiveInteger(options.spriteHeight, 'spriteHeight')
    }

    stopSubscription(subscriptionKey(nodeId, reference.taskId))
    await persist((run) => {
      const node = findNode(run, nodeId)
      const generations = node.generations.filter((item) => item.taskId !== reference.taskId)
      if (node.type === 'character-template') {
        if (role === 'character_four_view' || role === 'character_eight_view') {
          return replaceNode(run, {
            ...node,
            status: 'active',
            phase: 'generating',
            generations,
            error: null,
          })
        }
        const selectedImages = { ...(node.selectedImages ?? {}) }
        delete selectedImages[direction]
        return replaceNode(run, {
          ...node,
          status: 'active',
          phase: 'generating',
          generations,
          selectedImageUrl: direction === 'east' ? null : node.selectedImageUrl,
          selectedImages,
          error: null,
        })
      }
      if (node.type === 'action-first-frame') {
        const selectedFirstFrameUrls = { ...(node.selectedFirstFrameUrls ?? {}) }
        delete selectedFirstFrameUrls[direction]
        return replaceNode(run, {
          ...node,
          status: 'active',
          phase: 'generating',
          generations,
          selectedFirstFrameUrl: direction === 'east' ? null : node.selectedFirstFrameUrl,
          selectedFirstFrameUrls,
          error: null,
        })
      }
      if (node.type === 'action-full-frame') {
        return replaceNode(run, {
          ...node,
          status: 'active',
          phase: 'generating',
          generations,
          error: null,
        })
      }
      throw new Error('目标节点不是生成节点')
    })

    try {
      await submitGeneration(
        nodeId,
        role,
        (run, node, retryDirection) => {
          if (node.type === 'character-template') {
            const setupNode = findSingleDependencyNode(run, node, 'character-setup')
            if (role === 'character_four_view' || role === 'character_eight_view') {
              if (!node.selectedImageUrl || !node.selectedImages?.south) {
                throw new Error('必须先确认南向正视母版')
              }
              const characterId = nonEmpty(setupNode.input.characterId ?? '', 'characterId')
              const input: CharacterViewSheetGenerationInput = {
                type: role,
                projectId: run.projectId,
                characterId,
                prompt: setupNode.input.prompt,
                referenceMedia: [],
                spriteWidth: options.spriteWidth,
                spriteHeight: options.spriteHeight,
                candidateCount: 1,
              }
              return input
            }
            const confirmedMaster = generatedImageReference(node.selectedImageUrl ?? undefined)
            const input: CharacterTemplateGenerationInput = {
              type: 'character_template',
              projectId: run.projectId,
              prompt: setupNode.input.prompt,
              referenceMedia: confirmedMaster ? [confirmedMaster] : setupNode.input.referenceMedia,
              spriteWidth: options.spriteWidth,
              spriteHeight: options.spriteHeight,
              direction: retryDirection,
              candidateCount: confirmedMaster ? 1 : 3,
            }
            return input
          }
          if (node.type === 'action-first-frame') {
            const templateNode = findSingleDependencyNode(run, node, 'character-template')
            const templateUrl = selectedDirectionUrl(
              templateNode.selectedImages,
              templateNode.selectedImageUrl,
              retryDirection,
            )
            if (!templateUrl) throw new Error(`角色母版尚未确认方向 ${retryDirection}`)
            const characterId =
              currentDirectionalMovement === 'single'
                ? undefined
                : nonEmpty(
                    findSingleDependencyNode(run, templateNode, 'character-setup').input
                      .characterId ?? '',
                    'characterId',
                  )
            const input: FirstFrameGenerationInput = {
              type: 'first_frame',
              projectId: run.projectId,
              actionType: node.input.type,
              prompt:
                node.input.directionPrompts?.[retryDirection]?.trim() ||
                node.input.prompt?.trim() ||
                node.input.name,
              spriteWidth: options.spriteWidth,
              spriteHeight: options.spriteHeight,
              referenceMedia: [templateUrl as MediaReference],
              direction: retryDirection,
              ...(characterId === undefined ? {} : { characterId }),
            }
            return input
          }
          if (node.type === 'action-full-frame') {
            const methodNode = findSingleDependencyNode(run, node, 'action-generation-method')
            if (!methodNode.method) throw new Error('尚未选择动作生成方式')
            const firstFrameNode = findSingleDependencyNode(run, methodNode, 'action-first-frame')
            const templateNode = findSingleDependencyNode(run, firstFrameNode, 'character-template')
            const setupNode = findSingleDependencyNode(run, templateNode, 'character-setup')
            const characterId = nonEmpty(setupNode.input.characterId ?? '', 'characterId')
            const firstFrameUrl = selectedDirectionUrl(
              firstFrameNode.selectedFirstFrameUrls,
              firstFrameNode.selectedFirstFrameUrl,
              retryDirection,
            )
            if (!firstFrameUrl) throw new Error(`动作首帧尚未确认方向 ${retryDirection}`)
            const input: CompleteAnimationGenerationInput = {
              type: 'complete_animation',
              projectId: run.projectId,
              characterId,
              outfitId: firstFrameNode.input.outfitId,
              method: methodNode.method,
              actionType: firstFrameNode.input.type,
              firstFrameUrl,
              prompt:
                node.input === undefined
                  ? firstFrameNode.input.prompt
                  : nonEmpty(node.input.prompt ?? '', '完整动作描述'),
              referenceMedia: options.referenceMedia ?? [],
              direction: retryDirection,
            }
            return input
          }
          throw new Error('目标节点不是生成节点')
        },
        direction,
      )
    } catch (cause) {
      const currentNode = findNode(requireWorkflow(), nodeId)
      const attachedRetry = currentNode.generations.some(
        (item) => role === item.role && generationReferenceDirection(item) === direction,
      )
      if (!attachedRetry) await persist((run) => replaceNode(run, originalNode))
      throw cause
    }
    // 新任务已经持久化后不能再回滚，否则恢复订阅的瞬时失败会遗失付费任务引用。
    // 刷新后的失败节点不会自动恢复订阅，因此这里单独恢复其它仍在运行的方向。
    return resume()
  }

  function selectActionGenerationMethod(
    nodeId: ActionGenerationMethodWorkflowNode['id'],
    method: ActionGenerationMethod,
  ) {
    ensureRunning()
    if (method !== 'video-cropping' && method !== '3d-to-2d') {
      return Promise.reject(new Error(`不支持的动作生成方式：${String(method)}`))
    }
    return persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'action-generation-method') {
          throw new Error('目标节点不是动作生成方式')
        }
        if (node.status !== 'active' || node.phase !== 'selecting') {
          throw new Error('动作生成方式节点当前不能选择')
        }
        return unlockReadyNodes(
          replaceNode(run, { ...node, method, status: 'passed', phase: 'completed' }),
        )
      }),
    )
  }

  async function generateCompleteAnimation(
    nodeId: ActionFullFrameWorkflowNode['id'],
    options: GenerateActionOptions,
  ) {
    const characterId = nonEmpty(options.characterId, 'characterId')
    const before = requireWorkflow()
    const targetNode = findNode(before, nodeId)
    if (targetNode.type !== 'action-full-frame') throw new Error('目标节点不是完整动画')
    const targetMethod = findSingleDependencyNode(before, targetNode, 'action-generation-method')
    const targetFirstFrame = findSingleDependencyNode(before, targetMethod, 'action-first-frame')
    for (const direction of generationDirections) {
      if (
        !selectedDirectionUrl(
          targetFirstFrame.selectedFirstFrameUrls,
          targetFirstFrame.selectedFirstFrameUrl,
          direction,
        )
      ) {
        throw new Error(`动作首帧尚未确认方向 ${direction}`)
      }
    }
    const prompt = completeAnimationPrompt(targetNode, targetFirstFrame, options.prompt)
    await persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'action-full-frame') throw new Error('目标节点不是完整动画')
        return replaceNode(run, { ...node, input: { prompt } })
      }),
    )
    return submitDirectionalGenerations(
      nodeId,
      'complete_animation',
      (run, node, direction) => {
        if (node.type !== 'action-full-frame') throw new Error('目标节点不是完整动画')
        if (node.phase !== 'ready') throw new Error('完整动画节点当前不能生成')
        const methodNode = findSingleDependencyNode(run, node, 'action-generation-method')
        if (!methodNode.method) throw new Error('尚未选择动作生成方式')
        const firstFrameNode = findSingleDependencyNode(run, methodNode, 'action-first-frame')
        const firstFrameUrl = selectedDirectionUrl(
          firstFrameNode.selectedFirstFrameUrls,
          firstFrameNode.selectedFirstFrameUrl,
          direction,
        )
        if (!firstFrameUrl) throw new Error(`动作首帧尚未确认方向 ${direction}`)
        const input: CompleteAnimationGenerationInput = {
          type: 'complete_animation',
          projectId: run.projectId,
          characterId,
          outfitId: firstFrameNode.input.outfitId,
          method: methodNode.method,
          actionType: firstFrameNode.input.type,
          firstFrameUrl,
          prompt: nonEmpty(node.input?.prompt ?? '', '完整动作描述'),
          referenceMedia: options.referenceMedia,
          direction,
        }
        return input
      },
      generationDirections,
    )
  }

  function approveReview(nodeId: ReviewWorkflowNode['id']) {
    ensureRunning()
    return persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'review') throw new Error('目标节点不是动作审核')
        if (node.status !== 'active' || node.phase !== 'reviewing') {
          throw new Error('动作审核节点当前不能通过')
        }
        return unlockReadyNodes(
          replaceNode(run, { ...node, status: 'passed', phase: 'completed', error: null }),
        )
      }),
    )
  }

  function archiveAction(nodeId: ActionFullFrameWorkflowNode['id']) {
    ensureRunning()
    return persist((run) => {
      const fullFrameNode = findNode(run, nodeId)
      if (fullFrameNode.type !== 'action-full-frame' || fullFrameNode.status !== 'passed') {
        throw new Error('只能归档已完成的动作资产')
      }
      const reviewNodes = run.nodes.filter(
        (node) => node.type === 'review' && node.dependsOnNodeIds.includes(fullFrameNode.id),
      )
      if (reviewNodes.length === 0 || reviewNodes.some((node) => node.status !== 'passed')) {
        throw new Error('动作尚未通过审核，不能标记为已删除')
      }

      const branchIds = collectActionBranchIds(run.nodes, fullFrameNode.id)
      const deletedAt = now()
      return {
        ...run,
        nodes: run.nodes.map((node) =>
          branchIds.has(node.id) ? { ...node, deletedAt } : node,
        ) as WorkflowNode[],
      }
    })
  }

  function submitGeneration(
    nodeId: WorkflowNode['id'],
    role: WorkflowGenerationRole,
    createInput: (
      run: WorkflowRun,
      node: WorkflowNode,
      direction: ActionDirection,
    ) => Parameters<GenerationApis['create']>[0],
    direction: ActionDirection = 'east',
  ): Promise<WorkflowRun> {
    ensureRunning()
    const key = generationKey(nodeId, role, direction)
    const active = submissions.get(key)
    if (active) return active

    const expectedEpoch = nodeEpoch(nodeId)
    const submission = performGenerationSubmission(
      nodeId,
      role,
      expectedEpoch,
      createInput,
      direction,
    ).finally(() => {
      if (submissions.get(key) === submission) submissions.delete(key)
    })
    submissions.set(key, submission)
    return submission
  }

  async function submitDirectionalGenerations(
    nodeId: WorkflowNode['id'],
    role: WorkflowGenerationRole,
    createInput: (
      run: WorkflowRun,
      node: WorkflowNode,
      direction: ActionDirection,
    ) => Parameters<GenerationApis['create']>[0],
    directions: readonly ActionDirection[] = generationDirections,
  ): Promise<WorkflowRun> {
    if (directions.length === 0) throw new Error('项目没有可生成的真实源方向')
    // 方向之间彼此独立，可以并行排队；即使其中一个提交失败，也要等其它已创建任务
    // 完成引用落库后再返回错误，避免刷新后遗失仍在执行的付费任务。
    const results = await Promise.allSettled(
      directions.map((direction) => submitGeneration(nodeId, role, createInput, direction)),
    )
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (failed) throw asError(failed.reason)
    const snapshots = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    )
    return snapshots[snapshots.length - 1] ?? snapshot()
  }

  async function performGenerationSubmission(
    nodeId: WorkflowNode['id'],
    role: WorkflowGenerationRole,
    expectedEpoch: number,
    createInput: (
      run: WorkflowRun,
      node: WorkflowNode,
      direction: ActionDirection,
    ) => Parameters<GenerationApis['create']>[0],
    direction: ActionDirection,
  ): Promise<WorkflowRun> {
    const before = requireWorkflow()
    const node = findNode(before, nodeId)
    assertNodeCanRun(before, node)
    const key = generationKey(nodeId, role, direction)
    const existing = node.generations.find(
      (item) => item.role === role && generationReferenceDirection(item) === direction,
    )
    if (existing) {
      await watchGeneration(node.id, existing.taskId)
      return snapshot()
    }

    const pendingAttachment = unattachedGenerations.get(key)
    if (pendingAttachment?.expectedEpoch === expectedEpoch) {
      return attachGeneration(pendingAttachment)
    }
    if (pendingAttachment) unattachedGenerations.delete(key)

    const generation = await generationApis.create(createInput(before, node, direction))
    if (generation.projectId !== before.projectId) {
      throw new Error('Generation 与 WorkflowRun 不属于同一项目')
    }
    // 重做发生在请求等待期间时，任务可以留在后端，但绝不能再挂回新的节点执行线。
    if (nodeEpoch(nodeId) !== expectedEpoch) return snapshot()

    const attachment = {
      nodeId,
      role,
      direction,
      expectedEpoch,
      regeneration: regenerationKeys.has(key),
      generation,
    }
    unattachedGenerations.set(key, attachment)
    return attachGeneration(attachment)
  }

  async function attachGeneration({
    nodeId,
    role,
    direction,
    expectedEpoch,
    generation,
  }: PendingGenerationAttachment): Promise<WorkflowRun> {
    const key = generationKey(nodeId, role, direction)
    if (nodeEpoch(nodeId) !== expectedEpoch) {
      if (unattachedGenerations.get(key)?.generation.id === generation.id) {
        unattachedGenerations.delete(key)
      }
      return snapshot()
    }
    const attached = await persist((latest) => {
      if (nodeEpoch(nodeId) !== expectedEpoch) return latest
      const latestNode = findNode(latest, nodeId)
      if (
        latestNode.generations.some(
          (item) => item.role === role && generationReferenceDirection(item) === direction,
        )
      ) {
        return latest
      }
      assertNodeCanRun(latest, latestNode)
      return replaceNode(
        latest,
        attachGenerationReference(latestNode, generation.id, role, direction),
      )
    })
    const attachedReference = findNode(attached, nodeId).generations.find(
      (item) => item.role === role && generationReferenceDirection(item) === direction,
    )
    const forgetPendingAttachment = () => {
      if (unattachedGenerations.get(key)?.generation.id === generation.id) {
        unattachedGenerations.delete(key)
      }
    }
    if (attachedReference?.taskId !== generation.id) {
      forgetPendingAttachment()
      return attached
    }

    if (generation.status === 'completed' || generation.status === 'failed') {
      const settled = await applyGenerationResult({ nodeId, taskId: generation.id, generation })
      forgetPendingAttachment()
      return settled
    }
    await watchGeneration(nodeId, generation.id)
    forgetPendingAttachment()
    return snapshot()
  }

  async function watchGeneration(nodeId: WorkflowNode['id'], taskId: Generation['id']) {
    if (interrupted) return
    const key = subscriptionKey(nodeId, taskId)
    if (subscriptions.has(key)) return

    subscriptions.set(key, { nodeId, taskId, stop: () => undefined })
    try {
      const run = requireWorkflow()
      const node = findNode(run, nodeId)
      const reference = node.generations.find((item) => item.taskId === taskId)
      const expectation = generationExpectationForNode(
        run,
        node,
        reference?.direction,
        reference?.role,
      )
      if (!expectation) throw new Error(`${nodeId} 不是生成节点`)
      const stop = generationApis.subscribe(
        run.projectId,
        taskId,
        expectation,
        (event) => {
          if (event.taskId !== taskId || event.status === 'pending' || event.status === 'running') {
            return
          }
          void settleGeneration(nodeId, taskId, event).catch((cause: unknown) => {
            onAsyncError(asError(cause))
          })
        },
        (error) => onAsyncError(error),
      )
      const registered = subscriptions.get(key)
      if (registered) subscriptions.set(key, { ...registered, stop })
      else stop()

      // 先订阅再查询，关闭“GET 看到运行中，订阅前任务已结束”的丢事件窗口。
      const latest = await generationApis.get(requireWorkflow().projectId, taskId, expectation)
      if (latest.status === 'completed' || latest.status === 'failed') {
        await settleGeneration(nodeId, taskId, latest)
        return
      }
      if (expectation.type === 'complete_animation') {
        // 三渲二把出帧挂给浏览器：渲完交回后端，终态仍由上面那条订阅收。这里不另立
        // 状态机，出帧失败也由 runner 报给后端，任务照常走失败终态。
        // 只问整段动作那一类：母版与首帧走生图，不经出帧台。
        void runClientBake(taskId).catch((cause: unknown) => onAsyncError(asError(cause)))
      }
    } catch (cause) {
      stopSubscription(key)
      throw cause
    }
  }

  function settleGeneration(
    nodeId: WorkflowNode['id'],
    taskId: Generation['id'],
    generation: Generation | GenerationEvent,
  ): Promise<WorkflowRun> {
    if (interrupted) return Promise.resolve(snapshot())
    const key = subscriptionKey(nodeId, taskId)
    const active = settlements.get(key)
    if (active) return active

    const settlement = performSettlement(nodeId, taskId, generation).finally(() => {
      if (settlements.get(key) === settlement) settlements.delete(key)
      stopSubscription(key)
    })
    settlements.set(key, settlement)
    return settlement
  }

  async function performSettlement(
    nodeId: WorkflowNode['id'],
    taskId: Generation['id'],
    generation: Generation | GenerationEvent,
  ) {
    const normalized: Generation =
      'id' in generation
        ? generation
        : {
            id: generation.taskId,
            projectId: requireWorkflow().projectId,
            type: generation.type,
            status: generation.status,
            result: generation.result,
            error: generation.error,
          }
    return applyGenerationResult({ nodeId, taskId, generation: normalized })
  }

  async function applyGenerationResult({
    nodeId,
    taskId,
    generation,
  }: ApplyGenerationResultInput): Promise<WorkflowRun> {
    if (interrupted) return Promise.resolve(snapshot())
    const before = requireWorkflow()
    const node = findNode(before, nodeId)
    const reference = node.generations.find((item) => item.taskId === taskId)
    if (!reference) return snapshot()
    const expectation = generationExpectationForNode(
      before,
      node,
      generationReferenceDirection(reference),
      reference.role,
    )
    if (!expectation) return snapshot()

    // 方向是任务契约的一部分。服务端返回了错误方向时不能把它静默挂到当前方向，
    // 否则四向/八向资产会在导入 Playtest 后出现“名称对得上、画面却错位”的问题。
    if (
      reference.role !== 'character_four_view' &&
      reference.role !== 'character_eight_view' &&
      generation.status === 'completed' &&
      generationDirectionOf(generation) !== generationReferenceDirection(reference)
    ) {
      return persist((run) => {
        const currentNode = findNode(run, nodeId)
        return currentNode.status === 'active'
          ? failNode(run, currentNode, '生成结果方向与 WorkflowRun 任务方向不一致')
          : run
      })
    }

    const role = reference.role
    const roleDirections = node.generations
      .filter((item) => item.role === role)
      .map((item) => generationReferenceDirection(item))
    const expectedDirections =
      role === 'character_four_view' || role === 'character_eight_view'
        ? (['east'] as const)
        : node.type === 'character-template' &&
            !node.selectedImageUrl &&
            roleDirections.length === 1
          ? roleDirections
          : generationDirections
    const hasAllExpectedReferences = expectedDirections.every((direction) =>
      node.generations.some(
        (item) => item.role === role && generationReferenceDirection(item) === direction,
      ),
    )

    // 一个节点现在可能挂着 1/3/5 条任务。结算当前任务时重新读取同节点其余
    // 任务，只有全部完成才允许节点进入 selecting/completed；刷新恢复也走同一规则。
    const allGenerations = await Promise.all(
      node.generations.map((item) =>
        item.taskId === taskId
          ? generation
          : generationApis.get(
              before.projectId,
              item.taskId,
              generationExpectationForNode(before, node, item.direction, item.role)!,
            ),
      ),
    )
    const failed = allGenerations.find((item) => item.status === 'failed')
    const allCompleted = allGenerations.every((item) => item.status === 'completed')
    return persist((run) => {
      if (generation.id !== taskId || generation.projectId !== run.projectId) return run
      const node = findNode(run, nodeId)
      if (node.deletedAt) return run
      const reference = node.generations.find((item) => item.taskId === taskId)
      if (!reference || node.status !== 'active') return run
      // 每种生成任务只属于一种节点；旧任务不能推进另一张卡片。
      if (node.phase !== 'generating' || generationRoleForNode(node) !== reference.role) return run
      if (generation.status === 'pending' || generation.status === 'running') return run
      if (generation.status === 'failed') {
        return replaceNode(run, {
          ...node,
          status: 'failed',
          error: generation.error?.trim() || '生成任务失败',
        })
      }
      if (failed) {
        return replaceNode(run, {
          ...node,
          status: 'failed',
          error: failed.error?.trim() || '方向生成任务失败',
        })
      }
      if (!hasAllExpectedReferences) {
        return replaceNode(run, { ...node, phase: 'generating', error: null })
      }
      if (!allCompleted) return replaceNode(run, { ...node, phase: 'generating', error: null })
      if (
        allGenerations.some(
          (item, index) =>
            node.generations[index]!.role !== 'character_four_view' &&
            node.generations[index]!.role !== 'character_eight_view' &&
            generationDirectionOf(item) !== generationReferenceDirection(node.generations[index]!),
        )
      ) {
        return failNode(run, node, '生成结果方向与 WorkflowRun 任务方向不一致')
      }
      const invalidGeneration = allGenerations
        .map((item) => generationResultError(node, item))
        .find((message): message is string => message !== null)
      if (invalidGeneration) return failNode(run, node, invalidGeneration)
      return applyCompletedGeneration(run, node, reference, generation)
    })
  }

  function applyCompletedGeneration(
    run: WorkflowRun,
    node: WorkflowNode,
    reference: WorkflowGenerationRef,
    generation: Generation,
  ): WorkflowRun {
    const invalid = generationResultError(node, generation)
    if (invalid) return failNode(run, node, invalid)
    if (reference.role === 'character_template' && node.type === 'character-template') {
      return replaceNode(run, { ...node, phase: 'selecting', error: null })
    }
    if (
      (reference.role === 'character_four_view' || reference.role === 'character_eight_view') &&
      node.type === 'character-template'
    ) {
      return replaceNode(run, { ...node, phase: 'selecting', error: null })
    }
    if (reference.role === 'first_frame' && node.type === 'action-first-frame') {
      return replaceNode(run, { ...node, phase: 'selecting', error: null })
    }
    if (reference.role !== 'complete_animation' || node.type !== 'action-full-frame') {
      return failNode(run, node, '生成任务角色不匹配')
    }
    return unlockReadyNodes(
      replaceNode(run, { ...node, status: 'passed', phase: 'completed', error: null }),
    )
  }

  async function resume(): Promise<WorkflowRun> {
    interrupted = false
    for (const attachment of [...unattachedGenerations.values()]) {
      await attachGeneration(attachment)
    }
    const run = requireWorkflow()
    const tasks = run.nodes.flatMap((node) => {
      if (node.deletedAt || node.status !== 'active' || !isGeneratingPhase(node)) return []
      const role = generationRoleForNode(node)
      if (!role) return []
      return node.generations
        .filter((item) => item.role === role)
        .map((reference) => ({ nodeId: node.id, taskId: reference.taskId }))
    })
    await Promise.all(tasks.map((task) => watchGeneration(task.nodeId, task.taskId)))
    return snapshot()
  }

  async function interrupt(): Promise<WorkflowRun> {
    interrupted = true
    stopAllSubscriptions()
    return snapshot()
  }

  async function restartFromNode(nodeId: WorkflowNode['id']): Promise<WorkflowRun> {
    const before = requireWorkflow()
    const restartNode = findNode(before, nodeId)
    if (restartNode.deletedAt) throw new Error('已归档节点不能重新执行')
    const affectedIds = collectDescendantIds(before.nodes, nodeId)
    const affectedCharacterSetupIds = before.nodes
      .filter(
        (node): node is CharacterTemplateWorkflowNode =>
          node.type === 'character-template' && affectedIds.has(node.id),
      )
      .flatMap((node) => node.dependsOnNodeIds)

    const restarted = await persist((run) => {
      const resetNodes = run.nodes.map((node) =>
        affectedIds.has(node.id) ? resetNode(node) : node,
      )
      return { ...run, nodes: normalizeAvailability(resetNodes) }
    })
    for (const affectedId of affectedIds) {
      nodeEpochs.set(affectedId, nodeEpoch(affectedId) + 1)
      characterCommands.delete(affectedId)
      for (const [key] of submissions) {
        if (key.startsWith(`${affectedId}:`)) submissions.delete(key)
      }
      for (const [key] of unattachedGenerations) {
        if (key.startsWith(`${affectedId}:`)) unattachedGenerations.delete(key)
      }
    }
    for (const setupNodeId of affectedCharacterSetupIds) characterCommands.delete(setupNodeId)
    // 不依赖重做前快照里的 taskId：引用保存与重做交错时，订阅可能刚刚才建立。
    for (const [key, subscription] of subscriptions) {
      if (affectedIds.has(subscription.nodeId)) stopSubscription(key)
    }
    interrupted = false
    return restarted
  }

  async function getGeneration(nodeId: WorkflowNode['id'], role: WorkflowGenerationRole) {
    const generations = await getGenerations(nodeId, role)
    return (
      generations.find((generation) => generationDirectionOf(generation) === 'east') ??
      generations[0] ??
      null
    )
  }

  async function getGenerations(nodeId: WorkflowNode['id'], role: WorkflowGenerationRole) {
    const run = requireWorkflow()
    const node = findNode(run, nodeId)
    const references = node.generations.filter((item) => item.role === role)
    return Promise.all(
      references.map((reference) => {
        const expectation = generationExpectationForNode(
          run,
          node,
          reference.direction,
          reference.role,
        )
        return expectation
          ? generationApis.get(run.projectId, reference.taskId, expectation)
          : Promise.reject(new Error(`${nodeId} 不是生成节点`))
      }),
    )
  }

  function stopSubscription(key: string) {
    const subscription = subscriptions.get(key)
    subscriptions.delete(key)
    try {
      subscription?.stop()
    } catch {
      // 释放传输连接失败不能反向改变已经持久化的 WorkflowRun。
    }
  }

  function stopAllSubscriptions() {
    for (const key of [...subscriptions.keys()]) stopSubscription(key)
  }

  function dispose() {
    interrupted = true
    stopAllSubscriptions()
    listeners.clear()
  }

  function nodeEpoch(nodeId: WorkflowNode['id']) {
    return nodeEpochs.get(nodeId) ?? 0
  }

  return {
    create: asCommand(create),
    startCharacterGeneration,
    getWorkflow,
    subscribe,
    setCharacterName: asCommand(setCharacterName),
    addAction: asCommand(addAction),
    generateCharacterTemplate: asCommand(generateCharacterTemplate),
    regenerateCharacterTemplate: asCommand(regenerateCharacterTemplate),
    updateCharacterSetup: asCommand(updateCharacterSetup),
    acceptUploadedCharacterTemplate: asCommand(acceptUploadedCharacterTemplate),
    confirmCharacterTemplate: asCommand(confirmCharacterTemplate),
    generateCharacterViewSheet: asCommand(generateCharacterViewSheet),
    confirmCharacterViewSheet: asCommand(confirmCharacterViewSheet),
    updateFirstFrameDirectionPrompts: asCommand(updateFirstFrameDirectionPrompts),
    generateFirstFrame: asCommand(generateFirstFrame),
    regenerateFirstFrame: asCommand(regenerateFirstFrame),
    confirmFirstFrame: asCommand(confirmFirstFrame),
    selectActionGenerationMethod: asCommand(selectActionGenerationMethod),
    generateCompleteAnimation: asCommand(generateCompleteAnimation),
    approveReview: asCommand(approveReview),
    archiveAction: asCommand(archiveAction),
    resume: asCommand(resume),
    interrupt: asCommand(interrupt),
    restartFromNode: asCommand(restartFromNode),
    applyGenerationResult: asCommand(applyGenerationResult),
    getGeneration,
    getGenerations,
    retryGenerationDirection: asCommand(retryGenerationDirection),
    dispose,
  }
}

function hasSamePersistedState(expected: WorkflowRun, actual: WorkflowRun) {
  return (
    expected.id === actual.id &&
    expected.projectId === actual.projectId &&
    expected.storageStatus === actual.storageStatus &&
    JSON.stringify(canonicalizeJson(expected.nodes)) ===
      JSON.stringify(canonicalizeJson(actual.nodes))
  )
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalizeJson(item)]),
  )
}

function asCommand<TArgs extends unknown[]>(
  operation: (...args: TArgs) => Promise<WorkflowRun>,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    await operation(...args)
  }
}

function collectActionBranchIds(
  nodes: readonly WorkflowNode[],
  fullFrameNodeId: ActionFullFrameWorkflowNode['id'],
) {
  const branchIds = new Set<WorkflowNode['id']>([fullFrameNodeId])
  const frontier = [fullFrameNodeId]
  while (frontier.length > 0) {
    const currentId = frontier.shift()!
    const current = nodes.find((node) => node.id === currentId)
    if (!current) continue

    for (const dependencyId of current.dependsOnNodeIds) {
      const dependency = nodes.find((node) => node.id === dependencyId)
      if (
        dependency &&
        dependency.type !== 'character-setup' &&
        dependency.type !== 'character-template' &&
        !branchIds.has(dependency.id)
      ) {
        branchIds.add(dependency.id)
        frontier.push(dependency.id)
      }
    }
    for (const dependent of nodes) {
      if (
        dependent.type === 'review' &&
        dependent.dependsOnNodeIds.includes(currentId) &&
        !branchIds.has(dependent.id)
      ) {
        branchIds.add(dependent.id)
      }
    }
  }
  return branchIds
}

function updateNode(
  run: WorkflowRun,
  nodeId: WorkflowNode['id'],
  update: (node: WorkflowNode) => WorkflowRun,
) {
  const node = findNode(run, nodeId)
  if (node.deletedAt) throw new Error('已归档节点不能执行')
  return update(node)
}

function findNode(run: WorkflowRun, nodeId: WorkflowNode['id']): WorkflowNode {
  const node = run.nodes.find((item) => item.id === nodeId)
  if (!node) throw new Error(`WorkflowNode 不存在：${nodeId}`)
  return node
}

function replaceNode(run: WorkflowRun, replacement: WorkflowNode): WorkflowRun {
  return {
    ...run,
    nodes: run.nodes.map((node) => (node.id === replacement.id ? replacement : node)),
  }
}

function failNode(run: WorkflowRun, node: WorkflowNode, error: string): WorkflowRun {
  return replaceNode(run, { ...node, status: 'failed', error })
}

function unlockReadyNodes(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    nodes: run.nodes.map((node) =>
      !node.deletedAt &&
      node.status === 'locked' &&
      node.dependsOnNodeIds.every((dependencyId) => isPassed(run.nodes, dependencyId))
        ? { ...node, status: 'active' }
        : node,
    ),
  }
}

function normalizeAvailability(nodes: readonly WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => {
    if (node.deletedAt) return structuredClone(node)
    if (node.status === 'passed' || node.status === 'failed') return structuredClone(node)
    const available = node.dependsOnNodeIds.every((dependencyId) => isPassed(nodes, dependencyId))
    return { ...structuredClone(node), status: available ? 'active' : 'locked' }
  })
}

function isPassed(nodes: readonly WorkflowNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId)?.status === 'passed'
}

function assertDependenciesExist(nodes: readonly WorkflowNode[], dependencyIds: readonly string[]) {
  const knownIds = new Set(nodes.map((node) => node.id))
  const unknownId = dependencyIds.find((id) => !knownIds.has(id))
  if (unknownId) throw new Error(`依赖节点不存在：${unknownId}`)
  if (new Set(dependencyIds).size !== dependencyIds.length) throw new Error('依赖节点不能重复')
}

function assertNodeCanRun(run: WorkflowRun, node: WorkflowNode) {
  if (node.deletedAt) throw new Error('已归档节点不能执行')
  if (node.status !== 'active') throw new Error('目标节点当前不可执行')
  if (!node.dependsOnNodeIds.every((id) => isPassed(run.nodes, id))) {
    throw new Error('目标节点的前置依赖尚未完成')
  }
}

function generationRoleForNode(node: WorkflowNode): WorkflowGenerationRole | null {
  if (node.type === 'character-template') {
    return (
      node.generations.find(
        (reference) =>
          reference.role === 'character_four_view' || reference.role === 'character_eight_view',
      )?.role ?? 'character_template'
    )
  }
  if (node.type === 'action-first-frame') return 'first_frame'
  if (node.type === 'action-full-frame') return 'complete_animation'
  return null
}

function generationResultError(node: WorkflowNode, generation: Generation): string | null {
  if (node.type === 'character-template') {
    if (
      (generation.type === 'character_four_view' || generation.type === 'character_eight_view') &&
      generation.result?.type === generation.type &&
      generation.result.sheets.length > 0
    ) {
      return null
    }
    return generation.type === 'character_template' &&
      generation.result?.type === 'character_template' &&
      isImageCandidateCount(generation.result.images.length)
      ? null
      : '角色候选图结果格式无效'
  }

  if (node.type === 'action-first-frame') {
    return generation.type === 'first_frame' &&
      generation.result?.type === 'first_frame' &&
      isImageCandidateCount(generation.result.images.length) &&
      generation.result.images.every((image) => Boolean(image.url))
      ? null
      : '动作首帧结果格式无效'
  }

  if (node.type === 'action-full-frame') {
    if (
      generation.type !== 'complete_animation' ||
      generation.result?.type !== 'complete_animation'
    ) {
      return '完整动画结果格式无效'
    }
    // 帧数是否合乎该动作类型的约定，由 generation 适配器按任务声明的 num_frames 判；
    // 这里再写一个数就是第二份约定，各动作帧数不同时它会把合规结果判成失败。
    return generation.result.frames.length > 0 ? null : '完整动画结果没有帧'
  }

  return '当前节点不能绑定生成结果'
}

function generationExpectationForNode(
  run: WorkflowRun,
  node: WorkflowNode,
  direction?: ActionDirection,
  role?: WorkflowGenerationRole | null,
): WorkflowGenerationExpectation | null {
  const withDirection = <T extends WorkflowGenerationExpectation>(expectation: T): T => {
    return direction === undefined ? expectation : ({ ...expectation, direction } as T)
  }
  if (node.type === 'character-template') {
    if (role === 'character_four_view' || role === 'character_eight_view') {
      return { type: role }
    }
    return withDirection({ type: 'character_template' })
  }
  if (node.type === 'action-first-frame') {
    return withDirection({ type: 'first_frame', actionType: node.input.type })
  }
  if (node.type === 'action-full-frame') {
    const methodNode = findSingleDependencyNode(run, node, 'action-generation-method')
    const firstFrameNode = findSingleDependencyNode(run, methodNode, 'action-first-frame')
    return withDirection({ type: 'complete_animation', actionType: firstFrameNode.input.type })
  }
  return null
}

function assertGenerationRoleMatchesNode(node: WorkflowNode, role: WorkflowGenerationRole) {
  const matchesCharacterTemplate =
    node.type === 'character-template' &&
    (role === 'character_template' ||
      role === 'character_four_view' ||
      role === 'character_eight_view')
  if (!matchesCharacterTemplate && generationRoleForNode(node) !== role) {
    throw new Error(`生成任务 ${role} 不能绑定到 ${node.type} 节点`)
  }
}

function attachGenerationReference(
  node: WorkflowNode,
  taskId: Generation['id'],
  role: WorkflowGenerationRole,
  direction: ActionDirection = 'east',
): WorkflowNode {
  assertGenerationRoleMatchesNode(node, role)
  const update = {
    phase: 'generating' as const,
    generations: [
      ...node.generations,
      direction === 'east' ? { taskId, role } : { taskId, role, direction },
    ],
    error: null,
  }
  if (node.type === 'character-template') return { ...node, ...update }
  if (node.type === 'action-first-frame') return { ...node, ...update }
  if (node.type === 'action-full-frame') return { ...node, ...update }
  throw new Error(`${node.type} 节点不能绑定生成任务`)
}

function findSingleDependencyNode<TType extends WorkflowNode['type']>(
  run: WorkflowRun,
  node: WorkflowNode,
  type: TType,
): Extract<WorkflowNode, { type: TType }> {
  const matches = node.dependsOnNodeIds
    .map((dependencyId) => findNode(run, dependencyId))
    .filter(
      (dependency): dependency is Extract<WorkflowNode, { type: TType }> =>
        dependency.type === type,
    )
  if (matches.length !== 1) throw new Error(`${node.type} 节点必须且只能依赖一个 ${type} 节点`)
  return matches[0]
}

function findSingleDependentNode<TType extends WorkflowNode['type']>(
  run: WorkflowRun,
  dependencyId: WorkflowNode['id'],
  type: TType,
): Extract<WorkflowNode, { type: TType }> {
  const matches = run.nodes.filter(
    (node): node is Extract<WorkflowNode, { type: TType }> =>
      node.type === type && node.dependsOnNodeIds.includes(dependencyId),
  )
  if (matches.length !== 1) throw new Error(`${dependencyId} 必须且只能连接一个 ${type} 节点`)
  return matches[0]
}

function isGeneratingPhase(node: WorkflowNode) {
  return node.phase === 'generating' && generationRoleForNode(node) !== null
}

function collectDescendantIds(nodes: readonly WorkflowNode[], rootId: string) {
  const affected = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.deletedAt || affected.has(node.id)) continue
      if (node.dependsOnNodeIds.some((id) => affected.has(id))) {
        affected.add(node.id)
        changed = true
      }
    }
  }
  return affected
}

function resetNode(node: WorkflowNode): WorkflowNode {
  if (node.type === 'character-setup') {
    return {
      ...node,
      status: 'locked',
      phase: 'configuring',
      generations: [],
      error: null,
    }
  }
  if (node.type === 'character-template') {
    return {
      ...node,
      status: 'locked',
      phase: 'ready',
      generations: [],
      error: null,
      selectedImageUrl: null,
      selectedImages: undefined,
    }
  }
  if (node.type === 'action-first-frame') {
    return {
      ...node,
      status: 'locked',
      phase: 'configuring',
      generations: [],
      error: null,
      selectedFirstFrameUrl: null,
      selectedFirstFrameUrls: undefined,
    }
  }
  if (node.type === 'action-generation-method') {
    return {
      ...node,
      status: 'locked',
      phase: 'selecting',
      method: null,
      generations: [],
      error: null,
    }
  }
  if (node.type === 'action-full-frame') {
    return { ...node, status: 'locked', phase: 'ready', generations: [], error: null }
  }
  return { ...node, status: 'locked', phase: 'reviewing', generations: [], error: null }
}

function subscriptionKey(nodeId: string, taskId: string) {
  return `${nodeId}:${taskId}`
}

function generationKey(nodeId: string, role: WorkflowGenerationRole, direction: ActionDirection) {
  return `${nodeId}:${role}:${direction}`
}

function generationReferenceDirection(reference: WorkflowGenerationRef): ActionDirection {
  return reference.direction ?? 'east'
}

function assertGenerationDirection(
  direction: ActionDirection,
  generationDirections: readonly ActionDirection[],
) {
  if (!generationDirections.includes(direction)) {
    throw new Error(`方向 ${direction} 是镜像方向，不能单独生成或确认`)
  }
}

function generationDirectionOf(generation: Generation): ActionDirection {
  const result = generation.result
  return result && 'direction' in result && result.direction !== undefined
    ? result.direction
    : 'east'
}

function nonEmpty(value: string, field: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} 不能为空`)
  return normalized
}

function completeAnimationPrompt(
  fullFrameNode: ActionFullFrameWorkflowNode,
  firstFrameNode: ActionFirstFrameWorkflowNode,
  override: string | undefined,
) {
  if (override !== undefined) return nonEmpty(override, '完整动作描述')
  if (fullFrameNode.input !== undefined) {
    return nonEmpty(fullFrameNode.input.prompt ?? '', '完整动作描述')
  }
  return firstFrameNode.input.prompt?.trim() || firstFrameNode.input.name
}

function generatedImageReference(value: GeneratedImage['url'] | undefined) {
  return value === undefined ? undefined : (nonEmpty(value, 'sourceImageUrl') as MediaReference)
}

function adjustedPrompt(basePrompt: string, options: RegenerateImageOptions) {
  const base = nonEmpty(basePrompt, 'prompt')
  if (options.mode === 'regenerate') {
    if (options.adjustmentPrompt?.trim()) throw new Error('重新生成不能携带微调描述')
    return base
  }
  if (options.mode !== 'refine') throw new Error('不支持的重新生成模式')
  return `${base}\n${nonEmpty(options.adjustmentPrompt ?? '', 'adjustmentPrompt')}`
}

function createRegenerationRecoveryError(originalCause: unknown, rollbackCause: unknown) {
  const original = asError(originalCause)
  const rollback = asError(rollbackCause)
  return new WorkflowRunConflictError(
    `重新生成失败：${original.message}；恢复原有工作流失败：${rollback.message}，请加载最新版本后重试`,
    { cause: rollback },
  )
}

function ensurePositiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} 必须是正整数`)
}

function createBrowserSafeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function asError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}
