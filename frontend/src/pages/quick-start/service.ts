import {
  characterApis,
  createGenerationApis,
  createMediaApis,
  projectApis,
  ProjectNameConflictError,
  workflowRunApis,
  type Action,
  type Character,
  type CharacterApis,
  type GenerationApis,
  type Generation,
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
import { createProgressiveExportModel, type ExportPackageModel } from '@/features/export-package'

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

export interface QuickStartSession {
  readonly runId: WorkflowRun['id']
  getWorkflow(): WorkflowRun
  subscribe(listener: (run: WorkflowRun) => void): () => void
  resume(): Promise<WorkflowRun>
  interrupt(): Promise<WorkflowRun>
  dispose(): void
  continueWithUploadedTemplate(
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRun>
  confirmCandidate(selectedImageUrl: string, actionDescription?: string): Promise<WorkflowRun>
  /** 读取当前 Action 首帧生成任务的候选帧。 */
  getFirstFrameCandidates(): Promise<readonly QuickStartFrame[]>
  /** 确认首帧后，Quick Start 自动选择已接入的生成路线并提交完整动画。 */
  confirmFirstFrame(selectedImageUrl: string): Promise<WorkflowRun>
  approveReview(): Promise<WorkflowRun>
  getCharacterInfo(): { characterId: string; outfitId: string } | null
  resolveCharacterInfo(): Promise<{ characterId: string; outfitId: string } | null>
  getTemplateCandidates(): Promise<readonly string[]>
  getActionFrames(): Promise<readonly QuickStartFrame[]>
  /** 按当前 Run 完成度装配统一导出包；角色母版尚未确认时返回 null。 */
  getExportModel(): Promise<ExportPackageModel | null>
}

export interface QuickStartEntryService {
  readonly unavailableReason: string | null
  start(prompt: string): Promise<QuickStartSession>
  startWithUploadedTemplate(
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
  ): Promise<QuickStartSession>
  startAction(
    target: { characterId: string; outfitId: string },
    actionDescription: string,
  ): Promise<QuickStartSession>
  open(runId: WorkflowRun['id']): Promise<QuickStartSession>
}

export interface CreateQuickStartServiceOptions {
  workflowRunApis: WorkflowRunApis
  generationApis: GenerationApis
  prepareProject: PrepareQuickStartProject
  projectApis?: Pick<ProjectApis, 'get'>
  characterApis?: CharacterApis
  mediaApis?: QuickStartMediaApis
  onAsyncError?: (error: Error) => void
}

type GeneratableActionType = 'idle' | 'walk' | 'jump' | 'attack' | 'custom'

function inferGeneratableActionType(description: string): GeneratableActionType {
  const normalized = description.trim().toLowerCase()
  if (!normalized || /^(待机|站立|呼吸|idle|stand|breathe)$/u.test(normalized)) return 'idle'
  if (/^(跳|跃|跳跃|jump|leap|hop)$/u.test(normalized)) return 'jump'
  if (/^(走|步行|跑|跑步|冲刺|walk|run|sprint)$/u.test(normalized)) return 'walk'
  if (/^(攻击|attack)$/u.test(normalized)) return 'attack'
  return 'custom'
}

/**
 * Quick Start 与 Workflow Editor 都推进同一份节点图；这里仅把自然语言输入翻译为连续命令。
 * Controller 按 run 实例化，避免一个全局内存对象误把两个角色的流程混在一起。
 */
export function createQuickStartService({
  workflowRunApis,
  generationApis,
  prepareProject,
  projectApis: exportProjectApis,
  characterApis,
  mediaApis,
  onAsyncError = (error) => console.error('[quick-start] 异步工作流错误', error),
}: CreateQuickStartServiceOptions): QuickStartEntryService {
  function createController(workflow?: WorkflowRun): WorkflowController {
    return createWorkflowController({ workflow, workflowRunApis, generationApis, onAsyncError })
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
    return controller
  }

  async function prepareAction(
    controller: WorkflowController,
    characterId: string,
    outfitId: string,
    actionDescription: string,
  ) {
    const name = actionDescription.trim() || '待机'
    const type = inferGeneratableActionType(actionDescription)
    await controller.addAction({
      input: { outfitId, name, type, prompt: actionDescription.trim() || null, fps: 12 },
    })
    const run = controller.getWorkflow()
    const firstFrame = latestActionFirstFrame(run)
    if (!firstFrame || firstFrame.type !== 'action-first-frame') {
      throw new Error('新增动作后没有找到首帧节点')
    }
    await controller.generateFirstFrame(firstFrame.id, { characterId, referenceMedia: [] })
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

  function getCharacterInfo(controller: WorkflowController) {
    const run = controller.getWorkflow()
    const characterId = setupNode(run).input.characterId
    const firstFrame = latestActionFirstFrame(run)
    if (!characterId || !firstFrame || firstFrame.type !== 'action-first-frame') return null
    return { characterId, outfitId: firstFrame.input.outfitId }
  }

  async function resolveCharacterInfo(controller: WorkflowController) {
    const direct = getCharacterInfo(controller)
    if (direct) return direct
    if (!characterApis) return null

    const run = controller.getWorkflow()
    const firstFrame = latestActionFirstFrame(run)
    if (!firstFrame || firstFrame.type !== 'action-first-frame') return null
    const matches: Character[] = []
    let page = 1
    let pageSize: number | undefined
    while (true) {
      const result = await characterApis.listByProject(run.projectId, { page, pageSize })
      matches.push(...result.items.filter((character) => character.workflowRunId === run.id))
      if (matches.length > 1) return null
      if (result.items.length === 0 || page * result.pageSize >= result.total) break
      page += 1
      pageSize = result.pageSize
    }
    if (matches.length !== 1) return null
    const character = matches[0]!
    const outfit = character.outfits.find((item) => item.id === firstFrame.input.outfitId)
    return outfit ? { characterId: character.id, outfitId: outfit.id } : null
  }

  function startAutomaticActionAdvance(controller: WorkflowController): () => void {
    let advancing = false

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
      void (async () => {
        await controller.selectActionGenerationMethod(method.id, 'video-cropping')
        await controller.generateCompleteAnimation(fullFrame.id, {
          characterId,
          referenceMedia: [],
        })
      })()
        .catch(onAsyncError)
        .finally(() => {
          advancing = false
          advance(controller.getWorkflow())
        })
    }

    const stop = controller.subscribe(advance)
    advance(controller.getWorkflow())
    return stop
  }

  function createSession(controller: WorkflowController): QuickStartSession {
    let stopAutomaticAdvance: (() => void) | null = null
    let candidateCommand: Promise<WorkflowRun> | null = null
    let disposed = false

    const ensureAutomaticAdvance = () => {
      stopAutomaticAdvance ??= startAutomaticActionAdvance(controller)
    }

    return {
      runId: controller.getWorkflow().id,
      getWorkflow: () => controller.getWorkflow(),
      subscribe: (listener) => controller.subscribe(listener),
      async resume() {
        disposed = false
        await controller.resume()
        if (!disposed) ensureAutomaticAdvance()
        return controller.getWorkflow()
      },
      async interrupt() {
        await controller.interrupt()
        stopAutomaticAdvance?.()
        stopAutomaticAdvance = null
        return controller.getWorkflow()
      },
      dispose() {
        disposed = true
        stopAutomaticAdvance?.()
        stopAutomaticAdvance = null
        controller.dispose()
      },
      async continueWithUploadedTemplate(file, actionDescription, signal) {
        if (!mediaApis) throw new Error('媒体上传服务尚未配置，不能使用角色母版')
        const run = controller.getWorkflow()
        const template = templateNode(run)
        if (template.status !== 'active' || template.phase !== 'selecting') {
          throw new Error('当前角色母版节点不能直接替换图片，请先从角色母版节点重做')
        }
        const templateReference = await mediaApis.upload(file, 'reference-image', signal)
        await controller.confirmCharacterTemplate(template.id, templateReference)
        const target = await persistCharacterTemplate(controller, templateReference)
        await prepareAction(controller, target.characterId, target.outfitId, actionDescription)
        ensureAutomaticAdvance()
        return controller.getWorkflow()
      },
      confirmCandidate(selectedImageUrl, actionDescription) {
        if (candidateCommand) return candidateCommand
        const command = (async () => {
          const template = templateNode(controller.getWorkflow())
          await controller.confirmCharacterTemplate(template.id, selectedImageUrl)
          const target = await persistCharacterTemplate(controller, selectedImageUrl)
          await prepareAction(
            controller,
            target.characterId,
            target.outfitId,
            actionDescription ?? '',
          )
          ensureAutomaticAdvance()
          return controller.getWorkflow()
        })().finally(() => {
          if (candidateCommand === command) candidateCommand = null
        })
        candidateCommand = command
        return command
      },
      async getFirstFrameCandidates() {
        const firstFrame = latestActionFirstFrame(controller.getWorkflow())
        if (!firstFrame || firstFrame.type !== 'action-first-frame') return []
        const generation = await controller.getGeneration(firstFrame.id, 'first_frame')
        return generation?.type === 'first_frame' && generation.result?.type === 'first_frame'
          ? [{ index: 0, imageUrl: generation.result.image.url, durationMs: null }]
          : []
      },
      async confirmFirstFrame(selectedImageUrl) {
        const firstFrame = latestActionFirstFrame(controller.getWorkflow())
        if (!firstFrame || firstFrame.type !== 'action-first-frame') {
          throw new Error('当前运行没有可确认的动作首帧')
        }
        await controller.confirmFirstFrame(firstFrame.id, selectedImageUrl)
        ensureAutomaticAdvance()
        return controller.getWorkflow()
      },
      async approveReview() {
        if (!characterApis) throw new Error('角色服务尚未配置，不能导入预览台')
        const run = controller.getWorkflow()
        const fullFrame = latestFullFrame(run)
        if (!fullFrame || fullFrame.type !== 'action-full-frame') {
          throw new Error('没有可审核的完整动画')
        }
        const review = findReview(run, fullFrame.id)
        if (!review) throw new Error('完整动画没有关联审核节点')
        if (review.status !== 'active' && review.status !== 'passed') {
          throw new Error('完整动画当前不能通过审核')
        }

        const generation = await controller.getGeneration(fullFrame.id, 'complete_animation')
        if (
          !generation ||
          generation.status !== 'completed' ||
          generation.type !== 'complete_animation' ||
          generation.result?.type !== 'complete_animation'
        ) {
          throw new Error('完整动画结果尚未就绪')
        }
        const info = await resolveCharacterInfo(controller)
        if (!info) throw new Error('WorkflowRun 缺少角色或造型绑定')
        const firstFrame = latestActionFirstFrame(controller.getWorkflow())
        if (!firstFrame || firstFrame.type !== 'action-first-frame') {
          throw new Error('完整动画缺少动作定义')
        }
        const character = await characterApis.get(info.characterId)
        if (!character.outfits.some((outfit) => outfit.id === info.outfitId)) {
          throw new Error('角色资产中没有与当前动作绑定的造型')
        }
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
        if (review.status === 'active') await controller.approveReview(review.id)
        return controller.getWorkflow()
      },
      getCharacterInfo: () => getCharacterInfo(controller),
      resolveCharacterInfo: () => resolveCharacterInfo(controller),
      async getTemplateCandidates() {
        const template = templateNode(controller.getWorkflow())
        const generation = await controller.getGeneration(template.id, 'character_template')
        return generation?.type === 'character_template' &&
          generation.result?.type === 'character_template'
          ? generation.result.images.map((image) => image.url)
          : []
      },
      async getActionFrames() {
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
      async getExportModel() {
        if (!characterApis || !exportProjectApis) return null
        const info = getCharacterInfo(controller) ?? (await resolveCharacterInfo(controller))
        if (!info) return null
        const run = controller.getWorkflow()
        const [project, character] = await Promise.all([
          exportProjectApis.get(run.projectId),
          characterApis.get(info.characterId),
        ])
        const generations = await Promise.all(
          run.nodes
            .filter((node) => node.type === 'action-full-frame' && !node.deletedAt)
            .map((node) => controller.getGeneration(node.id, 'complete_animation')),
        )
        return createProgressiveExportModel({
          project,
          character,
          outfitId: info.outfitId,
          run,
          generations: generations.filter(
            (generation): generation is Generation => generation !== null,
          ),
        })
      },
    }
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
      ? createController(existing)
      : await createRun(
          character.projectId,
          existingCharacterNodes(
            character.id,
            outfit.previewUrl,
            character.description ?? actionDescription,
          ),
        )
    await prepareAction(controller, character.id, outfit.id, actionDescription)
    return createSession(controller)
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
      return createSession(controller)
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
      return createSession(controller)
    },

    startAction: appendActionForCharacter,

    async open(runId) {
      return createSession(createController(await workflowRunApis.get(runId)))
    },
  }
}

export function createAutoPrepareProject(projectApis: ProjectApis): PrepareQuickStartProject {
  return async (prompt) => {
    const normalizedPrompt = prompt.trim().replace(/\s+/gu, ' ') || '未命名项目'
    let lastConflict: unknown

    for (let sequence = 1; sequence <= 5; sequence += 1) {
      // 首次名称不预留编号空间；只有重名时才缩短前缀，为可读编号让出 20 字上限。
      const suffix = sequence === 1 ? '' : ` ${sequence}`
      const maxBaseLength = 20 - Array.from(suffix).length
      const promptCharacters = Array.from(normalizedPrompt)
      const base =
        promptCharacters.length > maxBaseLength
          ? `${promptCharacters.slice(0, maxBaseLength - 1).join('')}…`
          : promptCharacters.join('')

      try {
        const project = await projectApis.create({
          name: `${base}${suffix}`,
          perspective: 'side',
          directionalMovement: 'single',
          spriteSize: { width: 256, height: 256 },
        })
        return { id: project.id, spriteSize: project.spriteSize }
      } catch (error) {
        if (!(error instanceof ProjectNameConflictError)) throw error
        lastConflict = error
      }
    }

    throw lastConflict
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
}: CreateRealQuickStartServiceOptions): QuickStartEntryService {
  return createQuickStartService({
    workflowRunApis,
    generationApis,
    prepareProject: createAutoPrepareProject(projectApis),
    projectApis,
    characterApis,
    mediaApis,
    onAsyncError,
  })
}

export function createAuthenticatedGenerationRequest(fetchFn: typeof fetch = fetch) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    const accessToken = getApiAccessToken()
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    return fetchFn(`${resolveApiBaseUrl()}${url}`, { ...init, headers, credentials: 'include' })
  }
}

const generationRequest = createAuthenticatedGenerationRequest()
const generationStream = createEventStreamSubscriber({
  getAccessToken: getApiAccessToken,
  recoverUnauthorized: recoverApiUnauthorized,
})
const generationApis = createGenerationApis({
  transport: {
    request: generationRequest,
    stream: (url, options) => generationStream(`${resolveApiBaseUrl()}${url}`, options),
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
