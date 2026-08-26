import {
  characterApis,
  createGenerationApis,
  createMediaApis,
  projectApis,
  workflowRunApis,
  characterTemplatesFromImages,
  getDirectionProfile,
  type Action,
  type Character,
  type CharacterApis,
  type ActionDirection,
  type CharacterSetupWorkflowNode,
  type DirectionalMovement,
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
import {
  createAutoPrepareProject,
  createWorkflowController,
  type PrepareQuickStartProject,
  type PrepareQuickStartProjectOptions,
  type WorkflowController,
} from '@/features/workflow-controller'
import { createProgressiveExportModel, type ExportPackageModel } from '@/features/export-package'
import { createActionSequences } from '@/features/export'
import {
  REFINE_CHARACTER_TEMPLATE_TOOL,
  REFINE_FIRST_FRAME_TOOL,
  REGENERATE_CHARACTER_TEMPLATE_TOOL,
  REGENERATE_FIRST_FRAME_TOOL,
  type WorkflowAgentContext,
} from '@/features/quick-start-agent/runtime'

export { createAutoPrepareProject }
export type { PrepareQuickStartProject, PrepareQuickStartProjectOptions }

export interface QuickStartFrame {
  index: number
  imageUrl: string
  durationMs: number | null
}

export interface QuickStartCandidate {
  direction: ActionDirection
  index: number
  imageUrl: string
}

export type QuickStartDirectionSelections = Readonly<Partial<Record<ActionDirection, string>>>
type QuickStartCandidateSelection = string | QuickStartDirectionSelections

export interface QuickStartFailedDirection {
  nodeId: WorkflowNode['id']
  direction: ActionDirection
}

export interface QuickStartResumeOptions {
  automaticActionAdvance?: boolean
}

export interface QuickStartMediaApis {
  upload(file: File, category: 'reference-image', signal?: AbortSignal): Promise<MediaReference>
}

export interface QuickStartSession {
  readonly runId: WorkflowRun['id']
  /** 当前 Run 所属项目的方向模式，用于恢复时稳定渲染候选布局。 */
  readonly getDirectionalMovement?: () => DirectionalMovement
  getWorkflow(): WorkflowRun
  subscribe(listener: (run: WorkflowRun) => void): () => void
  subscribeErrors(listener: (error: Error) => void): () => void
  resume(options?: QuickStartResumeOptions): Promise<WorkflowRun>
  interrupt(): Promise<WorkflowRun>
  dispose(): void
  continueWithUploadedTemplate(
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRun>
  /** 在当前 WorkflowRun 的角色母版后追加动作，不创建新的 Run。 */
  addAction(outfitId: string, actionDescription: string): Promise<WorkflowRun>
  confirmCandidate(
    selectedImages: QuickStartCandidateSelection,
    actionDescription?: string,
  ): Promise<WorkflowRun>
  /** 读取当前 Action 首帧生成任务的候选帧。 */
  getFirstFrameCandidates(): Promise<readonly QuickStartCandidate[]>
  /** 确认首帧后，Quick Start 自动选择已接入的生成路线并提交完整动画。 */
  confirmFirstFrame(selectedImages: QuickStartCandidateSelection): Promise<WorkflowRun>
  approveReview(): Promise<WorkflowRun>
  getCharacterInfo(): { characterId: string; outfitId: string } | null
  resolveCharacterInfo(): Promise<{ characterId: string; outfitId: string } | null>
  getTemplateCandidates(): Promise<readonly QuickStartCandidate[]>
  getActionFrames(): Promise<readonly QuickStartFrame[]>
  getFailedGenerationDirections(): Promise<readonly QuickStartFailedDirection[]>
  retryGenerationDirection(
    nodeId: WorkflowNode['id'],
    direction: ActionDirection,
  ): Promise<WorkflowRun>
  getWorkflowAgentContext(): WorkflowAgentContext
  regenerateCharacterTemplate(
    mode: 'regenerate' | 'refine',
    adjustmentPrompt?: string,
  ): Promise<WorkflowRun>
  regenerateFirstFrame(
    mode: 'regenerate' | 'refine',
    adjustmentPrompt?: string,
  ): Promise<WorkflowRun>
  /** 按当前 Run 完成度装配统一导出包；角色母版尚未确认时返回 null。 */
  getExportModel(): Promise<ExportPackageModel | null>
}

export interface QuickStartEntryService {
  readonly unavailableReason: string | null
  start(
    prompt: string,
    directionalMovement?: DirectionalMovement,
    options?: PrepareQuickStartProjectOptions,
  ): Promise<QuickStartSession>
  startWithUploadedTemplate(
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
    directionalMovement?: DirectionalMovement,
    options?: PrepareQuickStartProjectOptions,
  ): Promise<QuickStartSession>
  open(runId: WorkflowRun['id']): Promise<QuickStartSession>
}

export interface CreateQuickStartServiceOptions {
  workflowRunApis: WorkflowRunApis
  generationApis: GenerationApis
  prepareProject: PrepareQuickStartProject
  /** 为已有项目继续生成动作时读取图片接口要求的精灵尺寸。 */
  projectApis: Pick<ProjectApis, 'get'>
  characterApis?: CharacterApis
  mediaApis?: QuickStartMediaApis
  onAsyncError?: (error: Error) => void
}

type GeneratableActionType = 'idle' | 'walk' | 'jump' | 'attack' | 'custom'

const ACTION_DISPLAY_NAME_MAX_LENGTH = 20

function boundedDisplayName(value: string, maxLength: number): string {
  const characters = Array.from(value)
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength - 1).join('')}…`
    : characters.join('')
}

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
  projectApis,
  characterApis,
  mediaApis,
  onAsyncError = (error) => console.error('[quick-start] 异步工作流错误', error),
}: CreateQuickStartServiceOptions): QuickStartEntryService {
  const projectSpriteSizes = new Map<Project['id'], Project['spriteSize']>()
  const projectDirectionalMovements = new Map<Project['id'], Project['directionalMovement']>()
  const controllerErrorChannels = new WeakMap<
    WorkflowController,
    {
      listeners: Set<(error: Error) => void>
      report(error: Error): void
    }
  >()

  async function shouldRollbackWorkflowChange(
    runId: WorkflowRun['id'],
    isPersisted: (latest: WorkflowRun) => boolean,
  ) {
    try {
      return !isPersisted(await workflowRunApis.get(runId))
    } catch (reconcileCause) {
      onAsyncError(
        reconcileCause instanceof Error
          ? reconcileCause
          : new Error('WorkflowRun 保存结果对账失败'),
      )
      // 无法确认 PATCH 是否落库时保留幂等资产，避免删掉已被 Run 引用的数据。
      return false
    }
  }

  async function resolveProjectSpriteSize(projectId: Project['id']) {
    const cached = projectSpriteSizes.get(projectId)
    if (cached) return cached
    const project = await projectApis.get(projectId)
    projectSpriteSizes.set(project.id, project.spriteSize)
    projectDirectionalMovements.set(project.id, project.directionalMovement)
    return project.spriteSize
  }

  function createController(
    workflow?: WorkflowRun,
    directionalMovement?: Project['directionalMovement'],
  ): WorkflowController {
    const listeners = new Set<(error: Error) => void>()
    const report = (error: Error) => {
      try {
        onAsyncError(error)
      } catch (reportError) {
        console.error('[quick-start] 异步错误上报器执行失败', reportError, error)
      }
      for (const listener of listeners) {
        try {
          listener(error)
        } catch (listenerError) {
          console.error('[quick-start] 页面错误订阅者执行失败', listenerError, error)
        }
      }
    }
    const controller = createWorkflowController({
      workflow,
      workflowRunApis,
      generationApis,
      onAsyncError: report,
      directionalMovement:
        directionalMovement ??
        (workflow ? projectDirectionalMovements.get(workflow.projectId) : undefined),
    })
    controllerErrorChannels.set(controller, { listeners, report })
    return controller
  }

  function reportControllerError(controller: WorkflowController, error: Error) {
    controllerErrorChannels.get(controller)?.report(error)
  }

  function generationDirectionsFor(controller: WorkflowController): readonly ActionDirection[] {
    const movement = projectDirectionalMovements.get(controller.getWorkflow().projectId) ?? 'single'
    return getDirectionProfile(movement).generationDirections
  }

  async function candidatesByDirection(
    controller: WorkflowController,
    nodeId: WorkflowNode['id'],
    role: 'character_template' | 'first_frame',
  ): Promise<QuickStartCandidate[]> {
    const result: QuickStartCandidate[] = []
    for (const generation of await controller.getGenerations(nodeId, role)) {
      const images =
        role === 'character_template' && generation.result?.type === 'character_template'
          ? generation.result.images
          : role === 'first_frame' && generation.result?.type === 'first_frame'
            ? generation.result.images
            : []
      const direction = generation.result?.direction ?? 'east'
      images.forEach((image, index) => result.push({ direction, index, imageUrl: image.url }))
    }
    return result
  }

  function selectedDirections(
    controller: WorkflowController,
    selection: QuickStartCandidateSelection,
    existing: QuickStartDirectionSelections = {},
  ): QuickStartDirectionSelections {
    const selected = {
      ...existing,
      ...(typeof selection === 'string' ? { east: selection } : selection),
    }
    for (const direction of generationDirectionsFor(controller)) {
      if (!selected[direction]) throw new Error(`缺少${direction}方向的用户选择`)
    }
    return selected
  }

  async function confirmRemainingTemplateDirections(
    controller: WorkflowController,
    characterId: Character['id'],
    selectedImages: QuickStartDirectionSelections,
  ) {
    const template = templateNode(controller.getWorkflow())
    const directions = generationDirectionsFor(controller)
    if (directions.length <= 1) return
    const remaining = directions.slice(1)
    for (const direction of remaining.slice(0, -1)) {
      const selected = selectedImages[direction]!
      await controller.confirmCharacterTemplate(template.id, selected, characterId, direction)
    }
    const lastDirection = remaining.at(-1)
    if (!lastDirection) return
    const lastSelected = selectedImages[lastDirection]!
    const persistedImages = {
      ...(templateNode(controller.getWorkflow()).selectedImages ?? {}),
      ...selectedImages,
      [lastDirection]: lastSelected,
    }
    // Character 先完整落库，再让最后一个方向把 Run 推进为 passed。资产写入失败时
    // Run 仍停在 selecting，用户可以幂等重试，不会出现“Run 完成但资产缺方向”。
    await persistSelectedCharacterTemplates(controller, characterId, persistedImages)
    await controller.confirmCharacterTemplate(template.id, lastSelected, characterId, lastDirection)
  }

  async function persistSelectedCharacterTemplates(
    controller: WorkflowController,
    characterId: Character['id'],
    selectedImagesOverride?: Partial<Record<ActionDirection, string>>,
  ) {
    if (!characterApis) return
    const character = await characterApis.get(characterId)
    const selectedImages =
      selectedImagesOverride ?? templateNode(controller.getWorkflow()).selectedImages ?? {}
    const templates = characterTemplatesFromImages(selectedImages)
    if (JSON.stringify(character.templates ?? []) !== JSON.stringify(templates)) {
      await characterApis.update({ ...character, templates })
    }
  }

  async function confirmAllFirstFrameDirections(
    controller: WorkflowController,
    nodeId: WorkflowNode['id'],
    selection: QuickStartCandidateSelection,
  ) {
    const firstFrame = latestActionFirstFrame(controller.getWorkflow())
    if (!firstFrame || firstFrame.type !== 'action-first-frame' || firstFrame.id !== nodeId) {
      throw new Error('当前运行没有可确认的动作首帧')
    }
    const directions = generationDirectionsFor(controller)
    const selectedImages = selectedDirections(controller, selection, {
      ...(firstFrame.selectedFirstFrameUrl ? { east: firstFrame.selectedFirstFrameUrl } : {}),
      ...(firstFrame.selectedFirstFrameUrls ?? {}),
    })
    for (const direction of directions) {
      await controller.confirmFirstFrame(firstFrame.id, selectedImages[direction]!, direction)
    }
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

  async function createRun(
    projectId: string,
    nodes: WorkflowNode[],
    directionalMovement?: Project['directionalMovement'],
  ): Promise<WorkflowController> {
    const controller = createController(undefined, directionalMovement)
    await controller.create({ projectId, nodes })
    return controller
  }

  async function prepareAction(
    controller: WorkflowController,
    outfitId: string,
    actionDescription: string,
    spriteSize: Project['spriteSize'],
    options: { actionType?: 'walk'; candidateCount?: 1 } = {},
  ) {
    const prompt = actionDescription.trim()
    const name = boundedDisplayName(prompt, ACTION_DISPLAY_NAME_MAX_LENGTH) || '待机'
    const type = options.actionType ?? inferGeneratableActionType(actionDescription)
    await controller.addAction({ input: { outfitId, name, type, prompt: prompt || null, fps: 12 } })
    const run = controller.getWorkflow()
    const firstFrame = latestActionFirstFrame(run)
    if (!firstFrame || firstFrame.type !== 'action-first-frame') {
      throw new Error('新增动作后没有找到首帧节点')
    }
    await controller.generateFirstFrame(firstFrame.id, {
      spriteWidth: spriteSize.width,
      spriteHeight: spriteSize.height,
      ...(options.candidateCount ? { candidateCount: options.candidateCount } : {}),
    })
  }

  async function persistCharacterTemplate(
    controller: WorkflowController,
    selectedImageUrl: string,
    persistRun: (
      setupId: CharacterSetupWorkflowNode['id'],
      characterId: Character['id'],
    ) => Promise<void>,
  ): Promise<{ characterId: string; outfitId: string }> {
    if (!characterApis) throw new Error('角色服务尚未配置，不能确认角色母版')
    const run = controller.getWorkflow()
    const setup = setupNode(run)
    const existingCharacterId = setup.input.characterId
    // 不传 name：后端按 description 生成并统一裁到 20 字。前端自己截会撞
    // CharacterCreate.name 的 20 字上限，也让后端的自动起名永远走不到。
    const character = existingCharacterId
      ? await characterApis.get(existingCharacterId)
      : await characterApis.create({
          projectId: run.projectId,
          workflowRunId: run.id,
          description: setup.input.prompt,
          referenceImageUrl: selectedImageUrl,
        })

    // 先用 WorkflowRun 的 version 确定候选图胜者，失败的客户端不得改写共用 Character。
    await persistRun(setup.id, character.id)
    const selectedImages = {
      ...templateNode(controller.getWorkflow()).selectedImages,
      east: selectedImageUrl,
    }
    const templates = characterTemplatesFromImages(selectedImages)
    const existingOutfit = character.outfits.find(
      (item) => item.previewUrl === selectedImageUrl || item.id === 'outfit-default',
    )
    const outfitId = existingOutfit?.id ?? 'outfit-default'
    const characterMatchesSelection =
      character.referenceImageUrl === selectedImageUrl &&
      existingOutfit?.previewUrl === selectedImageUrl &&
      JSON.stringify(character.templates ?? []) === JSON.stringify(templates)
    if (!characterMatchesSelection) {
      try {
        await characterApis.update({
          ...character,
          referenceImageUrl: selectedImageUrl,
          templates,
          outfits: existingOutfit
            ? character.outfits.map((item) =>
                item.id === existingOutfit.id ? { ...item, previewUrl: selectedImageUrl } : item,
              )
            : [
                ...character.outfits,
                {
                  id: outfitId,
                  characterId: character.id,
                  name: '默认造型',
                  description: null,
                  previewUrl: selectedImageUrl,
                  model3dUrl: null,
                  actions: [],
                },
              ],
        })
      } catch (cause) {
        const currentTemplate = templateNode(controller.getWorkflow())
        if (currentTemplate.status !== 'active' || currentTemplate.phase !== 'selecting') {
          try {
            await controller.restartFromNode(currentTemplate.id)
          } catch (reopenCause) {
            onAsyncError(
              reopenCause instanceof Error
                ? reopenCause
                : new Error('角色母版资产写入失败后重新打开节点失败'),
            )
          }
        }
        throw cause
      }
    }
    // Character 后端暂无版本条件更新；失败时保留可重试的幂等资产，
    // 不做 GET→整棵 PATCH 回滚，避免覆盖其他客户端新增的动作或造型。
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
    let stopped = false

    const advance = (run: WorkflowRun) => {
      if (advancing || stopped) return
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
          prompt: firstFrame.input.prompt?.trim() || firstFrame.input.name,
        })
      })().then(
        () => {
          advancing = false
          if (!stopped) advance(controller.getWorkflow())
        },
        (cause: unknown) => {
          advancing = false
          if (stopped) return
          stopped = true
          reportControllerError(
            controller,
            cause instanceof Error ? cause : new Error('Quick Start 自动推进失败'),
          )
        },
      )
    }

    const stop = controller.subscribe(advance)
    advance(controller.getWorkflow())
    return () => {
      stopped = true
      stop()
    }
  }

  function startAutomaticDelivery(controller: WorkflowController): () => void {
    let advancing = false
    let stopped = false

    const advance = (run: WorkflowRun) => {
      if (advancing || stopped) return
      const setup = setupNode(run)
      const automation = setup.automation
      if (automation?.mode !== 'automatic') return

      const template = templateNode(run)
      const firstFrame = latestActionFirstFrame(run)
      const shouldConfirmTemplate = template.status === 'active' && template.phase === 'selecting'
      const shouldConfirmFirstFrame =
        firstFrame?.type === 'action-first-frame' &&
        firstFrame.status === 'active' &&
        firstFrame.phase === 'selecting'
      if (!shouldConfirmTemplate && !shouldConfirmFirstFrame) return

      advancing = true
      void (async (): Promise<boolean> => {
        if (shouldConfirmTemplate) {
          const candidates = await candidatesByDirection(
            controller,
            template.id,
            'character_template',
          )
          const selections = Object.fromEntries(
            candidates.map((candidate) => [candidate.direction, candidate.imageUrl]),
          ) as QuickStartDirectionSelections
          const east = selections.east
          if (!east) return false

          let characterId = setup.input.characterId ?? null
          let outfitId: string | null = null
          if (!template.selectedImageUrl || !characterId) {
            const target = await persistCharacterTemplate(
              controller,
              east,
              (_setupId, selectedCharacterId) =>
                controller.confirmCharacterTemplate(template.id, east, selectedCharacterId),
            )
            characterId = target.characterId
            outfitId = target.outfitId
            const directions = generationDirectionsFor(controller)
            if (directions.length > 1) {
              const spriteSize = await resolveProjectSpriteSize(run.projectId)
              await controller.generateCharacterTemplate(setup.id, {
                spriteWidth: spriteSize.width,
                spriteHeight: spriteSize.height,
                sourceImageUrl: east,
                directions: directions.slice(1),
                candidateCount: 1,
              })
              return true
            }
          } else if (generationDirectionsFor(controller).length > 1) {
            const selectedImages = selectedDirections(controller, selections, {
              east: template.selectedImageUrl,
              ...(template.selectedImages ?? {}),
            })
            await confirmRemainingTemplateDirections(controller, characterId, selectedImages)
          }

          const actionPrompt = automation.actionPrompt?.trim()
          if (!actionPrompt) return true
          if (latestActionFirstFrame(controller.getWorkflow())) return true
          if (!outfitId) {
            if (!characterApis || !characterId) throw new Error('角色服务尚未配置，不能自动交付')
            const character = await characterApis.get(characterId)
            outfitId =
              character.outfits.find((item) => item.previewUrl === east)?.id ??
              character.outfits.find((item) => item.id === 'outfit-default')?.id ??
              null
          }
          if (!outfitId) throw new Error('自动交付没有找到角色造型')
          const spriteSize = await resolveProjectSpriteSize(run.projectId)
          await prepareAction(controller, outfitId, actionPrompt, spriteSize, {
            actionType: automation.actionType,
            candidateCount: 1,
          })
          return true
        }

        if (shouldConfirmFirstFrame && firstFrame) {
          const candidates = await candidatesByDirection(controller, firstFrame.id, 'first_frame')
          const selections = Object.fromEntries(
            candidates.map((candidate) => [candidate.direction, candidate.imageUrl]),
          ) as QuickStartDirectionSelections
          await confirmAllFirstFrameDirections(controller, firstFrame.id, selections)
          return true
        }
        return false
      })().then(
        (changed) => {
          advancing = false
          if (!stopped && changed) advance(controller.getWorkflow())
        },
        (cause: unknown) => {
          advancing = false
          if (stopped) return
          stopped = true
          reportControllerError(
            controller,
            cause instanceof Error ? cause : new Error('Quick Start 自动交付失败'),
          )
        },
      )
    }

    const stop = controller.subscribe(advance)
    advance(controller.getWorkflow())
    return () => {
      stopped = true
      stop()
    }
  }

  function createSession(
    controller: WorkflowController,
    knownSpriteSize?: Project['spriteSize'],
  ): QuickStartSession {
    let stopAutomaticAdvance: (() => void) | null = null
    let stopAutomaticDelivery: (() => void) | null = null
    let candidateCommand: Promise<WorkflowRun> | null = null
    let disposed = false

    const ensureAutomaticAdvance = () => {
      stopAutomaticAdvance ??= startAutomaticActionAdvance(controller)
    }

    return {
      runId: controller.getWorkflow().id,
      getDirectionalMovement: () =>
        projectDirectionalMovements.get(controller.getWorkflow().projectId) ?? 'single',
      getWorkflow: () => controller.getWorkflow(),
      subscribe: (listener) => controller.subscribe(listener),
      subscribeErrors(listener) {
        const listeners = controllerErrorChannels.get(controller)?.listeners
        if (!listeners) return () => undefined
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      async resume({ automaticActionAdvance = true } = {}) {
        disposed = false
        await controller.resume()
        if (!disposed && automaticActionAdvance) {
          ensureAutomaticAdvance()
          stopAutomaticDelivery ??= startAutomaticDelivery(controller)
        }
        return controller.getWorkflow()
      },
      async interrupt() {
        await controller.interrupt()
        stopAutomaticAdvance?.()
        stopAutomaticAdvance = null
        stopAutomaticDelivery?.()
        stopAutomaticDelivery = null
        return controller.getWorkflow()
      },
      dispose() {
        disposed = true
        stopAutomaticAdvance?.()
        stopAutomaticAdvance = null
        stopAutomaticDelivery?.()
        stopAutomaticDelivery = null
        controllerErrorChannels.get(controller)?.listeners.clear()
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
        const setup = setupNode(controller.getWorkflow())
        if (
          template.selectedImageUrl &&
          !template.selectedImages?.east &&
          setup.input.characterId &&
          characterApis
        ) {
          const character = await characterApis.get(setup.input.characterId)
          const outfit =
            character.outfits.find((item) => item.previewUrl === template.selectedImageUrl) ??
            character.outfits.find((item) => item.id === 'outfit-default')
          if (!outfit) throw new Error('角色母版缺少可用造型')
        }
        const target = await persistCharacterTemplate(
          controller,
          templateReference,
          (_setupId, characterId) =>
            controller.confirmCharacterTemplate(
              template.id,
              templateReference,
              characterId,
              'east',
            ),
        )
        const spriteSize =
          knownSpriteSize ?? (await resolveProjectSpriteSize(controller.getWorkflow().projectId))
        if (generationDirectionsFor(controller).length > 1) {
          await controller.generateCharacterTemplate(setupNode(controller.getWorkflow()).id, {
            spriteWidth: spriteSize.width,
            spriteHeight: spriteSize.height,
          })
        } else {
          await prepareAction(controller, target.outfitId, actionDescription, spriteSize)
        }
        ensureAutomaticAdvance()
        return controller.getWorkflow()
      },
      async addAction(outfitId, actionDescription) {
        const prompt = actionDescription.trim()
        if (!prompt) throw new Error('请先描述要新增的动作')
        const run = controller.getWorkflow()
        const characterId = setupNode(run).input.characterId
        if (characterApis && characterId) {
          const character = await characterApis.get(characterId)
          if (character.workflowRunId !== run.id) {
            throw new Error('当前角色未绑定这条 WorkflowRun，不能追加动作')
          }
          if (!character.outfits.some((outfit) => outfit.id === outfitId)) {
            throw new Error('当前角色没有这个造型，不能追加动作')
          }
        }
        const spriteSize = knownSpriteSize ?? (await resolveProjectSpriteSize(run.projectId))
        await prepareAction(controller, outfitId, prompt, spriteSize)
        ensureAutomaticAdvance()
        return controller.getWorkflow()
      },
      confirmCandidate(selection, actionDescription) {
        if (candidateCommand) return candidateCommand
        const command = (async () => {
          const template = templateNode(controller.getWorkflow())
          const setup = setupNode(controller.getWorkflow())
          const existingSelections: QuickStartDirectionSelections = {
            ...(template.selectedImageUrl ? { east: template.selectedImageUrl } : {}),
            ...(template.selectedImages ?? {}),
          }
          const requestedSelections: QuickStartDirectionSelections = {
            ...existingSelections,
            ...(typeof selection === 'string' ? { east: selection } : selection),
          }
          const selectedImageUrl = requestedSelections.east
          if (!selectedImageUrl) throw new Error('请先选择一张角色母版')
          let target: { characterId: string; outfitId: string }
          const hasConfirmedMaster = Boolean(template.selectedImageUrl && setup.input.characterId)
          if (
            hasConfirmedMaster &&
            template.status === 'active' &&
            template.phase === 'selecting' &&
            template.selectedImageUrl &&
            setup.input.characterId &&
            characterApis
          ) {
            const character = await characterApis.get(setup.input.characterId)
            const outfit =
              character.outfits.find((item) => item.previewUrl === template.selectedImageUrl) ??
              character.outfits.find((item) => item.id === 'outfit-default')
            if (!outfit) throw new Error('角色母版缺少可用造型')
            target = { characterId: character.id, outfitId: outfit.id }
          } else {
            target = await persistCharacterTemplate(
              controller,
              selectedImageUrl,
              (_setupId, characterId) =>
                controller.confirmCharacterTemplate(template.id, selectedImageUrl, characterId),
            )
          }
          const directions = generationDirectionsFor(controller)
          if (!hasConfirmedMaster && directions.length > 1) {
            const spriteSize =
              knownSpriteSize ??
              (await resolveProjectSpriteSize(controller.getWorkflow().projectId))
            await controller.generateCharacterTemplate(setup.id, {
              spriteWidth: spriteSize.width,
              spriteHeight: spriteSize.height,
              sourceImageUrl: selectedImageUrl,
              directions: directions.slice(1),
              candidateCount: 1,
            })
            return controller.getWorkflow()
          }
          const selectedImages = selectedDirections(controller, requestedSelections)
          await confirmRemainingTemplateDirections(controller, target.characterId, selectedImages)
          const spriteSize =
            knownSpriteSize ?? (await resolveProjectSpriteSize(controller.getWorkflow().projectId))
          await prepareAction(controller, target.outfitId, actionDescription ?? '', spriteSize)
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
        return candidatesByDirection(controller, firstFrame.id, 'first_frame')
      },
      async confirmFirstFrame(selectedImages) {
        const firstFrame = latestActionFirstFrame(controller.getWorkflow())
        if (!firstFrame || firstFrame.type !== 'action-first-frame') {
          throw new Error('当前运行没有可确认的动作首帧')
        }
        await confirmAllFirstFrameDirections(controller, firstFrame.id, selectedImages)
        ensureAutomaticAdvance()
        return controller.getWorkflow()
      },
      async getFailedGenerationDirections() {
        const failed: QuickStartFailedDirection[] = []
        for (const node of controller.getWorkflow().nodes) {
          if (node.deletedAt || node.status !== 'failed') continue
          const role =
            node.type === 'character-template'
              ? 'character_template'
              : node.type === 'action-first-frame'
                ? 'first_frame'
                : node.type === 'action-full-frame'
                  ? 'complete_animation'
                  : null
          if (!role) continue
          const generations = await controller.getGenerations(node.id, role)
          node.generations
            .filter((reference) => reference.role === role)
            .forEach((reference, index) => {
              if (generations[index]?.status === 'failed') {
                failed.push({ nodeId: node.id, direction: reference.direction ?? 'east' })
              }
            })
        }
        return failed
      },
      async retryGenerationDirection(nodeId, direction) {
        const spriteSize =
          knownSpriteSize ?? (await resolveProjectSpriteSize(controller.getWorkflow().projectId))
        await controller.retryGenerationDirection(nodeId, direction, {
          spriteWidth: spriteSize.width,
          spriteHeight: spriteSize.height,
          referenceMedia: [],
        })
        ensureAutomaticAdvance()
        return controller.getWorkflow()
      },
      getWorkflowAgentContext() {
        const run = controller.getWorkflow()
        const availableTools: WorkflowAgentContext['availableTools'][number][] = []
        const template = run.nodes.find((node) => node.type === 'character-template')
        if (
          template?.type === 'character-template' &&
          template.status === 'passed' &&
          template.phase === 'completed' &&
          template.selectedImageUrl
        ) {
          availableTools.push(REGENERATE_CHARACTER_TEMPLATE_TOOL, REFINE_CHARACTER_TEMPLATE_TOOL)
        }
        const firstFrame = latestActionFirstFrame(run)
        if (
          firstFrame?.type === 'action-first-frame' &&
          firstFrame.status === 'passed' &&
          firstFrame.phase === 'completed' &&
          firstFrame.selectedFirstFrameUrl
        ) {
          availableTools.push(REGENERATE_FIRST_FRAME_TOOL, REFINE_FIRST_FRAME_TOOL)
        }
        return { availableTools }
      },
      async regenerateCharacterTemplate(mode, adjustmentPrompt) {
        const run = controller.getWorkflow()
        const template = templateNode(run)
        const spriteSize =
          knownSpriteSize ?? (await resolveProjectSpriteSize(controller.getWorkflow().projectId))
        await controller.regenerateCharacterTemplate(template.id, {
          spriteWidth: spriteSize.width,
          spriteHeight: spriteSize.height,
          mode,
          ...(adjustmentPrompt === undefined ? {} : { adjustmentPrompt }),
        })
        return controller.getWorkflow()
      },
      async regenerateFirstFrame(mode, adjustmentPrompt) {
        const firstFrame = latestActionFirstFrame(controller.getWorkflow())
        if (!firstFrame || firstFrame.type !== 'action-first-frame') {
          throw new Error('当前运行没有可重新生成的动作首帧')
        }
        const spriteSize =
          knownSpriteSize ?? (await resolveProjectSpriteSize(controller.getWorkflow().projectId))
        await controller.regenerateFirstFrame(firstFrame.id, {
          spriteWidth: spriteSize.width,
          spriteHeight: spriteSize.height,
          mode,
          ...(adjustmentPrompt === undefined ? {} : { adjustmentPrompt }),
        })
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

        const generations = await controller.getGenerations(fullFrame.id, 'complete_animation')
        const directionalMovement = projectDirectionalMovements.get(run.projectId) ?? 'single'
        const sequences = createActionSequences(generations, directionalMovement)
        const eastSequence = sequences.find((sequence) => sequence.direction === 'east')!
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
          frameCount: eastSequence.frameCount,
          frames: eastSequence.frames,
          sequences,
        }
        const publishedCharacter = await characterApis.update({
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
        if (review.status === 'active') {
          try {
            await controller.approveReview(review.id)
          } catch (cause) {
            const shouldRollback = await shouldRollbackWorkflowChange(
              run.id,
              (latest) => findReview(latest, fullFrame.id)?.status === 'passed',
            )
            if (shouldRollback) {
              try {
                await characterApis.update({
                  ...character,
                  dataVersion: publishedCharacter.dataVersion,
                })
              } catch {
                try {
                  const latestCharacter = await characterApis.get(character.id)
                  const originalAction = character.outfits
                    .flatMap((outfit) => outfit.actions)
                    .find((item) => item.id === action.id)
                  await characterApis.update({
                    ...latestCharacter,
                    outfits: latestCharacter.outfits.map((outfit) => ({
                      ...outfit,
                      actions: [
                        ...outfit.actions.filter((item) => item.id !== action.id),
                        ...(originalAction?.outfitId === outfit.id ? [originalAction] : []),
                      ],
                    })),
                  })
                } catch (rollbackCause) {
                  onAsyncError(
                    rollbackCause instanceof Error
                      ? rollbackCause
                      : new Error('审核冲突后恢复角色资产失败'),
                  )
                }
              }
            }
            throw cause
          }
        }
        return controller.getWorkflow()
      },
      getCharacterInfo: () => getCharacterInfo(controller),
      resolveCharacterInfo: () => resolveCharacterInfo(controller),
      async getTemplateCandidates() {
        const template = templateNode(controller.getWorkflow())
        return candidatesByDirection(controller, template.id, 'character_template')
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
        if (!characterApis) return null
        const info = getCharacterInfo(controller) ?? (await resolveCharacterInfo(controller))
        if (!info) return null
        const run = controller.getWorkflow()
        const [project, character] = await Promise.all([
          projectApis.get(run.projectId),
          characterApis.get(info.characterId),
        ])
        const generations = (
          await Promise.all(
            run.nodes
              .filter((node) => node.type === 'action-full-frame' && !node.deletedAt)
              .map((node) => controller.getGenerations(node.id, 'complete_animation')),
          )
        ).flat()
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

  return {
    unavailableReason: null,

    async start(prompt, directionalMovement = 'single', options) {
      const normalizedPrompt = prompt.trim()
      if (!normalizedPrompt) throw new Error('请先描述想要创建的角色')
      const project = await prepareProject(normalizedPrompt, directionalMovement, options)
      const projectDirectionalMovement = project.directionalMovement ?? directionalMovement
      projectSpriteSizes.set(project.id, project.spriteSize)
      projectDirectionalMovements.set(project.id, projectDirectionalMovement)
      const controller = await createRun(
        project.id,
        workflowNodes(normalizedPrompt),
        projectDirectionalMovement,
      )
      await controller.generateCharacterTemplate('character-setup', {
        spriteWidth: project.spriteSize.width,
        spriteHeight: project.spriteSize.height,
        directions: ['east'],
        candidateCount: 3,
      })
      return createSession(controller, project.spriteSize)
    },

    async startWithUploadedTemplate(
      file,
      actionDescription,
      signal,
      directionalMovement = 'single',
      options,
    ) {
      if (!mediaApis) throw new Error('媒体上传服务尚未配置，不能使用角色母版')
      const prompt = actionDescription.trim() || file.name.trim()
      if (!prompt) throw new Error('请提供动作描述或有效的图片文件')
      const project = await prepareProject(prompt, directionalMovement, options)
      const projectDirectionalMovement = project.directionalMovement ?? directionalMovement
      projectSpriteSizes.set(project.id, project.spriteSize)
      projectDirectionalMovements.set(project.id, projectDirectionalMovement)
      const templateReference = await mediaApis.upload(file, 'reference-image', signal)
      const controller = await createRun(
        project.id,
        workflowNodes(prompt, [templateReference]),
        projectDirectionalMovement,
      )
      await controller.updateCharacterSetup('character-setup', {
        prompt,
        referenceMedia: [templateReference],
      })
      const target = await persistCharacterTemplate(
        controller,
        templateReference,
        (setupId, characterId) =>
          controller.acceptUploadedCharacterTemplate(setupId, templateReference, characterId),
      )
      const directions = getDirectionProfile(projectDirectionalMovement).generationDirections
      if (directions.length > 1) {
        await controller.generateCharacterTemplate('character-setup', {
          spriteWidth: project.spriteSize.width,
          spriteHeight: project.spriteSize.height,
        })
      } else {
        await prepareAction(controller, target.outfitId, actionDescription, project.spriteSize)
      }
      return createSession(controller, project.spriteSize)
    },

    async open(runId) {
      const run = await workflowRunApis.get(runId)
      const project = await projectApis.get(run.projectId)
      projectSpriteSizes.set(project.id, project.spriteSize)
      projectDirectionalMovements.set(project.id, project.directionalMovement)
      return createSession(createController(run, project.directionalMovement), project.spriteSize)
    },
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
