import type {
  Action,
  ActionFullFrameWorkflowNode,
  ActionGenerationMethod,
  Character,
  CharacterApis,
  CharacterSetupWorkflowNode,
  CharacterTemplateWorkflowNode,
  GenerationApis,
  Project,
  ProjectApis,
  ReviewWorkflowNode,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import {
  createWorkflowController,
  type CreateWorkflowControllerOptions,
  type WorkflowController,
} from '@/features/workflow-controller'

export type QuickStartStatus = 'running' | 'review' | 'completed' | 'failed'

/** WorkflowRun 节点图面向 Quick Start 的只读投影，不建立第二套持久化状态机。 */
export interface QuickStartView {
  runId: string
  status: QuickStartStatus
  title: string
  message: string
  completedNodes: number
  totalNodes: number
  /** Quick Start 自动选择的资产生产路线；当前可执行路线为视频裁剪。 */
  generationMethod: ActionGenerationMethod | null
  fps: number
  animationFrames: readonly string[]
}

export interface StartQuickStartInput {
  prompt: string
  actionDescription: string | null
}

export interface PlaytestTarget {
  characterId: string
  outfitId: string
}

/**
 * App 层把 #107 的单 WorkflowRun Controller 装配成此页面用例。
 * Quick Start 只触发自动选择与连续调用。当前自动选择 video-cropping；
 * 3D 转 2D 接口接通后再由实现层改变策略，页面不拥有节点规则、Store 或后端生成实现。
 */
export interface QuickStartService {
  readonly unavailableReason: string | null
  start(input: StartQuickStartInput): Promise<{ runId: string }>
  load(runId: string): Promise<QuickStartView | null>
  subscribe(runId: string, listener: (view: QuickStartView) => void): () => void
  interrupt(runId: string): Promise<void>
  approve(runId: string): Promise<PlaytestTarget>
}

export interface CreateQuickStartServiceOptions {
  projectApis: ProjectApis
  characterApis: CharacterApis
  workflowRunApis: WorkflowRunApis
  generationApis: GenerationApis
  createController?: (options: CreateWorkflowControllerOptions) => WorkflowController
  createId?: () => string
  onAsyncError?: (error: Error) => void
}

interface QuickStartSession {
  controller: WorkflowController
  project: Project
  characterId: string | null
  ready: boolean
  advancing: Promise<void> | null
  advanceAgain: boolean
  error: string | null
}

/**
 * 将 Quick Start 的“全自动表面”翻译成同一套 WorkflowController 调用。
 * 这里不复制节点状态机；每一步仍先由 Controller 保存 WorkflowRun，再继续下一步。
 */
export function createQuickStartService({
  projectApis,
  characterApis,
  workflowRunApis,
  generationApis,
  createController = createWorkflowController,
  createId = createBrowserSafeId,
  onAsyncError = () => undefined,
}: CreateQuickStartServiceOptions): QuickStartService {
  const sessions = new Map<string, QuickStartSession>()
  const listeners = new Map<string, Set<(view: QuickStartView) => void>>()

  function report(session: QuickStartSession, cause: unknown) {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    session.error = error.message || '自动推进失败'
    onAsyncError(error)
    void publish(session)
  }

  function makeSession(workflow: WorkflowRun | undefined, project: Project): QuickStartSession {
    let session: QuickStartSession
    const controller = createController({
      ...(workflow ? { workflow } : {}),
      workflowRunApis,
      generationApis,
      onAsyncError: (error) => report(session, error),
      onChange: () => {
        if (!session) return
        void publish(session)
        if (session.ready) queueAdvance(session)
      },
    })
    session = {
      controller,
      project,
      characterId: null,
      ready: false,
      advancing: null,
      advanceAgain: false,
      error: null,
    }
    if (workflow) sessions.set(workflow.id, session)
    return session
  }

  async function ensureSession(runId: string): Promise<QuickStartSession> {
    const existing = sessions.get(runId)
    if (existing) return existing
    const workflow = await workflowRunApis.get(runId)
    const project = await projectApis.get(workflow.projectId)
    const session = makeSession(workflow, project)
    session.ready = true
    await session.controller.resume()
    queueAdvance(session)
    return session
  }

  async function resolveCharacter(session: QuickStartSession): Promise<Character> {
    if (session.characterId) return characterApis.get(session.characterId)
    const page = await characterApis.listByProject(session.project.id, { page: 1, pageSize: 100 })
    const character = page.items[0]
    if (!character) throw new Error('Quick Start 项目中没有找到角色资产')
    session.characterId = character.id
    return character
  }

  function queueAdvance(session: QuickStartSession) {
    if (session.advancing) {
      session.advanceAgain = true
      return
    }
    session.advancing = advance(session)
      .catch((cause: unknown) => report(session, cause))
      .finally(() => {
        session.advancing = null
        if (session.advanceAgain) {
          session.advanceAgain = false
          queueAdvance(session)
        }
      })
  }

  async function advance(session: QuickStartSession) {
    for (let attempts = 0; attempts < 8; attempts += 1) {
      const run = session.controller.getWorkflow()
      const setup = run.nodes.find(
        (node): node is CharacterSetupWorkflowNode => node.type === 'character-setup',
      )
      const template = run.nodes.find(
        (node): node is CharacterTemplateWorkflowNode => node.type === 'character-template',
      )
      const action = run.nodes.find((node) => node.type === 'action-first-frame')
      const method = run.nodes.find((node) => node.type === 'action-generation-method')
      const full = run.nodes.find(
        (node): node is ActionFullFrameWorkflowNode => node.type === 'action-full-frame',
      )
      if (!setup || !template || !action || !method || !full) return

      if (setup.status === 'active' && setup.phase === 'configuring') {
        await session.controller.generateCharacter(setup.id, {
          spriteWidth: session.project.spriteSize.width,
          spriteHeight: session.project.spriteSize.height,
        })
        return
      }
      if (template.status === 'active' && template.phase === 'ready') {
        await session.controller.generateCharacter(setup.id, {
          spriteWidth: session.project.spriteSize.width,
          spriteHeight: session.project.spriteSize.height,
        })
        return
      }
      if (template.status === 'active' && template.phase === 'selecting') {
        const generation = await session.controller.getGeneration(template.id, 'character_template')
        const selected =
          generation?.result?.type === 'character_template'
            ? generation.result.images[0]?.url
            : null
        if (!selected) throw new Error('角色母版生成结果中没有候选图')
        const character = await resolveCharacter(session)
        await characterApis.update({ ...character, referenceImageUrl: selected })
        await session.controller.confirmCharacter(template.id, selected)
        continue
      }
      if (action.status === 'active' && action.phase === 'configuring') {
        const character = await resolveCharacter(session)
        await session.controller.generateActionFrame(action.id, {
          characterId: character.id,
          referenceMedia: [],
        })
        return
      }
      if (action.status === 'active' && action.phase === 'selecting') {
        const generation = await session.controller.getGeneration(action.id, 'first_frame')
        const selected =
          generation?.result?.type === 'first_frame' ? generation.result.image.url : null
        if (!selected) throw new Error('动作首帧生成结果无效')
        await session.controller.confirmActionFrame(action.id, selected)
        continue
      }
      if (method.status === 'active' && method.phase === 'selecting') {
        await session.controller.selectActionGenerationMethod(method.id, 'video-cropping')
        continue
      }
      if (full.status === 'active' && full.phase === 'ready') {
        const character = await resolveCharacter(session)
        await session.controller.generateAnimation(full.id, {
          characterId: character.id,
          referenceMedia: [],
        })
        return
      }
      return
    }
    throw new Error('Quick Start 自动推进超过安全步数')
  }

  async function buildView(session: QuickStartSession): Promise<QuickStartView> {
    const run = session.controller.getWorkflow()
    const full = run.nodes.find(
      (node): node is ActionFullFrameWorkflowNode => node.type === 'action-full-frame',
    )
    const method = run.nodes.find((node) => node.type === 'action-generation-method')
    const review = run.nodes.find((node): node is ReviewWorkflowNode => node.type === 'review')
    const setup = run.nodes.find(
      (node): node is CharacterSetupWorkflowNode => node.type === 'character-setup',
    )
    let frames: readonly string[] = []
    if (full?.generations.some((item) => item.role === 'complete_animation')) {
      const generation = await session.controller.getGeneration(full.id, 'complete_animation')
      if (generation?.result?.type === 'complete_animation') {
        frames = generation.result.frames.map((frame) => frame.url)
      }
    }
    const failed = run.nodes.find((node) => node.status === 'failed')
    const status: QuickStartStatus =
      session.error || failed
        ? 'failed'
        : review?.status === 'passed'
          ? 'completed'
          : review?.status === 'active'
            ? 'review'
            : 'running'
    return {
      runId: run.id,
      status,
      title: setup?.input.prompt || session.project.name,
      message: session.error ?? failed?.error ?? progressMessage(run.nodes),
      completedNodes: run.nodes.filter((node) => node.status === 'passed').length,
      totalNodes: run.nodes.length,
      generationMethod: method?.method ?? null,
      fps: run.nodes.find((node) => node.type === 'action-first-frame')?.input.fps ?? 12,
      animationFrames: frames,
    }
  }

  async function publish(session: QuickStartSession) {
    const runId = session.controller.getWorkflow().id
    const subscribers = listeners.get(runId)
    if (!subscribers?.size) return
    try {
      const view = await buildView(session)
      subscribers.forEach((listener) => listener(view))
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      onAsyncError(error)
    }
  }

  return {
    unavailableReason: null,

    async start(input) {
      const prompt = input.prompt.trim()
      if (!prompt) throw new Error('角色描述不能为空')
      const project = await projectApis.create({
        name: prompt.slice(0, 20),
        perspective: 'side',
        directionalMovement: 'single',
        spriteSize: { width: 256, height: 256 },
        gameStyle: null,
        sampleImageUrl: null,
      })
      let character: Character | null = null
      let workflow: WorkflowRun | null = null
      try {
        character = await characterApis.create({
          projectId: project.id,
          name: prompt.slice(0, 50),
          description: prompt,
          referenceImageUrl: null,
        })
        const outfitId = createId()
        character = await characterApis.update({
          ...character,
          outfits: [
            ...character.outfits,
            {
              id: outfitId,
              characterId: character.id,
              name: '默认造型',
              description: null,
              previewUrl: null,
              actions: [],
            },
          ],
        })
        const setupId = createId()
        const templateId = createId()
        const session = makeSession(undefined, project)
        workflow = await session.controller.create({
          projectId: project.id,
          nodes: createCharacterNodes(setupId, templateId, prompt),
        })
        sessions.set(workflow.id, session)
        session.characterId = character.id
        await session.controller.addAction({
          nodeId: createId(),
          input: {
            outfitId,
            name: input.actionDescription?.trim() || '待机',
            type: input.actionDescription?.trim() ? 'custom' : 'idle',
            prompt: input.actionDescription?.trim() || null,
            fps: 12,
          },
        })
        session.ready = true
        queueAdvance(session)
        return { runId: workflow.id }
      } catch (cause) {
        if (workflow) await workflowRunApis.remove(workflow.id).catch(() => undefined)
        if (character) await characterApis.remove(character.id).catch(() => undefined)
        await projectApis.remove(project.id).catch(() => undefined)
        throw cause
      }
    },

    async load(runId) {
      const session = await ensureSession(runId)
      return buildView(session)
    },

    subscribe(runId, listener) {
      const subscribers = listeners.get(runId) ?? new Set()
      subscribers.add(listener)
      listeners.set(runId, subscribers)
      return () => {
        subscribers.delete(listener)
        if (subscribers.size === 0) listeners.delete(runId)
      }
    },

    async interrupt(runId) {
      const session = await ensureSession(runId)
      await session.controller.interrupt()
      await publish(session)
    },

    async approve(runId) {
      const session = await ensureSession(runId)
      const run = session.controller.getWorkflow()
      const actionNode = run.nodes.find((node) => node.type === 'action-first-frame')
      const fullNode = run.nodes.find(
        (node): node is ActionFullFrameWorkflowNode => node.type === 'action-full-frame',
      )
      const reviewNode = run.nodes.find(
        (node): node is ReviewWorkflowNode => node.type === 'review',
      )
      if (!actionNode || !fullNode || !reviewNode || reviewNode.status !== 'active') {
        throw new Error('完整动画尚未进入审核阶段')
      }
      const generation = await session.controller.getGeneration(fullNode.id, 'complete_animation')
      if (generation?.result?.type !== 'complete_animation') {
        throw new Error('完整动画结果无效')
      }
      const character = await resolveCharacter(session)
      const outfit = character.outfits.find((item) => item.id === actionNode.input.outfitId)
      if (!outfit) throw new Error('动作所属造型不存在')
      const action: Action = {
        id: actionNode.id,
        outfitId: outfit.id,
        name: actionNode.input.name,
        type: actionNode.input.type,
        loop: true,
        fps: actionNode.input.fps,
        frameCount: generation.result.frames.length,
        frames: generation.result.frames.map((frame, index) => ({
          index,
          imageUrl: frame.url,
          durationMs: frame.durationMs,
        })),
      }
      await characterApis.update({
        ...character,
        outfits: character.outfits.map((item) =>
          item.id === outfit.id
            ? {
                ...item,
                previewUrl: character.referenceImageUrl,
                actions: [...item.actions.filter((item) => item.id !== action.id), action],
              }
            : item,
        ),
      })
      await session.controller.approveAction(reviewNode.id)
      return { characterId: character.id, outfitId: outfit.id }
    },
  }
}

function createCharacterNodes(setupId: string, templateId: string, prompt: string): WorkflowNode[] {
  return [
    {
      id: setupId,
      type: 'character-setup',
      status: 'active',
      phase: 'configuring',
      dependsOnNodeIds: [],
      generations: [],
      error: null,
      input: { prompt, referenceMedia: [] },
    },
    {
      id: templateId,
      type: 'character-template',
      status: 'locked',
      phase: 'ready',
      dependsOnNodeIds: [setupId],
      generations: [],
      error: null,
      selectedImageUrl: null,
    },
  ]
}

function progressMessage(nodes: readonly WorkflowNode[]): string {
  const active = nodes.find((node) => node.status === 'active')
  if (!active) return '正在准备自动流程'
  if (active.type === 'character-setup') return '正在提交角色设定'
  if (active.type === 'character-template') return '正在生成并选择角色母版'
  if (active.type === 'action-first-frame') return '正在生成并选择动作首帧'
  if (active.type === 'action-generation-method') return '正在选择资产生成路线'
  if (active.type === 'action-full-frame') return '正在通过视频裁剪生成 32 帧动画'
  return '动画已生成，请审核结果'
}

function createBrowserSafeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const UNAVAILABLE_REASON = 'Quick Start 的 WorkflowController 装配尚未配置'

export const unavailableQuickStartService: QuickStartService = {
  unavailableReason: UNAVAILABLE_REASON,
  async start() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async load() {
    return null
  },
  subscribe() {
    return () => undefined
  },
  async interrupt() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async approve() {
    throw new Error(UNAVAILABLE_REASON)
  },
}
