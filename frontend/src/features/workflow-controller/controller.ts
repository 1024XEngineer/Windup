import type {
  CharacterApis,
  Character,
  CharacterSetupNodeInput,
  CharacterActionGenerationInput,
  CharacterActionOutput,
  ActionGenerationMethod,
  GenerationApis,
  MediaReference,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunStore,
} from '@/entities'
import { buildPublishedActionId, publishWorkflowRun } from '@/features/publish'
import {
  createActionGenerationTask,
  getCharacterActionFrameCountError,
} from './action-generation-task'
import { createCharacterTemplateTask } from './character-template-task'
import {
  advanceCharacterSetupState,
  appendActionState,
  acceptUploadedCharacterTemplateState,
  approveReviewState,
  completeActionGenerationState,
  confirmFirstFrameState,
  createWorkflowRunState,
  getActiveNode,
  interruptWorkflowRunState,
  markActionDeletedState,
  selectActionGenerationMethodState,
  restartWorkflowRunState,
  requireActiveWorkflow,
  updateCharacterSetupState,
  type CreateWorkflowRunStateInput,
} from './workflow-state'

/** 创建角色与给已有角色增加动作共用同一条运行状态机。 */
export type CreateWorkflowControllerInput = CreateWorkflowRunStateInput

export interface WorkflowController {
  /** 创建前端执行线，并把完整快照保存到持久化端。 */
  create(input: CreateWorkflowControllerInput): Promise<WorkflowRun>

  /** 只读取当前页面会话缓存；服务端恢复必须调用异步 resume。 */
  peekWorkflow(runId: WorkflowRun['id']): WorkflowRun | null

  /** 按 Character 定位其唯一制作 Run；新增动作必须优先复用该 Run。 */
  getWorkflowByCharacter(characterId: string): Promise<WorkflowRun | null>

  /** 订阅当前页面会话中的运行状态；持久化实现不承担 UI 通知。 */
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void

  /** 在同一条 Run 中追加独立的动作四节点分支；不等待其他 Action 审核完成。 */
  appendAction(runId: WorkflowRun['id']): Promise<WorkflowRun>

  /** 修改当前角色资料节点，页面无需知道节点内部 ID。 */
  updateCharacterSetup(
    runId: WorkflowRun['id'],
    input: CharacterSetupNodeInput,
  ): Promise<WorkflowRun>

  /** 采用已上传的角色母版，跳过图片生成与候选选择并激活动作生成。 */
  acceptUploadedCharacterTemplate(
    runId: WorkflowRun['id'],
    templateUrl: MediaReference,
  ): Promise<WorkflowRun>

  /**
   * 推进一个节点。当前纵切只实现角色资料到角色图生成；
   * 后续节点进入各自实现 PR 后再扩展，不在这里伪造完成。
   * spriteSize 为项目精灵图尺寸，角色图生成节点需要传给后端做尺寸校验。
   */
  nextStep(
    runId: WorkflowRun['id'],
    spriteSize?: { width: number; height: number },
  ): Promise<WorkflowRun>

  /** 页面恢复时先读取任务终态；仍在运行时再恢复订阅。 */
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>

  /** 只停止前端自动推进和任务订阅；后端当前没有取消任务能力。 */
  interrupt(runId: WorkflowRun['id']): Promise<WorkflowRun>

  /** 确认首帧生成完成，推进到完整帧率生成。 */
  confirmFirstFrame(runId: WorkflowRun['id'], nodeId?: WorkflowNode['id']): Promise<WorkflowRun>

