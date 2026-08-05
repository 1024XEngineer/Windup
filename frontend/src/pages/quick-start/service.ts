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
import { publishWorkflowRun } from '@/features/publish'
import { submitReview } from '@/features/review'

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
  getWorkflow(runId: WorkflowRun['id']): WorkflowRun | null
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  interrupt(runId: WorkflowRun['id']): WorkflowRun | null
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
  generationApis?: GenerationApis
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
  generationApis,
  mediaApis,
}: CreateQuickStartServiceOptions): QuickStartService {
  /** 记录每个 runId 对应的角色和造型 ID，供导出到 Playtest 使用。 */
  const characterMap = new Map<string, { characterId: string; outfitId: string }>()

  function readCharacterInfo(
    runId: WorkflowRun['id'],
  ): { characterId: string; outfitId: string } | null {
    const fromMap = characterMap.get(runId)
    if (fromMap) return fromMap
    // 刷新后内存 Map 为空，从持久化的 run 恢复角色与造型引用
    const run = controller.getWorkflow(runId)
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

      const created = controller.create({
        projectId,
        purpose: 'create_character',
        driver: 'ai',
        prompt: normalizedPrompt,
      })

      try {
        return await controller.nextStep(created.id, {
          width: project.spriteSize.width,
          height: project.spriteSize.height,
        })
      } catch (cause) {
        const stored = controller.getWorkflow(created.id)
        if (stored?.status === 'failed') return stored
        throw cause
      }
    },

    async startWithUploadedTemplate(file, actionDescription, signal) {
      if (!mediaApis) throw new Error('媒体上传服务尚未配置，不能使用角色母版')
      if (!characterApis || !generationApis) {
        throw new Error('角色或生成服务尚未配置，不能使用角色母版')
      }
      const actionPrompt = actionDescription.trim()
      const namingSeed = actionPrompt || file.name.trim()
      if (!namingSeed) throw new Error('请提供动作描述或有效的图片文件')

      const project = await prepareProject(namingSeed)
      const projectId = project.id.trim()
      if (!projectId) throw new Error('项目服务没有返回有效的项目 ID')
      const templateUrl = await mediaApis.upload(file, 'reference-image', signal)

      // 只有上传成功后才创建 WorkflowRun，失败的上传不会留下可恢复的空运行记录。
      const created = controller.create({
        projectId,
        purpose: 'create_character',
        driver: 'ai',
        prompt: actionPrompt || undefined,
      })
      controller.acceptUploadedCharacterTemplate(created.id, templateUrl)
      return triggerActionGeneration(
        created.id,
        templateUrl,
        actionPrompt || undefined,
        characterApis,
        controller,
        characterMap,
      )
    },

    async continueWithUploadedTemplate(runId, file, actionDescription, signal) {
      if (!mediaApis) throw new Error('媒体上传服务尚未配置，不能使用角色母版')
      if (!characterApis || !generationApis) {
        throw new Error('角色或生成服务尚未配置，不能使用角色母版')
      }
      if (!controller.getWorkflow(runId)) throw new Error(`WorkflowRun 不存在：${runId}`)

      const templateUrl = await mediaApis.upload(file, 'reference-image', signal)
      controller.acceptUploadedCharacterTemplate(runId, templateUrl)
      return triggerActionGeneration(
        runId,
        templateUrl,
        actionDescription.trim() || undefined,
        characterApis,
        controller,
        characterMap,
      )
    },

    async startAction(target, actionDescription) {
      if (!characterApis || !generationApis) {
        throw new Error('角色或生成服务尚未配置，不能增加动作')
      }
      const prompt = actionDescription.trim()
      if (!prompt) throw new Error('请先描述要添加的动作')

      const character = await characterApis.get(target.characterId)
      const outfit = character.outfits.find((item) => item.id === target.outfitId)
      if (!outfit) throw new Error('当前角色中没有找到目标造型')
      const firstFrameUrl = outfit.characterTemplateUrl ?? outfit.baseFrames[0]?.imageUrl ?? null
      if (!firstFrameUrl) throw new Error('当前造型没有可用于生成动作的角色图')

      const created = controller.create({
        projectId: character.projectId,
        purpose: 'add_action',
        driver: 'ai',
        prompt,
        characterId: character.id,
        outfitId: outfit.id,
        characterTemplateUrl: firstFrameUrl,
        baseFrameUrls: outfit.baseFrames.map((frame) => frame.imageUrl),
      })
      characterMap.set(created.id, { characterId: character.id, outfitId: outfit.id })

      return controller.startActionGeneration(created.id, {
        type: 'complete_animation',
        projectId: character.projectId,
        characterId: character.id,
        outfitId: outfit.id,
        actionType: 'custom',
        firstFrameUrl,
        prompt,
        referenceMedia: [firstFrameUrl as MediaReference],
      })
    },

    getWorkflow(runId) {
      return controller.getWorkflow(runId)
    },

    subscribe(runId, listener) {
      return controller.subscribe(runId, listener)
    },

    resume(runId) {
      return controller.resume(runId)
    },

    interrupt(runId) {
      const run = controller.getWorkflow(runId)
      return run ? controller.interrupt(runId) : null
    },

    async confirmCandidate(runId, selectedImageUrl, actionDescription) {
      const normalizedDescription = actionDescription?.trim()
      if (characterApis && generationApis) {
        return triggerActionGeneration(
          runId,
          selectedImageUrl,
          normalizedDescription,
          characterApis,
          controller,
          characterMap,
        )
      } else {
        throw new Error('角色或生成服务尚未配置，不能继续动作生成')
      }
    },

    async approveReview(runId) {
      if (!characterApis) throw new Error('角色服务尚未配置，不能发布资产')
      const run = controller.getWorkflow(runId)
      if (!run) throw new Error(`WorkflowRun 不存在：${runId}`)
      const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
      const reviewStep = revision?.steps.find((item) => item.type === 'review')
      const approved =
        run.status === 'active' && reviewStep?.status === 'active'
          ? submitReview(controller, { runId, decision: { kind: 'approve' } })
          : run.status === 'completed' && reviewStep?.status === 'passed'
            ? run
            : null
      if (!approved) throw new Error('审核步骤尚未就绪，不能发布资产')
      await publishWorkflowRun(characterApis, approved)
      return approved
    },

    getCharacterInfo(runId) {
      return readCharacterInfo(runId)
    },

    async resolveCharacterInfo(runId) {
      const cached = readCharacterInfo(runId)
      if (cached) return cached
      const run = controller.getWorkflow(runId)
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

/**
 * 确认候选后自动触发动作生成：创建角色 → 提交动作生成任务 → 轮询结果写回 WorkflowRun。
 * actionDescription 提供时生成自定义动作（如"在画板上画画"），缺省生成 idle 待机。
 */
async function triggerActionGeneration(
  runId: string,
  templateImageUrl: string,
  actionDescription: string | undefined,
  characterApis: CharacterApis,
  controller: WorkflowController,
  characterMap: Map<string, { characterId: string; outfitId: string }>,
) {
  try {
    const run = controller.getWorkflow(runId)
    if (!run) throw new Error(`WorkflowRun 不存在：${runId}`)
    const initialState = actionGenerationInputState(run, templateImageUrl)
    // 1. 创建角色，母版图作为参考
    console.debug('[action-gen] creating character for run', runId)
    let character = await characterApis.create({
      projectId: run.projectId,
      description: 'Quick Start auto-created character',
      referenceImageUrl: templateImageUrl,
    })

    // 后端默认不创建造型；补充一个默认造型，确保动作写回和 Playtest 加载有效
    if (character.outfits.length === 0) {
      character = await characterApis.update({
        ...character,
        outfits: [
          {
            id: `outfit-${character.id}-default`,
            characterId: character.id,
            name: '默认造型',
            candidateCharacterTemplates: [],
            characterTemplateUrl: templateImageUrl,
            baseFrames: [],
            actions: [],
          },
        ],
      })
    }

    const outfitId = character.outfits[0]?.id ?? ''
    const latest = controller.getWorkflow(runId)
    if (!latest) throw new Error(`WorkflowRun 不存在：${runId}`)
    const latestState = actionGenerationInputState(latest, templateImageUrl)
    if (latestState !== initialState) {
      throw new Error('角色母版步骤已变更，不能继续提交动作生成')
    }
    const updated =
      latestState === 'candidate-active'
        ? controller.confirmCandidate(runId, templateImageUrl)
        : latest
    controller.recordCharacterRefs(runId, { characterId: character.id, outfitId })
    characterMap.set(runId, { characterId: character.id, outfitId })
    console.debug('[action-gen] character created:', character.id, 'outfit:', outfitId)

    // 2. 提交完整动画生成（默认 32 帧，母版图作为参考）。
    //    提供动作描述时走 custom 路线（提示词驱动的自定义动作）；缺省 idle 待机。
    const isCustom = Boolean(actionDescription)
    return controller.startActionGeneration(runId, {
      type: 'complete_animation',
      projectId: updated.projectId,
      characterId: character.id,
      outfitId,
      actionType: isCustom ? 'custom' : 'idle',
      firstFrameUrl: templateImageUrl,
      prompt: isCustom ? (actionDescription ?? null) : null,
      referenceMedia: [templateImageUrl as MediaReference],
    })
  } catch (err) {
    console.error('[action-gen] unexpected error:', err)
    const latest = controller.getWorkflow(runId)
    if (latest?.status === 'active') {
      const revision = latest.revisions.find((item) => item.id === latest.currentRevisionId)
      const step = revision?.steps.find((item) => item.type === 'action-generation')
      if (step?.status === 'active' && !step.taskId && !step.submissionId) {
        const message =
          err instanceof Error && err.message.trim() ? err.message.trim() : '动作生成失败'
        controller.completeActionGeneration(runId, { error: message })
      }
    }
    throw err
  }
}

/**
 * 普通路径只能确认当前候选；上传路径在采用母版时已通过候选步骤并激活动作步骤。
 * 两种明确状态之外一律拒绝，避免绕开流程门禁。
 */
function actionGenerationInputState(
  run: WorkflowRun,
  templateImageUrl: string,
): 'candidate-active' | 'uploaded-template' {
  const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
  const candidate = revision?.steps.find((step) => step.type === 'template-candidate')
  const action = revision?.steps.find((step) => step.type === 'action-generation')
  if (candidate?.status === 'active' && action?.status === 'locked') return 'candidate-active'
  if (
    candidate?.status === 'passed' &&
    hasSelectedTemplateUrl(candidate.output, templateImageUrl) &&
    action?.status === 'active'
  ) {
    return 'uploaded-template'
  }
  throw new Error('当前流程状态不能开始动作生成')
}

function hasSelectedTemplateUrl(output: unknown, templateImageUrl: string): boolean {
  return (
    typeof output === 'object' &&
    output !== null &&
    'selectedImageUrl' in output &&
    typeof output.selectedImageUrl === 'string' &&
    output.selectedImageUrl === templateImageUrl
  )
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

  getWorkflow() {
    return null
  },

  subscribe() {
    return () => undefined
  },

  async resume() {
    return null
  },

  interrupt() {
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
  })
  const prepareProject = createAutoPrepareProject(projectApis)

  return createQuickStartService({
    controller,
    prepareProject,
    characterApis,
    generationApis,
    mediaApis,
  })
}
