import type {
  ActionFirstFrameWorkflowNode,
  ActionFullFrameWorkflowNode,
  ActionGenerationMethod,
  ActionGenerationMethodWorkflowNode,
  CharacterTemplateGenerationInput,
  CharacterSetupWorkflowNode,
  CharacterTemplateWorkflowNode,
  CompleteAnimationGenerationInput,
  CreateWorkflowRunInput,
  FirstFrameGenerationInput,
  Generation,
  GenerationApis,
  GenerationEvent,
  GenerationExpectation,
  MediaReference,
  ReviewWorkflowNode,
  WorkflowActionInput,
  WorkflowCharacterInput,
  WorkflowGenerationRef,
  WorkflowGenerationRole,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import { IMAGE_CANDIDATE_COUNT } from '@/entities'

const COMPLETE_ANIMATION_FRAME_COUNT = 32

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
  /** 手动编辑器提交时覆盖 configuring 节点的初始输入；节点通过后不再改写。 */
  input?: WorkflowCharacterInput
}

export interface GenerateActionOptions {
  characterId: string
  /** 由上传/媒体边界提供，Controller 不把展示 URL 冒充 MediaReference。 */
  referenceMedia: readonly MediaReference[]
}

export interface GenerateFirstFrameOptions {
  spriteWidth: number
  spriteHeight: number
}

export interface ApplyGenerationResultInput {
  nodeId: WorkflowNode['id']
  taskId: Generation['id']
  generation: Generation
}

export interface CreateWorkflowControllerOptions {
  /** 已从 WorkflowRunApis.get 取回的运行记录；不传时只能先调用 create。 */
  workflow?: WorkflowRun
  workflowRunApis: WorkflowRunApis
  generationApis: GenerationApis
  createId?: () => string
  now?: () => string
  /** SSE 回调无法 await，异步保存错误通过此处交给装配层展示或记录。 */
  onAsyncError: (error: Error) => void
}

/**
 * 一个 Controller 只维护一条 WorkflowRun。
 *
 * Quick Start 与 Workflow Editor 调用同一组业务方法，区别只在于前者自动选择并连续
 * 调用、后者等待用户逐步点击。Controller 不识别入口，也不保存第二份流程模型。
 */
export interface WorkflowController {
  create(input: CreateWorkflowRunInput): Promise<void>
  /** 页面首次读取当前快照；后续变化统一通过 subscribe 接收。 */
  getWorkflow(): WorkflowRun
  subscribe(listener: (workflow: WorkflowRun) => void): () => void