  /** 保存资产生成路线，再开放完整动画节点。 */
  selectActionGenerationMethod(
    runId: WorkflowRun['id'],
    method: ActionGenerationMethod,
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun>

  /**
   * 采用已确认的角色母版，并统一完成 Character 落库、Run 绑定与动作任务提交。
   * Quick Start 和 Workflow Editor 都调用这个命令，页面不再各自复制业务编排。
   */
  startActionFromTemplate(
    runId: WorkflowRun['id'],
    templateImageUrl: string,
    actionDescription?: string,
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun>

  /** 动作生成完成后写回结果，标记当前动作节点为 passed。 */
  completeActionGeneration(
    runId: WorkflowRun['id'],
    result: CharacterActionOutput | { error: string },
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun>

  /** 提交完整动作生成，并由 Controller 统一处理订阅和刷新恢复。 */
  startActionGeneration(
    runId: WorkflowRun['id'],
    input: CharacterActionGenerationInput,
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun>

  /** 审核通过后完成当前版本和整条运行；不在这里执行发布或下载。 */
  approveReview(runId: WorkflowRun['id'], nodeId?: WorkflowNode['id']): Promise<WorkflowRun>

  /** 审核当前动作并写入正式 Character；发布失败后允许用同一 Run 重试。 */
  approveAndPublish(
    runId: WorkflowRun['id'],
    reviewNodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun>

  /** 从当前执行线中一个已通过的节点重新开始。 */
  restart(runId: WorkflowRun['id'], nodeId: string): Promise<WorkflowRun>

  /** 删除正式 Action，并在 WorkflowRun 中保留但标记对应动作分支。 */
  deletePublishedAction(
    characterId: Character['id'],
    outfitId: string,
    actionId: string,
  ): Promise<Character>

  /** 删除角色造型；若它绑定制作 Run，同时删除服务端 Run 记录。 */
  deleteOutfitAsset(characterId: Character['id'], outfitId: string): Promise<Character | null>
}

export interface CreateWorkflowControllerOptions {
  store: WorkflowRunStore
  generationApis: GenerationApis
  /** 创建角色流程需要该接口；只操作已有角色动作时可不配置。 */
  characterApis?: CharacterApis
  /** 测试可注入确定性 ID；生产默认使用浏览器随机 UUID。 */
  createId?: (scope: 'run' | 'submission') => string
  /** 测试可注入确定性时间。 */
  now?: () => string
}

/**
 * Quick Start 与手动工作流共用的流程协调器。
 *
 * Controller 只负责读取当前节点、保存状态并委派角色图任务；纯状态转换和异步任务
 * 生命周期分别留在本 Feature 的内部模块。生产接入必须复用同一个 Controller 实例，
 * 不能在组件渲染期间重复创建。
 */
export function createWorkflowController({
  store,
  generationApis,
  characterApis,
  createId = createRuntimeId,
  now = () => new Date().toISOString(),
}: CreateWorkflowControllerOptions): WorkflowController {
  const cache = new Map<WorkflowRun['id'], WorkflowRun>()
  const listeners = new Map<WorkflowRun['id'], Set<(run: WorkflowRun) => void>>()
  const saveQueues = new Map<WorkflowRun['id'], Promise<void>>()
  const persistedSnapshots = new Map<WorkflowRun['id'], WorkflowRun>()
  const mutationVersions = new Map<WorkflowRun['id'], number>()
  const templateActionSubmissions = new Map<string, Promise<WorkflowRun>>()

  function notify(run: WorkflowRun) {
    const snapshot = structuredClone(run)
    for (const listener of listeners.get(snapshot.id) ?? []) {
      try {
        listener(structuredClone(snapshot))
      } catch {
        // 一个页面订阅者渲染失败不能阻断持久化，也不能影响其他订阅者。
      }
    }
    return structuredClone(snapshot)
  }

  function rememberStored(run: WorkflowRun) {
    const snapshot = structuredClone(run)
    cache.set(snapshot.id, snapshot)
    persistedSnapshots.set(snapshot.id, structuredClone(snapshot))
    return notify(snapshot)
  }

  async function load(runId: WorkflowRun['id']) {
    const cached = cache.get(runId)
    if (cached) return structuredClone(cached)
    const stored = await store.get(runId)
    return stored ? rememberStored(stored) : null
  }

  async function persist(run: WorkflowRun) {
    const snapshot = structuredClone(run)
    const version = (mutationVersions.get(snapshot.id) ?? 0) + 1
    mutationVersions.set(snapshot.id, version)
    cache.set(snapshot.id, structuredClone(snapshot))
    // 同一 Run 的网络写入必须保持调用顺序，避免较慢的旧请求最后落库覆盖新状态。
    const previous = saveQueues.get(snapshot.id) ?? Promise.resolve()
    const pending = previous
      .catch(() => undefined)
      .then(() => store.save(structuredClone(snapshot)))
    saveQueues.set(snapshot.id, pending)
    try {
      await pending
      persistedSnapshots.set(snapshot.id, structuredClone(snapshot))
      if (mutationVersions.get(snapshot.id) === version) notify(snapshot)
    } catch (cause) {
      if (mutationVersions.get(snapshot.id) === version) {
        const fallback = persistedSnapshots.get(snapshot.id)
        if (fallback) {
          cache.set(snapshot.id, structuredClone(fallback))
          notify(fallback)
        } else {
          cache.delete(snapshot.id)
        }
      }
      throw cause
    } finally {
      if (saveQueues.get(snapshot.id) === pending) saveQueues.delete(snapshot.id)
    }
    return snapshot
  }

  const taskStore: WorkflowRunStore = {
    create: (input) => store.create(input),
    get: load,
    getByCharacter: async (characterId) => {
      const cached = [...cache.values()].find((run) => run.characterId === characterId)
      if (cached) return structuredClone(cached)
      const stored = await store.getByCharacter(characterId)
      return stored ? rememberStored(stored) : null
    },
    list: (projectId) => store.list(projectId),
    save: async (run) => {
      await persist(run)
    },
    remove: (runId) => store.remove(runId),
  }

  const characterTemplateTask = createCharacterTemplateTask({
    store: taskStore,
    generationApis,
    createSubmissionId: () => createId('submission'),
  })
  const actionGenerationTask = createActionGenerationTask({
    store: taskStore,
    generationApis,
    createSubmissionId: () => createId('submission'),
  })

  function peekWorkflow(runId: WorkflowRun['id']) {
    const run = cache.get(runId)
    return run ? structuredClone(run) : null
  }

  async function getWorkflowByCharacter(characterId: string) {
    const run = [...cache.values()].find((item) => item.characterId === characterId)
    if (run) return structuredClone(run)
    const stored = await store.getByCharacter(characterId)
    return stored ? rememberStored(stored) : null
  }

  async function requireWorkflow(runId: WorkflowRun['id']) {
    const run = await load(runId)
    if (!run) throw new Error(`WorkflowRun 不存在：${runId}`)
    return run
  }

  function subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void) {
    const runListeners = listeners.get(runId) ?? new Set<(run: WorkflowRun) => void>()
    runListeners.add(listener)
    listeners.set(runId, runListeners)
    return () => {
      runListeners.delete(listener)
      if (runListeners.size === 0) listeners.delete(runId)
    }
  }

  async function create(input: CreateWorkflowControllerInput): Promise<WorkflowRun> {
    const created = await store.create(input)
    rememberStored(created)
    return persist(
      createWorkflowRunState(input, {
        runId: created.id || createId('run'),
        createdAt: created.createdAt || now(),
      }),
    )
  }

  async function appendAction(runId: WorkflowRun['id']): Promise<WorkflowRun> {
    return persist(appendActionState(await requireWorkflow(runId)))
  }

  async function updateCharacterSetup(
    runId: WorkflowRun['id'],
    input: CharacterSetupNodeInput,
  ): Promise<WorkflowRun> {
    return persist(updateCharacterSetupState(await requireWorkflow(runId), input))
  }

  async function acceptUploadedCharacterTemplate(
    runId: WorkflowRun['id'],
    templateUrl: MediaReference,
  ): Promise<WorkflowRun> {
    return persist(acceptUploadedCharacterTemplateState(await requireWorkflow(runId), templateUrl))
  }

  async function nextStep(
    runId: WorkflowRun['id'],
    spriteSize?: { width: number; height: number },
  ): Promise<WorkflowRun> {
    const run = requireActiveWorkflow(await requireWorkflow(runId))
    const activeNode = getActiveNode(run)
    if (!activeNode) throw new Error('当前 WorkflowRun 没有 active 节点')

    if (activeNode.type === 'character-template') {
      return characterTemplateTask.start(runId, {
        runId: run.id,
        nodeId: activeNode.id,
      })
    }
    if (activeNode.type !== 'character-setup') {
      throw new Error(`节点 ${activeNode.type} 尚未进入本轮实现`)
    }

    if (!spriteSize) throw new Error('推进角色资料节点需要项目精灵图尺寸')

    const transitioned = advanceCharacterSetupState(run, spriteSize)
    await persist(transitioned.run)
    return characterTemplateTask.start(runId, transitioned.target)
  }

  function resume(runId: WorkflowRun['id']) {
    return load(runId).then((run) => {
      if (!run || run.status !== 'active') return run
      const hasActiveActionGeneration = run.nodes.some(
        (node) =>
          node.status === 'active' &&
          !node.deletedAt &&
          (node.type === 'action-first-frame' || node.type === 'action-full-frame'),
      )
      return hasActiveActionGeneration
        ? actionGenerationTask.resume(runId)
        : characterTemplateTask.resume(runId)
    })
  }

  async function interrupt(runId: WorkflowRun['id']): Promise<WorkflowRun> {
    const latest = await requireWorkflow(runId)
    if (latest.status !== 'active') return latest
    // persist() 会在第一次 await 前先把 interrupted 快照写入缓存；晚到的 SSE 回调
    // 因而会看到不可推进状态，而不是在取消订阅后继续覆盖节点。
    const interrupted = persist(interruptWorkflowRunState(latest))
    characterTemplateTask.stop(runId)
    actionGenerationTask.stop(runId)
    return interrupted
  }

  async function confirmFirstFrame(
    runId: WorkflowRun['id'],
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun> {
    return persist(confirmFirstFrameState(await requireWorkflow(runId), nodeId))
  }

  async function selectActionGenerationMethod(
    runId: WorkflowRun['id'],
    method: ActionGenerationMethod,
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun> {
    return persist(selectActionGenerationMethodState(await requireWorkflow(runId), method, nodeId))
  }

  async function startActionFromTemplate(
    runId: WorkflowRun['id'],
    templateImageUrl: string,
    actionDescription?: string,
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun> {
    const submissionKey = `${runId}:${nodeId ?? 'active'}`
    const pending = templateActionSubmissions.get(submissionKey)
    if (pending) return pending
    const submission = submitActionFromTemplate(
      runId,
      templateImageUrl,
      actionDescription,
      nodeId,
    ).finally(() => templateActionSubmissions.delete(submissionKey))
    templateActionSubmissions.set(submissionKey, submission)
    return submission
  }

  async function submitActionFromTemplate(
    runId: WorkflowRun['id'],
    templateImageUrl: string,
    actionDescription?: string,
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun> {
    if (!characterApis) throw new Error('角色服务尚未配置，不能开始动作生成')

    const run = await requireWorkflow(runId)
    const targetNode = getTemplateActionInputNode(run, nodeId)
    let character: Awaited<ReturnType<CharacterApis['create']>> | null = null
    let bound = false
    try {
      character = await characterApis.create({
        projectId: run.projectId,
        description: 'Workflow auto-created character',
        referenceImageUrl: templateImageUrl,
      })

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

      const outfitId = character.outfits[0]?.id
      if (!outfitId) throw new Error('角色服务没有返回可用的造型 ID')

      const latest = await requireWorkflow(runId)
      const latestTarget = getTemplateActionInputNode(latest, targetNode.id)
      if (latestTarget.id !== targetNode.id) {
        throw new Error('角色母版节点已变更，不能继续提交动作生成')
      }
      const boundRun = await persist({
        ...latest,
        characterId: character.id,
        outfitId,
      })
      bound = true
      const prompt = actionDescription?.trim()

      return await actionGenerationTask.start(
        runId,
        {
          type: 'character_action',
          projectId: boundRun.projectId,
          characterId: character.id,
          outfitId,
          actionType: prompt ? 'custom' : 'idle',
          firstFrameUrl: null,
          prompt: prompt || null,
          referenceMedia: [templateImageUrl as MediaReference],
          numFrames: 1,
        },
        targetNode.id,
      )
    } catch (error) {
      if (!bound && character) {
        try {
          await characterApis.remove(character.id)
        } catch (cleanupError) {
          console.error('[workflow] 清理未绑定角色失败', cleanupError)
        }
      }
      const failedRun = await load(runId)
      if (bound && failedRun?.status === 'active') {
        const activeNode = getActiveNode(failedRun, targetNode.id)
        if (
          (activeNode?.type === 'action-first-frame' || activeNode?.type === 'action-full-frame') &&
          !activeNode.taskId &&
          !activeNode.submissionId
        ) {
          const message =
            error instanceof Error && error.message.trim() ? error.message.trim() : '动作生成失败'
          await persist(completeActionGenerationState(failedRun, { error: message }, targetNode.id))
        }
      }
      throw error
    }
  }

  async function completeActionGeneration(
    runId: WorkflowRun['id'],
    result: CharacterActionOutput | { error: string },
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun> {
    const run = await requireWorkflow(runId)
    if (run.status !== 'active') {
      console.warn('[completeActionGen] run not active:', run.status)
      return run
    }
    const node = getActiveNode(run, nodeId)
    if (!node || node.status !== 'active') {
      console.warn('[completeActionGen] node not active:', node?.type, node?.status)
      return run
    }
    if (node.type !== 'action-first-frame' && node.type !== 'action-full-frame') {
      throw new Error('当前节点不是动作生成节点')
    }
    if ('error' in result) return persist(completeActionGenerationState(run, result, node.id))

    const expectedFrameCount =
      node.input?.numFrames ?? (node.type === 'action-first-frame' ? 1 : undefined)
    const frameCountError = getCharacterActionFrameCountError(result, expectedFrameCount)
    return persist(
      completeActionGenerationState(
        run,
        frameCountError ? { error: frameCountError } : result,
        node.id,
      ),
    )
  }

  function startActionGeneration(
    runId: WorkflowRun['id'],
    input: CharacterActionGenerationInput,
    nodeId?: WorkflowNode['id'],
  ) {
    return actionGenerationTask.start(runId, input, nodeId)
  }

  async function approveReview(
    runId: WorkflowRun['id'],
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun> {
    return persist(approveReviewState(await requireWorkflow(runId), nodeId))
  }

  async function approveAndPublish(
    runId: WorkflowRun['id'],
    reviewNodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun> {
    if (!characterApis) throw new Error('角色服务尚未配置，不能发布资产')
    const run = await requireWorkflow(runId)
    const reviewStep = reviewNodeId
      ? run.nodes.find((node) => node.id === reviewNodeId && node.type === 'review')
      : (run.nodes.findLast(
          (node) => node.type === 'review' && !node.deletedAt && node.status === 'active',
        ) ??
        run.nodes.findLast(
          (node) => node.type === 'review' && !node.deletedAt && node.status === 'passed',
        ))
    if (!reviewStep) throw new Error('审核节点尚未就绪，不能发布资产')
    const approved =
      run.status === 'active' && reviewStep?.status === 'active'
        ? await approveReview(runId, reviewStep.id)
        : reviewStep?.status === 'passed'
          ? run
          : null
    if (!approved) throw new Error('审核节点尚未就绪，不能发布资产')

    const actionNodeId = reviewStep.dependsOnNodeIds.find((dependencyId) =>
      approved.nodes.some((node) => node.id === dependencyId && node.type === 'action-full-frame'),
    )
    if (!actionNodeId) throw new Error('审核节点没有关联完整动画节点')
    await publishWorkflowRun(characterApis, approved, actionNodeId)
    return approved
  }

  async function restart(runId: WorkflowRun['id'], nodeId: string): Promise<WorkflowRun> {
    characterTemplateTask.stop(runId)
    actionGenerationTask.stop(runId)
    return persist(restartWorkflowRunState(await requireWorkflow(runId), nodeId))
  }

  async function deletePublishedAction(
    characterId: Character['id'],
    outfitId: string,
    actionId: string,
  ): Promise<Character> {
    if (!characterApis) throw new Error('角色服务尚未配置，不能删除动作资产')
    const source = await characterApis.get(characterId)
    const outfit = source.outfits.find((item) => item.id === outfitId)
    if (!outfit) throw new Error('没有找到需要删除动作的造型')
    if (!outfit.actions.some((action) => action.id === actionId)) {
      throw new Error('没有找到需要删除的动作')
    }

    const run = await getWorkflowByCharacter(characterId)
    const actionNode = run?.nodes.find(
      (node) =>
        node.type === 'action-full-frame' &&
        !node.deletedAt &&
        buildPublishedActionId(characterId, run.id, node.id) === actionId,
    )
    const saved = await characterApis.update({
      ...source,
      outfits: source.outfits.map((item) =>
        item.id === outfitId
          ? { ...item, actions: item.actions.filter((action) => action.id !== actionId) }
          : item,
      ),
    })
    if (run && actionNode) {
      try {
        await persist(markActionDeletedState(run, actionNode.id, now()))
      } catch (cause) {
        try {
          await characterApis.update(source)
        } catch (rollbackCause) {
          console.error('[workflow] 动作删除回滚失败', rollbackCause)
        }
        throw cause
      }
    }
    return saved
  }

  async function deleteOutfitAsset(
    characterId: Character['id'],
    outfitId: string,
  ): Promise<Character | null> {
    if (!characterApis) throw new Error('角色服务尚未配置，不能删除角色资产')
    const source = await characterApis.get(characterId)
    if (!source.outfits.some((item) => item.id === outfitId)) {
      throw new Error('没有找到需要删除的造型')
    }
    const saved =
      source.outfits.length === 1
        ? (await characterApis.remove(characterId), null)
        : await characterApis.update({
            ...source,
            outfits: source.outfits.filter((item) => item.id !== outfitId),
          })
    const run = await getWorkflowByCharacter(characterId)
    if (run?.outfitId === outfitId) {
      characterTemplateTask.stop(run.id)
      actionGenerationTask.stop(run.id)
      await store.remove(run.id)
      cache.delete(run.id)
      persistedSnapshots.delete(run.id)
      listeners.delete(run.id)
      mutationVersions.delete(run.id)
      saveQueues.delete(run.id)
    }
    return saved
  }

  return {
    create,
    peekWorkflow,
    getWorkflowByCharacter,
    subscribe,
    appendAction,
    updateCharacterSetup,
    acceptUploadedCharacterTemplate,
    nextStep,
    confirmFirstFrame,
    selectActionGenerationMethod,
    startActionFromTemplate,
    completeActionGeneration,
    startActionGeneration,
    approveReview,
    approveAndPublish,
    restart,
    deletePublishedAction,
    deleteOutfitAsset,
    resume,
    interrupt,
  }
}

function getTemplateActionInputNode(run: WorkflowRun, nodeId?: WorkflowNode['id']) {
  const firstFrameNode = nodeId
    ? run.nodes.find((node) => node.id === nodeId && node.type === 'action-first-frame')
    : run.nodes.find(
        (node) => node.type === 'action-first-frame' && !node.deletedAt && node.status === 'active',
      )
  if (firstFrameNode?.status === 'active' && !firstFrameNode.deletedAt) return firstFrameNode
  throw new Error('当前流程状态不能开始动作生成')
}

function createRuntimeId(scope: 'run' | 'submission') {
  const suffix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${scope}-${suffix}`
}
