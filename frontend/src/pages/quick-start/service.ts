import type {
  CharacterApis,
  GenerationApis,
  MediaApis,
  MediaReference,
  Project,
  ProjectApis,
  WorkflowRun,
} from '@/entities'
import { createWorkflowRunStore, type WorkflowRunStore } from '@/entities/workflow-run/store'
import { createWorkflowController, type WorkflowController } from '@/features/workflow-controller'

/**
 * Quick Start 创建项目所需的页面级边界。
 *
 * 页面不直接拼接后端字段；prepareProject 负责把提示词整理成真实项目并返回项目约束。
 */
export type PrepareQuickStartProject = (
  prompt: string,
) => Promise<Pick<Project, 'id' | 'spriteSize'>>

export interface QuickStartService {
  /** 为 null 时可以创建；非 null 时页面必须明确阻止提交，不能回退到假数据。 */
  readonly unavailableReason: string | null
  start(prompt: string): Promise<WorkflowRun>
  /** 上传已完成的角色母版，直接跳过角色图生成与候选选择。 */
  startWithUploadedTemplate(
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRun>
  /** 为已有运行采用上传母版，并直接进入动作生成。 */
  continueWithUploadedTemplate(
    runId: WorkflowRun['id'],
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRun>
  /** 复用已有角色和造型，直接开始一条增加动作的运行。 */
  startAction(
    target: { characterId: string; outfitId: string },
    actionDescription: string,
  ): Promise<WorkflowRun>
  peekWorkflow(runId: WorkflowRun['id']): WorkflowRun | null
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  interrupt(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  /**
   * 确认候选选择并触发动作生成。
   * actionDescription 可选：提供时生成该描述的自定义动作（如"在画板上画画"），
   * 缺省生成 idle 待机动作。
   */
  confirmCandidate(
    runId: WorkflowRun['id'],
    selectedImageUrl: string,
    actionDescription?: string,
  ): Promise<WorkflowRun>
  /** 审核通过后结束运行；进入预览台属于随后发生的发布行为。 */
  approveReview(runId: WorkflowRun['id']): Promise<WorkflowRun>
  /** 获取导出到 Playtest 所需的角色和造型 ID。 */
  getCharacterInfo(runId: WorkflowRun['id']): { characterId: string; outfitId: string } | null
  /**
   * 导出前兜底恢复：内存 Map 与持久化引用都缺失时（旧运行记录），
   * 按项目 ID 从后端反查最近创建的角色与造型。
   */
  resolveCharacterInfo(
    runId: WorkflowRun['id'],
  ): Promise<{ characterId: string; outfitId: string } | null>
}

export interface CreateQuickStartServiceOptions {
  controller: WorkflowController
  prepareProject: PrepareQuickStartProject
  characterApis?: CharacterApis
  mediaApis?: MediaApis
}

/**
 * Quick Start 只改变输入与自动推进方式，WorkflowRun 状态仍由同一个 Controller 维护。
 * Project 必须先成功创建，避免产生没有真实项目归属的运行记录。
 */
export function createQuickStartService({
  controller,
  prepareProject,
  characterApis,
  mediaApis,
}: CreateQuickStartServiceOptions): QuickStartService {
  const autoAdvancers = new Map<WorkflowRun['id'], () => void>()

  function ensureAutomaticActionAdvance(runId: WorkflowRun['id']): void {
    if (autoAdvancers.has(runId)) return
    let advancing = false

    const advance = (run: WorkflowRun) => {
      if (run.status !== 'active') {
        autoAdvancers.get(runId)?.()
        autoAdvancers.delete(runId)
        return
      }
      const methodNode = run.nodes.find(
        (node) => node.type === 'action-generation-method' && node.status === 'active',
      )
      if (!methodNode || advancing) return
      const firstFrameNode = run.nodes.find(
        (node) =>
          node.type === 'action-first-frame' && methodNode.dependsOnNodeIds.includes(node.id),
      )
      const firstFrameUrl =
        firstFrameNode?.type === 'action-first-frame'
          ? firstFrameNode.output?.frames[0]?.imageUrl
          : undefined
      if (firstFrameNode?.type !== 'action-first-frame' || !firstFrameNode.input || !firstFrameUrl)
        return
      const firstFrameInput = firstFrameNode.input

      advancing = true
      void controller
        .selectActionGenerationMethod(runId, 'video-cropping', methodNode.id)
        .then((selected) => {
          const fullFrameNode = selected.nodes.find(
            (node) =>
              node.type === 'action-full-frame' &&
              !node.deletedAt &&
              node.dependsOnNodeIds.includes(methodNode.id),
          )
          if (!fullFrameNode) throw new Error('动作生成路线没有关联完整动画节点')
          return controller.startActionGeneration(
            runId,
            {
              ...firstFrameInput,
              firstFrameUrl,
              referenceMedia: [
                ...new Set([...firstFrameInput.referenceMedia, firstFrameUrl as MediaReference]),
              ],
              numFrames: 32,
            },
            fullFrameNode.id,
          )
        })
        .catch((error: unknown) => {
          console.error('[quick-start] 自动推进动作生成失败', error)
        })
        .finally(() => {
          advancing = false
          const latest = controller.peekWorkflow(runId)
          if (latest) advance(latest)
        })
    }
    const stop = controller.subscribe(runId, advance)
    autoAdvancers.set(runId, stop)
    const current = controller.peekWorkflow(runId)
    if (current) advance(current)
  }

  function readCharacterInfo(
    runId: WorkflowRun['id'],
  ): { characterId: string; outfitId: string } | null {
    // 角色引用属于 WorkflowRun 的持久状态；页面刷新后仍可直接恢复。
    const run = controller.peekWorkflow(runId)
    if (run?.characterId && run?.outfitId) {
      return { characterId: run.characterId, outfitId: run.outfitId }
    }
    return null
  }

  return {
    unavailableReason: null,

    async start(prompt) {
      const normalizedPrompt = prompt.trim()
      if (!normalizedPrompt) throw new Error('请先描述想要创建的角色')

      const project = await prepareProject(normalizedPrompt)
      const projectId = project.id.trim()
      if (!projectId) throw new Error('项目服务没有返回有效的项目 ID')

      const created = await controller.create({
        projectId,
        purpose: 'create_character',
        prompt: normalizedPrompt,
      })

      try {
        return await controller.nextStep(created.id, {
          width: project.spriteSize.width,
          height: project.spriteSize.height,
        })
      } catch (cause) {
        const stored = controller.peekWorkflow(created.id)
        if (stored?.status === 'failed') return stored
        throw cause
      }
    },

    async startWithUploadedTemplate(file, actionDescription, signal) {
      if (!mediaApis) throw new Error('媒体上传服务尚未配置，不能使用角色母版')
      const actionPrompt = actionDescription.trim()
      const namingSeed = actionPrompt || file.name.trim()
      if (!namingSeed) throw new Error('请提供动作描述或有效的图片文件')

      const project = await prepareProject(namingSeed)
      const projectId = project.id.trim()
      if (!projectId) throw new Error('项目服务没有返回有效的项目 ID')
      const templateUrl = await mediaApis.upload(file, 'reference-image', signal)

      // 只有上传成功后才创建 WorkflowRun，失败的上传不会留下可恢复的空运行记录。
      const created = await controller.create({
        projectId,
        purpose: 'create_character',
        prompt: actionPrompt || undefined,
      })
      await controller.acceptUploadedCharacterTemplate(created.id, templateUrl)
      const started = await controller.startActionFromTemplate(
        created.id,
        templateUrl,
        actionPrompt || undefined,
      )
      ensureAutomaticActionAdvance(created.id)
      return started
    },

    async continueWithUploadedTemplate(runId, file, actionDescription, signal) {
      if (!mediaApis) throw new Error('媒体上传服务尚未配置，不能使用角色母版')
      if (!controller.peekWorkflow(runId)) throw new Error(`WorkflowRun 不存在：${runId}`)

      const templateUrl = await mediaApis.upload(file, 'reference-image', signal)
      await controller.acceptUploadedCharacterTemplate(runId, templateUrl)
      const started = await controller.startActionFromTemplate(
        runId,
        templateUrl,
        actionDescription.trim() || undefined,
      )
      ensureAutomaticActionAdvance(runId)
      return started
    },

    async startAction(target, actionDescription) {
      if (!characterApis) throw new Error('角色服务尚未配置，不能增加动作')
      const prompt = actionDescription.trim()
      if (!prompt) throw new Error('请先描述要添加的动作')

      const character = await characterApis.get(target.characterId)
      const outfit = character.outfits.find((item) => item.id === target.outfitId)
      if (!outfit) throw new Error('当前角色中没有找到目标造型')
      const firstFrameUrl = outfit.characterTemplateUrl ?? outfit.baseFrames[0]?.imageUrl ?? null
      if (!firstFrameUrl) throw new Error('当前造型没有可用于生成动作的角色图')

      // 一个 Character 只保留一条 WorkflowRun。资产库中的旧角色第一次进入制作时创建 Run，
      // 后续动作都在同一条 Run 的角色母版节点后追加独立动作分支。
      const existing = await controller.getWorkflowByCharacter(character.id)
      const targetRun = existing
        ? await controller.appendAction(existing.id)
        : await controller.create({
            projectId: character.projectId,
            purpose: 'add_action',
            prompt,
            characterId: character.id,
            outfitId: outfit.id,
            characterTemplateUrl: firstFrameUrl,
            baseFrameUrls: outfit.baseFrames.map((frame) => frame.imageUrl),
          })
      const firstFrameNode = targetRun.nodes.findLast(
        (node) => node.type === 'action-first-frame' && node.status === 'active' && !node.deletedAt,
      )
      if (!firstFrameNode || firstFrameNode.type !== 'action-first-frame') {
        throw new Error('新增动作分支没有可提交的首帧节点')
      }
      const started = await controller.startActionGeneration(
        targetRun.id,
        {
          type: 'character_action',
          projectId: character.projectId,
          characterId: character.id,
          outfitId: outfit.id,
          actionType: 'custom',
          firstFrameUrl: null,
          prompt,
          referenceMedia: [firstFrameUrl as MediaReference],
          numFrames: 1,
        },
        firstFrameNode.id,
      )
      ensureAutomaticActionAdvance(targetRun.id)
      return started
    },

    peekWorkflow(runId) {
      return controller.peekWorkflow(runId)
    },

    subscribe(runId, listener) {
      return controller.subscribe(runId, listener)
    },

    async resume(runId) {
      const resumed = await controller.resume(runId)
      if (resumed?.status === 'active') ensureAutomaticActionAdvance(runId)
      return resumed
    },

    async interrupt(runId) {
      const run = controller.peekWorkflow(runId)
      return run ? await controller.interrupt(runId) : null
    },

    async confirmCandidate(runId, selectedImageUrl, actionDescription) {
      const started = await controller.startActionFromTemplate(
        runId,
        selectedImageUrl,
        actionDescription?.trim() || undefined,
      )
      ensureAutomaticActionAdvance(runId)
      return started
    },

    async approveReview(runId) {
      return controller.approveAndPublish(runId)
    },

    getCharacterInfo(runId) {
      return readCharacterInfo(runId)
    },

    async resolveCharacterInfo(runId) {
      const cached = readCharacterInfo(runId)
      if (cached) return cached
      const run = controller.peekWorkflow(runId) ?? (await controller.resume(runId))
      if (!run?.projectId || !characterApis) return null
      // 旧运行记录没有持久化角色引用：按项目反查，quick-start 每 run 只创建一个角色
      try {
        const characters = await characterApis.listByProject(run.projectId)
        const character = characters[characters.length - 1]
        const outfitId = character?.outfits[0]?.id
        if (!character || !outfitId) return null
        return { characterId: character.id, outfitId }
      } catch (err) {
        console.warn('[resolve-character-info] backend lookup failed:', err)
        return null
      }
    },
  }
}

const UNAVAILABLE_REASON = '项目与生成服务尚未配置，暂时无法开始新的创作'

/**
 * 当前生产组合还没有 Project / Generation 实现时，这里会明确不可用，
 * 让未配置环境停在入口并说明原因，不能静默切换到 Mock 或伪造成功。
 */
export const unavailableQuickStartService: QuickStartService = {
  unavailableReason: UNAVAILABLE_REASON,

  async start() {
    throw new Error(UNAVAILABLE_REASON)
  },

  async startAction() {
    throw new Error(UNAVAILABLE_REASON)
  },

  async startWithUploadedTemplate() {
    throw new Error(UNAVAILABLE_REASON)
  },

  async continueWithUploadedTemplate() {
    throw new Error(UNAVAILABLE_REASON)
  },

  peekWorkflow() {
    return null
  },

  subscribe() {
    return () => undefined
  },

  async resume() {
    return null
  },

  async interrupt() {
    return null
  },

  async confirmCandidate() {
    throw new Error(UNAVAILABLE_REASON)
  },

  approveReview() {
    throw new Error(UNAVAILABLE_REASON)
  },

  getCharacterInfo() {
    return null
  },

  async resolveCharacterInfo() {
    return null
  },
}

/**
 * 自动创建项目的 prepareProject 实现。
 *
 * 使用默认参数（侧视、单方向、256x256）。256 保证生成帧有足够细节，
 * 预览台放大后仍清晰；项目名取提示词前 16 字符 + 完整时间戳 + 4 位随机串，
 * 避免同一提示词重复提交时名称冲突。
 */
export function createAutoPrepareProject(projectApis: ProjectApis): PrepareQuickStartProject {
  return async (prompt: string) => {
    const base = prompt.length > 16 ? prompt.slice(0, 16) + '…' : prompt
    const ts = Date.now().toString(36)
    const rand = Math.random().toString(36).slice(2, 6)
    const name = `${base}-${ts}-${rand}`
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
  mediaApis: MediaApis
  store?: WorkflowRunStore
}

/**
 * 创建真实的 QuickStartService。
 *
 * 将 Project、Character、Generation 适配器与 WorkflowController 组合成完整的服务。
 * 用于生产环境，调用真实后端 API。
 */
export function createRealQuickStartService({
  projectApis,
  characterApis,
  generationApis,
  mediaApis,
  store,
}: CreateRealQuickStartServiceOptions): QuickStartService {
  const workflowStore = store ?? createWorkflowRunStore()
  const controller = createWorkflowController({
    store: workflowStore,
    generationApis,
    characterApis,
  })
  const prepareProject = createAutoPrepareProject(projectApis)

  return createQuickStartService({
    controller,
    prepareProject,
    characterApis,
    mediaApis,
  })
}