  setCharacterName(nodeId: CharacterSetupWorkflowNode['id'], name: string | null): Promise<void>
  addAction(input: AddActionInput): Promise<void>
  generateCharacterTemplate(
    nodeId: CharacterSetupWorkflowNode['id'],
    options: GenerateCharacterTemplateOptions,
  ): Promise<void>
  /** 将已创建的 Character 绑定到入口节点；一条 Run 不允许改绑到另一角色。 */
  bindCharacter(nodeId: CharacterSetupWorkflowNode['id'], characterId: string): Promise<void>
  /** 仅在入口节点尚未提交时修改角色描述和参考媒体。 */
  updateCharacterSetup(
    nodeId: CharacterSetupWorkflowNode['id'],
    input: Pick<WorkflowCharacterInput, 'prompt' | 'referenceMedia'>,
  ): Promise<void>
  /** 使用用户上传的角色母版，显式跳过角色候选图生成。 */
  acceptUploadedCharacterTemplate(
    nodeId: CharacterSetupWorkflowNode['id'],
    selectedImageUrl: string,
  ): Promise<void>
  confirmCharacterTemplate(
    nodeId: CharacterTemplateWorkflowNode['id'],
    selectedImageUrl: string,
  ): Promise<void>
  generateFirstFrame(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    options: GenerateFirstFrameOptions,
  ): Promise<void>
  confirmFirstFrame(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    selectedFirstFrameUrl: string,
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
  expectedEpoch: number
  generation: Generation
}

export function createWorkflowController({
  workflow,
  workflowRunApis,
  generationApis,
  createId = createBrowserSafeId,
  now = () => new Date().toISOString(),
  onAsyncError,
}: CreateWorkflowControllerOptions): WorkflowController {
  let current = workflow ? structuredClone(workflow) : null
  let interrupted = false
  let saveQueue: Promise<void> = Promise.resolve()
  const characterCommands = new Map<WorkflowNode['id'], Promise<WorkflowRun>>()
  const submissions = new Map<string, Promise<WorkflowRun>>()
  const subscriptions = new Map<string, ActiveSubscription>()
  const nodeEpochs = new Map<WorkflowNode['id'], number>()
  const unattachedGenerations = new Map<string, PendingGenerationAttachment>()
  const settlements = new Map<string, Promise<WorkflowRun>>()
  const listeners = new Set<(workflow: WorkflowRun) => void>()

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

      // 只有后端确认保存后才替换内存快照；失败时页面不会看到“假成功”。
      const saved = await workflowRunApis.update(candidate)
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
    return submitGeneration(templateNode.id, 'character_template', (run, node) => {
      if (node.type !== 'character-template') throw new Error('目标节点不是角色母版')
      if (node.phase !== 'ready') throw new Error('角色母版节点当前不能开始生成')
      const setupNode = findSingleDependencyNode(run, node, 'character-setup')
      const input: CharacterTemplateGenerationInput = {
        type: 'character_template',
        projectId: run.projectId,
        prompt: setupNode.input.prompt,
        referenceMedia: setupNode.input.referenceMedia,
        spriteWidth: options.spriteWidth,
        spriteHeight: options.spriteHeight,
      }
      return input
    })
  }

