import {
  characterApis,
  createGenerationApis,
  createMediaApis,
  projectApis,
  workflowRunApis,
  type Action,
  type CharacterApis,
  type GenerationApis,
  type MediaReference,
  type Project,
  type ProjectApis,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowRunApis,
} from '@/entities'
import { getApiAccessToken, recoverApiUnauthorized, resolveApiBaseUrl } from '@/shared/api'
import { createEventStreamSubscriber } from '@/shared/api/stream'
import { createWorkflowController, type WorkflowController } from '@/features/workflow-controller'

/** 页面不直接拼接后端字段；只负责准备项目约束。 */
export type PrepareQuickStartProject = (
  prompt: string,
) => Promise<Pick<Project, 'id' | 'spriteSize'>>

export interface QuickStartFrame {
  index: number
  imageUrl: string
  durationMs: number | null
}

export interface QuickStartMediaApis {
  upload(file: File, category: 'reference-image', signal?: AbortSignal): Promise<MediaReference>
}

export interface QuickStartService {
  readonly unavailableReason: string | null
  start(prompt: string): Promise<WorkflowRun>
  startWithUploadedTemplate(
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRun>
  continueWithUploadedTemplate(
    runId: WorkflowRun['id'],
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRun>
  startAction(
    target: { characterId: string; outfitId: string },
    actionDescription: string,
  ): Promise<WorkflowRun>
  peekWorkflow(runId: WorkflowRun['id']): WorkflowRun | null
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  interrupt(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  confirmCandidate(
    runId: WorkflowRun['id'],
    selectedImageUrl: string,
    actionDescription?: string,
  ): Promise<WorkflowRun>
  /** 读取当前 Action 首帧生成任务的候选帧。 */
  getFirstFrameCandidates(runId: WorkflowRun['id']): Promise<readonly QuickStartFrame[]>
  /** 确认首帧后，Quick Start 自动选择已接入的生成路线并提交完整动画。 */
  confirmFirstFrame(runId: WorkflowRun['id'], selectedImageUrl: string): Promise<WorkflowRun>
  approveReview(runId: WorkflowRun['id']): Promise<WorkflowRun>
  getCharacterInfo(runId: WorkflowRun['id']): { characterId: string; outfitId: string } | null
  resolveCharacterInfo(
    runId: WorkflowRun['id'],
  ): Promise<{ characterId: string; outfitId: string } | null>
  getTemplateCandidates(runId: WorkflowRun['id']): Promise<readonly string[]>
  getActionFrames(runId: WorkflowRun['id']): Promise<readonly QuickStartFrame[]>
}

export interface CreateQuickStartServiceOptions {
  workflowRunApis: WorkflowRunApis
  generationApis: GenerationApis
  prepareProject: PrepareQuickStartProject
  characterApis?: CharacterApis
  mediaApis?: QuickStartMediaApis
  onAsyncError?: (error: Error) => void
}

/**
 * Quick Start 与 Workflow Editor 都推进同一份节点图；这里仅把自然语言输入翻译为连续命令。
 * Controller 按 run 实例化，避免一个全局内存对象误把两个角色的流程混在一起。
 */
export function createQuickStartService({
  workflowRunApis,
  generationApis,
  prepareProject,
  characterApis,
  mediaApis,
  onAsyncError = (error) => console.error('[quick-start] 异步工作流错误', error),
}: CreateQuickStartServiceOptions): QuickStartService {
  const controllers = new Map<WorkflowRun['id'], WorkflowController>()
  const loading = new Map<WorkflowRun['id'], Promise<WorkflowController>>()
  const autoAdvancers = new Map<WorkflowRun['id'], () => void>()
  /** 服务层也去重，不能只依赖页面禁用按钮防止重复确认候选。 */
  const candidateCommands = new Map<WorkflowRun['id'], Promise<WorkflowRun>>()

  function createController(workflow?: WorkflowRun): WorkflowController {
    return createWorkflowController({ workflow, workflowRunApis, generationApis, onAsyncError })
  }

  async function getController(runId: WorkflowRun['id']): Promise<WorkflowController> {
    const cached = controllers.get(runId)
    if (cached) return cached
    const pending = loading.get(runId)
    if (pending) return pending

    const request = workflowRunApis
      .get(runId)
      .then((workflow) => {
        const controller = createController(workflow)
        controllers.set(workflow.id, controller)
        return controller
      })
      .finally(() => loading.delete(runId))
    loading.set(runId, request)
    return request
  }

  function remember(controller: WorkflowController): WorkflowRun {
    const workflow = controller.getWorkflow()
    controllers.set(workflow.id, controller)
    return workflow
  }

  function setupNode(run: WorkflowRun) {
    const node = run.nodes.find((item) => item.type === 'character-setup')
    if (!node || node.type !== 'character-setup') throw new Error('WorkflowRun 缺少角色设定节点')
    return node
  }

  function templateNode(run: WorkflowRun) {
    const node = run.nodes.find((item) => item.type === 'character-template')
    if (!node || node.type !== 'character-template') throw new Error('WorkflowRun 缺少角色母版节点')
    return node
  }

  function latestActionFirstFrame(run: WorkflowRun) {
    return (
      run.nodes.findLast((item) => item.type === 'action-first-frame' && !item.deletedAt) ?? null
    )
  }

  function latestFullFrame(run: WorkflowRun) {
    return (
      run.nodes.findLast((item) => item.type === 'action-full-frame' && !item.deletedAt) ?? null
    )
  }

  function findReview(run: WorkflowRun, fullFrameNodeId: string) {
    return (
      run.nodes.find(
        (item) =>
          item.type === 'review' &&
          !item.deletedAt &&
          item.dependsOnNodeIds.includes(fullFrameNodeId),
      ) ?? null
    )
  }

  function workflowNodes(
    prompt: string,
    referenceMedia: readonly MediaReference[] = [],
  ): WorkflowNode[] {
    return [
      {
        id: 'character-setup',
        type: 'character-setup',
        status: 'active',
        phase: 'configuring',
        dependsOnNodeIds: [],
        generations: [],
        error: null,
        input: { prompt, referenceMedia },
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
    ]
  }

  function existingCharacterNodes(
    characterId: string,
    templateUrl: string,
    prompt: string,
  ): WorkflowNode[] {
    return [
      {
        id: 'character-setup',
        type: 'character-setup',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: [],
        generations: [],
        error: null,
        input: { characterId, prompt, referenceMedia: [templateUrl as MediaReference] },
      },
      {
        id: 'character-template',
        type: 'character-template',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['character-setup'],
        generations: [],
        error: null,
        selectedImageUrl: templateUrl,
      },
    ]
  }

  async function createRun(projectId: string, nodes: WorkflowNode[]): Promise<WorkflowController> {
    const controller = createController()
    await controller.create({ projectId, nodes })
    remember(controller)
    return controller
  }

  async function prepareAction(
    controller: WorkflowController,
    characterId: string,
    outfitId: string,
    actionDescription: string,
  ) {
    const name = actionDescription.trim() || '待机'
    const type = actionDescription.trim() ? 'custom' : 'idle'
    await controller.addAction({
      input: { outfitId, name, type, prompt: actionDescription.trim() || null, fps: 12 },
    })
    const run = controller.getWorkflow()
    const firstFrame = latestActionFirstFrame(run)
    if (!firstFrame || firstFrame.type !== 'action-first-frame') {
      throw new Error('新增动作后没有找到首帧节点')
    }
    await controller.generateFirstFrame(firstFrame.id, { characterId, referenceMedia: [] })
    ensureAutomaticActionAdvance(run.id)
  }

  async function persistCharacterTemplate(
    controller: WorkflowController,
    selectedImageUrl: string,
  ): Promise<{ characterId: string; outfitId: string }> {
    if (!characterApis) throw new Error('角色服务尚未配置，不能确认角色母版')
    const run = controller.getWorkflow()
    const setup = setupNode(run)
    const existingCharacterId = setup.input.characterId
    if (existingCharacterId) {
      const existing = await characterApis.get(existingCharacterId)
      const outfit = existing.outfits.find((item) => item.previewUrl === selectedImageUrl)
      if (!outfit) throw new Error('已绑定角色中没有与当前母版对应的造型')
      return { characterId: existing.id, outfitId: outfit.id }
    }

    const character = await characterApis.create({
      projectId: run.projectId,
      workflowRunId: run.id,
      name: setup.input.prompt.trim().slice(0, 32) || '未命名角色',
      description: setup.input.prompt,
      referenceImageUrl: selectedImageUrl,
    })
    const outfitId = `outfit-${Date.now().toString(36)}`
    try {
      await characterApis.update({
        ...character,
        outfits: [
          ...character.outfits,
          {
            id: outfitId,
            characterId: character.id,
            name: '默认造型',
            description: null,
            previewUrl: selectedImageUrl,
            actions: [],
          },
        ],
      })
      await controller.bindCharacter(setup.id, character.id)
    } catch (cause) {
      // Character 与 Run 的绑定没有服务端事务；后续两步失败时尽力清掉刚建的孤儿角色。
      try {
        await characterApis.remove(character.id)
      } catch (rollbackCause) {
        onAsyncError(
          rollbackCause instanceof Error ? rollbackCause : new Error('创建角色后的回滚失败'),
        )
      }
      throw cause
    }
    return { characterId: character.id, outfitId }
  }

  function getCharacterInfoForRun(runId: WorkflowRun['id']) {
    const run = controllers.get(runId)?.getWorkflow()
    if (!run) return null
    const characterId = setupNode(run).input.characterId
    const firstFrame = latestActionFirstFrame(run)
    if (!characterId || !firstFrame || firstFrame.type !== 'action-first-frame') return null
    return { characterId, outfitId: firstFrame.input.outfitId }
  }

  function ensureAutomaticActionAdvance(runId: WorkflowRun['id']) {
    if (autoAdvancers.has(runId)) return
    let advancing = false
    let stop: () => void = () => undefined

    const advance = (run: WorkflowRun) => {
      if (advancing) return
      const method = run.nodes.find(
        (node) =>
          node.type === 'action-generation-method' && !node.deletedAt && node.status === 'active',
      )
      if (!method || method.type !== 'action-generation-method' || method.phase !== 'selecting')
        return
      const firstFrame = run.nodes.find(
        (node) => node.type === 'action-first-frame' && method.dependsOnNodeIds.includes(node.id),
      )
      const characterId = setupNode(run).input.characterId
      if (
        !characterId ||
        !firstFrame ||
        firstFrame.type !== 'action-first-frame' ||
        firstFrame.status !== 'passed' ||
        !firstFrame.selectedFirstFrameUrl
      ) {
        return
      }
      const fullFrame = run.nodes.find(
        (node) => node.type === 'action-full-frame' && node.dependsOnNodeIds.includes(method.id),
      )
      if (!fullFrame || fullFrame.type !== 'action-full-frame') return

      advancing = true
      void getController(run.id)
        .then(async (controller) => {
          await controller.selectActionGenerationMethod(method.id, 'video-cropping')
          await controller.generateCompleteAnimation(fullFrame.id, {
            characterId,
            referenceMedia: [],
          })
        })
        .catch(onAsyncError)
        .finally(() => {
          advancing = false
          const latest = controllers.get(run.id)?.getWorkflow()
          if (latest) advance(latest)
        })
    }

    void getController(runId)
      .then((controller) => {
        stop = controller.subscribe(advance)
        advance(controller.getWorkflow())
      })
      .catch(onAsyncError)
    autoAdvancers.set(runId, () => {
      stop()
      autoAdvancers.delete(runId)
    })
  }

  async function appendActionForCharacter(
    target: { characterId: string; outfitId: string },
    actionDescription: string,
  ) {
    if (!characterApis) throw new Error('角色服务尚未配置，不能增加动作')
    const character = await characterApis.get(target.characterId)
    const outfit = character.outfits.find((item) => item.id === target.outfitId)
    if (!outfit?.previewUrl) throw new Error('当前造型没有可用于生成动作的角色母版')

    if (!workflowRunApis.listByProject) {
      throw new Error('工作流列表服务尚未配置，不能为现有角色增加动作')
    }
    const listed = await workflowRunApis.listByProject(character.projectId, {
      page: 1,
      pageSize: 100,
    })
    const existing = listed.items.find((run) => setupNode(run).input.characterId === character.id)
    const controller = existing
      ? await getController(existing.id)
      : await createRun(
          character.projectId,
          existingCharacterNodes(
            character.id,
            outfit.previewUrl,
            character.description ?? actionDescription,
          ),
        )
    await prepareAction(controller, character.id, outfit.id, actionDescription)
    return controller.getWorkflow()
  }

  return {
    unavailableReason: null,

    async start(prompt) {
      const normalizedPrompt = prompt.trim()
      if (!normalizedPrompt) throw new Error('请先描述想要创建的角色')
      const project = await prepareProject(normalizedPrompt)
      const controller = await createRun(project.id, workflowNodes(normalizedPrompt))
      await controller.generateCharacterTemplate('character-setup', {
        spriteWidth: project.spriteSize.width,
        spriteHeight: project.spriteSize.height,
      })
      return controller.getWorkflow()
    },

    async startWithUploadedTemplate(file, actionDescription, signal) {
      if (!mediaApis) throw new Error('媒体上传服务尚未配置，不能使用角色母版')
      const prompt = actionDescription.trim() || file.name.trim()
      if (!prompt) throw new Error('请提供动作描述或有效的图片文件')
      const project = await prepareProject(prompt)
      const templateReference = await mediaApis.upload(file, 'reference-image', signal)
      const controller = await createRun(project.id, workflowNodes(prompt, [templateReference]))
      await controller.updateCharacterSetup('character-setup', {
        prompt,
        referenceMedia: [templateReference],
      })
      await controller.acceptUploadedCharacterTemplate('character-setup', templateReference)
      const target = await persistCharacterTemplate(controller, templateReference)
      await prepareAction(controller, target.characterId, target.outfitId, actionDescription)
      return controller.getWorkflow()
    },

    async continueWithUploadedTemplate(runId, file, actionDescription, signal) {
      if (!mediaApis) throw new Error('媒体上传服务尚未配置，不能使用角色母版')
      const controller = await getController(runId)
      const run = controller.getWorkflow()
      const template = templateNode(run)
      if (template.status !== 'active' || template.phase !== 'selecting') {
        throw new Error('当前角色母版节点不能直接替换图片，请先从角色母版节点重做')
      }
      const templateReference = await mediaApis.upload(file, 'reference-image', signal)
      await controller.confirmCharacterTemplate(template.id, templateReference)
      const target = await persistCharacterTemplate(controller, templateReference)
      await prepareAction(controller, target.characterId, target.outfitId, actionDescription)
      return controller.getWorkflow()
    },

    startAction: appendActionForCharacter,

    peekWorkflow(runId) {
      return controllers.get(runId)?.getWorkflow() ?? null
    },

    subscribe(runId, listener) {
      let stopped = false
      let unsubscribe: () => void = () => undefined
      void getController(runId)
        .then((controller) => {
          if (!stopped) unsubscribe = controller.subscribe(listener)
        })
        .catch(onAsyncError)
      return () => {
        stopped = true
        unsubscribe()
      }
    },

    async resume(runId) {
      const controller = await getController(runId)
      await controller.resume()
      ensureAutomaticActionAdvance(runId)
      return controller.getWorkflow()
    },

    async interrupt(runId) {
      const controller = await getController(runId)
      await controller.interrupt()
      autoAdvancers.get(runId)?.()
      return controller.getWorkflow()
    },

    confirmCandidate(runId, selectedImageUrl, actionDescription) {
      const active = candidateCommands.get(runId)
      if (active) return active
      const command = (async () => {
        const controller = await getController(runId)
        const template = templateNode(controller.getWorkflow())
        await controller.confirmCharacterTemplate(template.id, selectedImageUrl)
        const target = await persistCharacterTemplate(controller, selectedImageUrl)
        await prepareAction(
          controller,
          target.characterId,
          target.outfitId,
          actionDescription ?? '',
        )
        return controller.getWorkflow()
      })().finally(() => {
        if (candidateCommands.get(runId) === command) candidateCommands.delete(runId)
      })
      candidateCommands.set(runId, command)
      return command
    },

    async getFirstFrameCandidates(runId) {
      const controller = await getController(runId)
      const firstFrame = latestActionFirstFrame(controller.getWorkflow())
      if (!firstFrame || firstFrame.type !== 'action-first-frame') return []
      const generation = await controller.getGeneration(firstFrame.id, 'first_frame')
      return generation?.type === 'first_frame' && generation.result?.type === 'first_frame'
        ? [{ index: 0, imageUrl: generation.result.image.url, durationMs: null }]
        : []
    },

    async confirmFirstFrame(runId, selectedImageUrl) {
      const controller = await getController(runId)
      const firstFrame = latestActionFirstFrame(controller.getWorkflow())
      if (!firstFrame || firstFrame.type !== 'action-first-frame') {
        throw new Error('当前运行没有可确认的动作首帧')
      }
      await controller.confirmFirstFrame(firstFrame.id, selectedImageUrl)
      ensureAutomaticActionAdvance(runId)
      return controller.getWorkflow()
    },

    async approveReview(runId) {
      if (!characterApis) throw new Error('角色服务尚未配置，不能导入 Playtest')
      const controller = await getController(runId)
      const run = controller.getWorkflow()
      const fullFrame = latestFullFrame(run)
      if (!fullFrame || fullFrame.type !== 'action-full-frame')
        throw new Error('没有可审核的完整动画')
      const review = findReview(run, fullFrame.id)
      if (!review) throw new Error('完整动画没有关联审核节点')
      await controller.approveReview(review.id)

      const generation = await controller.getGeneration(fullFrame.id, 'complete_animation')
      if (
        !generation ||
        generation.status !== 'completed' ||
        generation.type !== 'complete_animation' ||
        generation.result?.type !== 'complete_animation'
      ) {
        throw new Error('完整动画结果尚未就绪')
      }
      const info = getCharacterInfoForRun(runId)
      if (!info) throw new Error('WorkflowRun 缺少角色或造型绑定')
      const firstFrame = latestActionFirstFrame(controller.getWorkflow())
      if (!firstFrame || firstFrame.type !== 'action-first-frame')
        throw new Error('完整动画缺少动作定义')
      const character = await characterApis.get(info.characterId)
      const action: Action = {
        id: fullFrame.id,
        outfitId: info.outfitId,
        name: firstFrame.input.name,
        loop: true,
        type: firstFrame.input.type,
        fps: firstFrame.input.fps,
        frameCount: generation.result.frames.length,
        frames: generation.result.frames.map((frame) => ({
          index: frame.index,
          imageUrl: frame.url,
          durationMs: frame.durationMs,
        })),
      }
      await characterApis.update({
        ...character,
        outfits: character.outfits.map((outfit) =>
          outfit.id === info.outfitId
            ? {
                ...outfit,
                actions: [...outfit.actions.filter((item) => item.id !== action.id), action],
              }
            : outfit,
        ),
      })
      return controller.getWorkflow()
    },

    getCharacterInfo(runId) {
      return getCharacterInfoForRun(runId)
    },

    async resolveCharacterInfo(runId) {
      const controller = await getController(runId)
      const direct = getCharacterInfoForRun(runId)
      if (direct) return direct
      if (!characterApis) return null
      const page = await characterApis.listByProject(controller.getWorkflow().projectId)
      const character = page.items.at(-1)
      const outfit = character?.outfits.at(0)
      return character && outfit ? { characterId: character.id, outfitId: outfit.id } : null
    },

    async getTemplateCandidates(runId) {
      const controller = await getController(runId)
      const template = templateNode(controller.getWorkflow())
      const generation = await controller.getGeneration(template.id, 'character_template')
      return generation?.type === 'character_template' &&
        generation.result?.type === 'character_template'
        ? generation.result.images.map((image) => image.url)
        : []
    },

    async getActionFrames(runId) {
      const controller = await getController(runId)
      const fullFrame = latestFullFrame(controller.getWorkflow())
      if (!fullFrame || fullFrame.type !== 'action-full-frame') return []
      const generation = await controller.getGeneration(fullFrame.id, 'complete_animation')
      return generation?.type === 'complete_animation' &&
        generation.result?.type === 'complete_animation'
        ? generation.result.frames.map((frame) => ({
            index: frame.index,
            imageUrl: frame.url,
            durationMs: frame.durationMs,
          }))
        : []
    },
  }
}

export function createAutoPrepareProject(projectApis: ProjectApis): PrepareQuickStartProject {
  return async (prompt) => {
    const base = prompt.length > 16 ? `${prompt.slice(0, 16)}…` : prompt
    const name = `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const project = await projectApis.create({
      name,
      perspective: 'side',
      directionalMovement: 'single',
      spriteSize: { width: 256, height: 256 },
    })
    return { id: project.id, spriteSize: project.spriteSize }
  }
}

export interface CreateRealQuickStartServiceOptions {
  projectApis: ProjectApis
  characterApis: CharacterApis
  generationApis: GenerationApis
  mediaApis: QuickStartMediaApis
  workflowRunApis: WorkflowRunApis
  onAsyncError?: (error: Error) => void
}

export function createRealQuickStartService({
  projectApis,
  characterApis,
  generationApis,
  mediaApis,
  workflowRunApis,
  onAsyncError,
}: CreateRealQuickStartServiceOptions): QuickStartService {
  return createQuickStartService({
    workflowRunApis,
    generationApis,
    prepareProject: createAutoPrepareProject(projectApis),
    characterApis,
    mediaApis,
    onAsyncError,
  })
}

function generationRequest(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const accessToken = getApiAccessToken()
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(url, { ...init, headers, credentials: 'include' })
}

const generationApis = createGenerationApis({
  baseUrl: resolveApiBaseUrl(),
  transport: {
    request: generationRequest,
    stream: createEventStreamSubscriber({
      getAccessToken: getApiAccessToken,
      recoverUnauthorized: recoverApiUnauthorized,
    }),
  },
})

/** Quick Start 的生产实例；身份仅由会话 token 提供。 */
export const quickStartService = createRealQuickStartService({
  projectApis,
  characterApis,
  generationApis,
  mediaApis: createMediaApis(),
  workflowRunApis,
})