  function confirmCharacterTemplate(
    nodeId: CharacterTemplateWorkflowNode['id'],
    selectedImageUrl: string,
  ) {
    ensureRunning()
    const imageUrl = nonEmpty(selectedImageUrl, 'selectedImageUrl')
    return persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'character-template') throw new Error('目标节点不是角色母版')
        if (node.status !== 'active' || node.phase !== 'selecting') {
          throw new Error('角色母版节点当前不能确认候选图')
        }
        return unlockReadyNodes({
          ...run,
          nodes: run.nodes.map((item) =>
            item.id === node.id
              ? { ...node, selectedImageUrl: imageUrl, phase: 'completed', status: 'passed' }
              : item,
          ),
        })
      }),
    )
  }

  function bindCharacter(nodeId: CharacterSetupWorkflowNode['id'], characterId: string) {
    ensureRunning()
    const normalizedCharacterId = nonEmpty(characterId, 'characterId')
    return persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'character-setup') throw new Error('目标节点不是角色设定')
        if (node.input.characterId && node.input.characterId !== normalizedCharacterId) {
          throw new Error('WorkflowRun 已绑定到另一角色，不能改绑')
        }
        return replaceNode(run, {
          ...node,
          input: { ...node.input, characterId: normalizedCharacterId },
        })
      }),
    )
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
  ) {
    ensureRunning()
    const imageUrl = nonEmpty(selectedImageUrl, 'selectedImageUrl')
    return persist((run) => {
      const setupNode = findNode(run, nodeId)
      if (setupNode.type !== 'character-setup') throw new Error('目标节点不是角色设定')
      if (setupNode.status !== 'active' || setupNode.phase !== 'configuring') {
        throw new Error('角色设定节点当前不能使用上传母版')
      }
      const templateNode = findSingleDependentNode(run, setupNode.id, 'character-template')
      if (templateNode.status !== 'locked' || templateNode.phase !== 'ready') {
        throw new Error('角色母版节点当前不能使用上传图片')
      }
      return unlockReadyNodes({
        ...run,
        nodes: run.nodes.map((node) => {
          if (node.id === setupNode.id) {
            return { ...setupNode, status: 'passed', phase: 'completed', error: null }
          }
          if (node.id === templateNode.id) {
            return {
              ...templateNode,
              selectedImageUrl: imageUrl,
              status: 'passed',
              phase: 'completed',
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
    return submitGeneration(nodeId, 'first_frame', (run, node) => {
      if (node.type !== 'action-first-frame') throw new Error('目标节点不是动作首帧')
      if (node.phase !== 'configuring') throw new Error('动作首帧节点当前不能生成')
      const templateNode = findSingleDependencyNode(run, node, 'character-template')
      if (!templateNode.selectedImageUrl) throw new Error('角色母版尚未确认')
      // 该 URL 来自已确认的角色母版，是动作首帧图片任务唯一的参考图。
      const characterTemplateReference = templateNode.selectedImageUrl as MediaReference
      const input: FirstFrameGenerationInput = {
        type: 'first_frame',
        projectId: run.projectId,
        actionType: node.input.type,
        prompt: node.input.prompt?.trim() || node.input.name,
        spriteWidth: options.spriteWidth,
        spriteHeight: options.spriteHeight,
        referenceMedia: [characterTemplateReference],
      }
      return input
    })
  }

  function confirmFirstFrame(
    nodeId: ActionFirstFrameWorkflowNode['id'],
    selectedFirstFrameUrl: string,
  ) {
    ensureRunning()
    const imageUrl = nonEmpty(selectedFirstFrameUrl, 'selectedFirstFrameUrl')
    return persist((run) =>
      updateNode(run, nodeId, (node) => {
        if (node.type !== 'action-first-frame') throw new Error('目标节点不是动作首帧')
        if (node.status !== 'active' || node.phase !== 'selecting') {
          throw new Error('动作首帧节点当前不能确认首帧')
        }
        return unlockReadyNodes(
          replaceNode(run, {
            ...node,
            selectedFirstFrameUrl: imageUrl,
            status: 'passed',
            phase: 'completed',
          }),
        )
      }),
    )
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

  function generateCompleteAnimation(
    nodeId: ActionFullFrameWorkflowNode['id'],
    options: GenerateActionOptions,
  ) {
    const characterId = nonEmpty(options.characterId, 'characterId')
    return submitGeneration(nodeId, 'complete_animation', (run, node) => {
      if (node.type !== 'action-full-frame') throw new Error('目标节点不是完整动画')
      if (node.phase !== 'ready') throw new Error('完整动画节点当前不能生成')
      const methodNode = findSingleDependencyNode(run, node, 'action-generation-method')
      if (!methodNode.method) throw new Error('尚未选择动作生成方式')
      if (methodNode.method === '3d-to-2d') {
        throw new Error('3D 转 2D 接口尚未提供，暂时不能开始生成')
      }
      const firstFrameNode = findSingleDependencyNode(run, methodNode, 'action-first-frame')
      if (!firstFrameNode.selectedFirstFrameUrl) throw new Error('动作首帧尚未确认')
      const input: CompleteAnimationGenerationInput = {
        type: 'complete_animation',
        projectId: run.projectId,
        characterId,
        outfitId: firstFrameNode.input.outfitId,
        actionType: firstFrameNode.input.type,
        firstFrameUrl: firstFrameNode.selectedFirstFrameUrl,
        prompt: firstFrameNode.input.prompt,
        referenceMedia: options.referenceMedia,
      }
      return input
    })
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
    createInput: (run: WorkflowRun, node: WorkflowNode) => Parameters<GenerationApis['create']>[0],
  ): Promise<WorkflowRun> {
    ensureRunning()
    const key = `${nodeId}:${role}`
    const active = submissions.get(key)
    if (active) return active

    const expectedEpoch = nodeEpoch(nodeId)
    const submission = performGenerationSubmission(
      nodeId,
      role,
      expectedEpoch,
      createInput,
    ).finally(() => {
      if (submissions.get(key) === submission) submissions.delete(key)
    })
    submissions.set(key, submission)
    return submission
  }

  async function performGenerationSubmission(
    nodeId: WorkflowNode['id'],
    role: WorkflowGenerationRole,
    expectedEpoch: number,
    createInput: (run: WorkflowRun, node: WorkflowNode) => Parameters<GenerationApis['create']>[0],
  ): Promise<WorkflowRun> {
    const before = requireWorkflow()
    const node = findNode(before, nodeId)
    assertNodeCanRun(before, node)
    const key = `${nodeId}:${role}`
    const existing = node.generations.find((item) => item.role === role)
    if (existing) {
      await watchGeneration(node.id, existing.taskId)
      return snapshot()
    }

    const pendingAttachment = unattachedGenerations.get(key)
    if (pendingAttachment?.expectedEpoch === expectedEpoch) {
      return attachGeneration(pendingAttachment)
    }
    if (pendingAttachment) unattachedGenerations.delete(key)

    const generation = await generationApis.create(createInput(before, node))
    if (generation.projectId !== before.projectId) {
      throw new Error('Generation 与 WorkflowRun 不属于同一项目')
    }
    // 重做发生在请求等待期间时，任务可以留在后端，但绝不能再挂回新的节点执行线。
    if (nodeEpoch(nodeId) !== expectedEpoch) return snapshot()

    const attachment = { nodeId, role, expectedEpoch, generation }
    unattachedGenerations.set(key, attachment)
    return attachGeneration(attachment)
  }

  async function attachGeneration({
    nodeId,
    role,
    expectedEpoch,
    generation,
  }: PendingGenerationAttachment): Promise<WorkflowRun> {
    const key = `${nodeId}:${role}`
    if (nodeEpoch(nodeId) !== expectedEpoch) {
      if (unattachedGenerations.get(key)?.generation.id === generation.id) {
        unattachedGenerations.delete(key)
      }
      return snapshot()
    }
    const attached = await persist((latest) => {
      if (nodeEpoch(nodeId) !== expectedEpoch) return latest
      const latestNode = findNode(latest, nodeId)
      if (latestNode.generations.some((item) => item.role === role)) return latest
      assertNodeCanRun(latest, latestNode)
      return replaceNode(latest, attachGenerationReference(latestNode, generation.id, role))
    })
    const attachedReference = findNode(attached, nodeId).generations.find(
      (item) => item.role === role,
    )
    if (unattachedGenerations.get(key)?.generation.id === generation.id) {
      unattachedGenerations.delete(key)
    }
    if (attachedReference?.taskId !== generation.id) {
      return attached
    }

    if (generation.status === 'completed' || generation.status === 'failed') {
      return applyGenerationResult({ nodeId, taskId: generation.id, generation })
    }
    await watchGeneration(nodeId, generation.id)
    return snapshot()
  }

  async function watchGeneration(nodeId: WorkflowNode['id'], taskId: Generation['id']) {
    if (interrupted) return
    const key = subscriptionKey(nodeId, taskId)
    if (subscriptions.has(key)) return

    subscriptions.set(key, { nodeId, taskId, stop: () => undefined })
    try {
      const run = requireWorkflow()
      const expectation = generationExpectationForNode(run, findNode(run, nodeId))
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

  function applyGenerationResult({
    nodeId,
    taskId,
    generation,
  }: ApplyGenerationResultInput): Promise<WorkflowRun> {
    if (interrupted) return Promise.resolve(snapshot())
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
      return applyCompletedGeneration(run, node, reference, generation)
    })
  }

  function applyCompletedGeneration(
    run: WorkflowRun,
    node: WorkflowNode,
    reference: WorkflowGenerationRef,
    generation: Generation,
  ): WorkflowRun {
    if (reference.role === 'character_template') {
      if (
        node.type !== 'character-template' ||
        generation.type !== 'character_template' ||
        generation.result?.type !== 'character_template' ||
        generation.result.images.length !== IMAGE_CANDIDATE_COUNT
      ) {
        return failNode(run, node, '角色候选图结果格式无效')
      }
      return replaceNode(run, { ...node, phase: 'selecting', error: null })
    }

    if (reference.role === 'first_frame') {
      if (
        node.type !== 'action-first-frame' ||
        generation.type !== 'first_frame' ||
        generation.result?.type !== 'first_frame' ||
        generation.result.images.length !== IMAGE_CANDIDATE_COUNT ||
        generation.result.images.some((image) => !image.url)
      ) {
        return failNode(run, node, '动作首帧结果格式无效')
      }
      return replaceNode(run, { ...node, phase: 'selecting', error: null })
    }

    if (
      node.type !== 'action-full-frame' ||
      generation.type !== 'complete_animation' ||
      generation.result?.type !== 'complete_animation'
    ) {
      return failNode(run, node, '完整动画结果格式无效')
    }
    if (generation.result.frames.length !== COMPLETE_ANIMATION_FRAME_COUNT) {
      return failNode(
        run,
        node,
        `完整动画应为 ${COMPLETE_ANIMATION_FRAME_COUNT} 帧，实际为 ${generation.result.frames.length} 帧`,
      )
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
      const reference = node.generations.find((item) => item.role === role)
      return reference ? [{ nodeId: node.id, taskId: reference.taskId }] : []
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
    const run = requireWorkflow()
    const node = findNode(run, nodeId)
    const reference = node.generations.find((item) => item.role === role)
    const expectation = generationExpectationForNode(run, node)
    return reference && expectation
      ? generationApis.get(run.projectId, reference.taskId, expectation)
      : null
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
    getWorkflow,
    subscribe,
    setCharacterName: asCommand(setCharacterName),
    addAction: asCommand(addAction),
    generateCharacterTemplate: asCommand(generateCharacterTemplate),
    bindCharacter: asCommand(bindCharacter),
    updateCharacterSetup: asCommand(updateCharacterSetup),
    acceptUploadedCharacterTemplate: asCommand(acceptUploadedCharacterTemplate),
    confirmCharacterTemplate: asCommand(confirmCharacterTemplate),
    generateFirstFrame: asCommand(generateFirstFrame),
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
    dispose,
  }
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
  if (node.type === 'character-template') return 'character_template'
  if (node.type === 'action-first-frame') return 'first_frame'
  if (node.type === 'action-full-frame') return 'complete_animation'
  return null
}

function generationExpectationForNode(
  run: WorkflowRun,
  node: WorkflowNode,
): GenerationExpectation | null {
  if (node.type === 'character-template') return { type: 'character_template' }
  if (node.type === 'action-first-frame') {
    return { type: 'first_frame', actionType: node.input.type }
  }
  if (node.type === 'action-full-frame') {
    const methodNode = findSingleDependencyNode(run, node, 'action-generation-method')
    const firstFrameNode = findSingleDependencyNode(run, methodNode, 'action-first-frame')
    return { type: 'complete_animation', actionType: firstFrameNode.input.type }
  }
  return null
}

function assertGenerationRoleMatchesNode(node: WorkflowNode, role: WorkflowGenerationRole) {
  if (generationRoleForNode(node) !== role) {
    throw new Error(`生成任务 ${role} 不能绑定到 ${node.type} 节点`)
  }
}

function attachGenerationReference(
  node: WorkflowNode,
  taskId: Generation['id'],
  role: WorkflowGenerationRole,
): WorkflowNode {
  assertGenerationRoleMatchesNode(node, role)
  const update = {
    phase: 'generating' as const,
    generations: [...node.generations, { taskId, role }],
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

function nonEmpty(value: string, field: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} 不能为空`)
  return normalized
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
