/**
 * WorkflowRun 的可执行前端用例。
 *
 * Store 只保存快照，本 Service 才真正组合 Generation/Character 端口完成业务：
 * 生成 4 张角色候选、确认 1 张为正式角色、创建独立动作 Run、
 * 生成 4 张动作首帧候选、根据选中首帧生成完整动画，
 * 并在审核后写入角色资产。
 */

import type { Action, ActionType, Character, CharacterApis, Frame } from '../../character'
import type {
  CharacterTemplateGenerationResult,
  CompleteAnimationGenerationResult,
  Generation,
  GenerationApis,
  GenerationEvent,
} from '../../generation'
import type { MediaReference } from '../../media'
import { ACTION_FIRST_FRAME_CANDIDATE_COUNT, CHARACTER_CANDIDATE_COUNT } from '../model'
import type { WorkflowRevision, WorkflowRun, WorkflowStep, WorkflowStepType } from '../model'
import type { WorkflowRunStore } from '../store'

/**
 * 确认角色候选的后端原子操作。
 *
 * 后端必须在同一用例中保存选中图、返回正式角色/造型 ID，
 * 并安排清理同一 generationId 下的其余 3 张候选。
 * 前端不能用“先创建角色、再单独删图”的两步请求伪装原子性。
 */
export interface CharacterCandidateConfirmationApis {
  confirmSelection(input: {
    projectId: string
    generationId: string
    selectedImageUrl: string
    description: string
  }): Promise<{ character: Character; outfitId: string }>
}

export interface StartCharacterRunInput {
  projectId: string
  prompt: string
  driver: 'ai' | 'manual'
  referenceMedia?: readonly MediaReference[]
}

export interface CharacterCandidateBatch {
  run: WorkflowRun
  generationId: string
  /** 仅供当前选择界面使用，不写入 WorkflowRun/localStorage。 */
  candidates: readonly string[]
}

export interface ConfirmCharacterSelectionInput {
  runId: string
  selectedImageUrl: string
}

export interface StartActionRunInput {
  projectId: string
  characterId: string
  outfitId: string
  actionName: string
  actionType: ActionType
  prompt?: string | null
  fps: number
  driver: 'ai' | 'manual'
}

export interface ActionFirstFrameCandidateBatch {
  run: WorkflowRun
  /** 4 张图分别对应 4 个后端 Generation，顺序与 candidateTaskIds 一致。 */
  candidateTaskIds: readonly string[]
  /** 仅供当前首帧选择界面使用，不写入 WorkflowRun/localStorage。 */
  candidates: readonly string[]
}

export interface ConfirmActionFirstFrameInput {
  runId: string
  selectedImageUrl: string
}

/**
 * 动作审核页真正需要的一帧。
 *
 * 这里不直接把 Generation 的 DTO 暴露给页面：Generation 负责描述后端任务结果，
 * WorkflowRun 则只交付当前任务已经确认可用于审核的图片地址。
 */
export interface ActionReviewFrame {
  imageUrl: string
}

/**
 * 完整动画生成结束后的只读审核结果。
 *
 * generationId 让调用方能够定位本次完整动画任务；frames 的数组顺序就是播放顺序。
 * 读取该结果不会修改 Run，也不会把临时图片 URL 写进 WorkflowRun 快照。
 */
export interface ActionReviewResult {
  /** 审核结果只可能属于动作任务，调用方无需再次判断 purpose。 */
  run: Extract<WorkflowRun, { purpose: 'add_action' }>
  generationId: string
  frames: readonly ActionReviewFrame[]
}

export interface PublishActionResult {
  run: WorkflowRun
  character: Character
  characterId: string
  outfitId: string
  actionId: string
}

export interface WorkflowRunService {
  /** 暂停进行中的 Run；当前 Revision 和 active 步骤保持不变。 */
  interruptRun(runId: string): WorkflowRun
  /** 将已暂停的 Run 恢复为可执行状态；对 active Run 幂等。 */
  continueRun(runId: string): WorkflowRun
  startCharacter(input: StartCharacterRunInput): Promise<CharacterCandidateBatch>
  resumeCharacterCandidates(runId: string): Promise<CharacterCandidateBatch>
  confirmCharacter(input: ConfirmCharacterSelectionInput): Promise<WorkflowRun>
  startAction(input: StartActionRunInput): Promise<ActionFirstFrameCandidateBatch>
  resumeActionFirstFrameCandidates(runId: string): Promise<ActionFirstFrameCandidateBatch>
  confirmActionFirstFrame(input: ConfirmActionFirstFrameInput): Promise<WorkflowRun>
  resumeAction(runId: string): Promise<WorkflowRun>
  getActionReview(runId: string): Promise<ActionReviewResult>
  approveAction(runId: string): Promise<PublishActionResult>
}

export interface CreateWorkflowRunServiceOptions {
  store: WorkflowRunStore
  generationApis: GenerationApis
  characterApis: CharacterApis
  candidateConfirmationApis: CharacterCandidateConfirmationApis
  now?: () => string
}

export function createWorkflowRunService({
  store,
  generationApis,
  characterApis,
  candidateConfirmationApis,
  now = () => new Date().toISOString(),
}: CreateWorkflowRunServiceOptions): WorkflowRunService {
  function interruptRun(runId: string): WorkflowRun {
    const run = requireRun(store, runId)
    if (run.status === 'interrupted') return run
    if (run.status !== 'active') throw new Error('只有进行中的 WorkflowRun 可以中断')

    const interrupted: WorkflowRun = {
      ...run,
      status: 'interrupted',
      updatedAt: now(),
    }
    store.save(interrupted)
    return interrupted
  }

  function continueRun(runId: string): WorkflowRun {
    const run = requireRun(store, runId)
    if (run.status === 'active') return run
    if (run.status !== 'interrupted') throw new Error('只有已中断的 WorkflowRun 可以继续')

    const active: WorkflowRun = {
      ...run,
      status: 'active',
      updatedAt: now(),
    }
    store.save(active)
    return active
  }

  async function startCharacter(input: StartCharacterRunInput): Promise<CharacterCandidateBatch> {
    const prompt = input.prompt.trim()
    if (!prompt) throw new Error('请先描述想要创建的角色')

    let run = store.create({
      projectId: input.projectId,
      purpose: 'create_character',
      driver: input.driver,
      prompt,
    })
    run = advanceStep(run, 'character-setup', 'character-template', now())
    store.save(run)

    try {
      const generation = await generationApis.create({
        type: 'character_template',
        projectId: run.projectId,
        prompt,
        referenceMedia: input.referenceMedia ?? [],
      })
      run = recordTask(run, 'character-template', generation.id, now())
      store.save(run)
      const terminal = await waitForTerminal(generationApis, generation)
      const result = requireCharacterCandidates(terminal)
      run = completeGenerationStep(
        requireRun(store, run.id),
        'character-template',
        'template-candidate',
        now(),
      )
      store.save(run)
      return toCandidateBatch(run, terminal.id, result)
    } catch (cause) {
      failActiveRun(store, run.id, errorMessage(cause, '角色候选生成失败'), now())
      throw asError(cause)
    }
  }

  async function resumeCharacterCandidates(runId: string): Promise<CharacterCandidateBatch> {
    let run = requireRun(store, runId)
    if (run.purpose !== 'create_character') throw new Error('该 WorkflowRun 不是角色生成任务')
    const templateStep = requireStep(run, 'character-template')
    if (!templateStep.taskId) throw new Error('角色生成任务 ID 不存在，无法恢复候选')

    const terminal = await waitForTerminal(
      generationApis,
      await generationApis.get(run.projectId, templateStep.taskId),
    )
    const result = requireCharacterCandidates(terminal)
    if (templateStep.status === 'active') {
      run = completeGenerationStep(run, 'character-template', 'template-candidate', now())
      store.save(run)
    }
    return toCandidateBatch(run, terminal.id, result)
  }

  async function confirmCharacter(input: ConfirmCharacterSelectionInput): Promise<WorkflowRun> {
    const batch = await resumeCharacterCandidates(input.runId)
    if (!batch.candidates.includes(input.selectedImageUrl)) {
      throw new Error('选中图片不属于当前角色生成任务')
    }
    const run = batch.run
    if (run.status !== 'active' || requireStep(run, 'template-candidate').status !== 'active') {
      throw new Error('当前 WorkflowRun 不在候选确认阶段')
    }

    const confirmed = await candidateConfirmationApis.confirmSelection({
      projectId: run.projectId,
      generationId: batch.generationId,
      selectedImageUrl: input.selectedImageUrl,
      description: run.prompt ?? '',
    })
    const outfit = confirmed.character.outfits.find((item) => item.id === confirmed.outfitId)
    if (
      confirmed.character.projectId !== run.projectId ||
      !confirmed.character.id.trim() ||
      !outfit ||
      outfit.characterId !== confirmed.character.id
    ) {
      throw new Error('候选确认接口没有返回有效的角色与造型')
    }

    const selectedAt = now()
    const completed = editCurrentRevision(run, selectedAt, (revision) => {
      const candidate = revision.steps.find((step) => step.type === 'template-candidate')!
      candidate.status = 'passed'
      revision.status = 'completed'
      revision.generationStatus = 'completed'
    }) as WorkflowRun
    if (completed.purpose !== 'create_character') {
      throw new Error('角色确认过程中 WorkflowRun 目的发生了变化')
    }
    const result: WorkflowRun = {
      ...completed,
      purpose: 'create_character',
      status: 'completed',
      characterId: confirmed.character.id,
      outfitId: confirmed.outfitId,
      selectedAt,
      updatedAt: selectedAt,
    }
    store.save(result)
    return result
  }

  async function startAction(input: StartActionRunInput): Promise<ActionFirstFrameCandidateBatch> {
    if (!input.actionName.trim()) throw new Error('请先填写动作名称')
    if (!Number.isFinite(input.fps) || input.fps <= 0) throw new Error('FPS 必须大于 0')

    // 在创建 Run 前校验正式角色，避免错误 ID 留下永远无法继续的空历史。
    const characterImageUrl = await loadCharacterImage(
      input.projectId,
      input.characterId,
      input.outfitId,
    )

    let run = store.create({
      projectId: input.projectId,
      purpose: 'add_action',
      driver: input.driver,
      prompt: input.prompt?.trim() || undefined,
      characterId: input.characterId,
      outfitId: input.outfitId,
      actionName: input.actionName.trim(),
      actionType: input.actionType,
      fps: input.fps,
    })
    run = advanceStep(run, 'action-setup', 'first-frame', now())
    store.save(run)

    try {
      return await collectActionFirstFrameCandidates(run.id, characterImageUrl)
    } catch (cause) {
      failActiveRun(store, run.id, errorMessage(cause, '动作首帧候选生成失败'), now())
      throw asError(cause)
    }
  }

  async function resumeActionFirstFrameCandidates(
    runId: string,
  ): Promise<ActionFirstFrameCandidateBatch> {
    const run = requireRun(store, runId)
    if (run.purpose !== 'add_action') throw new Error('该 WorkflowRun 不是动作任务')
    if (run.status !== 'active') throw new Error('动作任务已经结束，无法恢复首帧候选')
    const characterImageUrl = await loadCharacterImage(run.projectId, run.characterId, run.outfitId)
    try {
      return await collectActionFirstFrameCandidates(run.id, characterImageUrl)
    } catch (cause) {
      failActiveRun(store, run.id, errorMessage(cause, '动作首帧候选恢复失败'), now())
      throw asError(cause)
    }
  }

  async function loadCharacterImage(
    projectId: string,
    characterId: string,
    outfitId: string,
  ): Promise<string> {
    const character = await characterApis.get(characterId)
    if (character.projectId !== projectId) throw new Error('动作角色不属于当前项目')
    const outfit = character.outfits.find((item) => item.id === outfitId)
    if (!outfit || outfit.characterId !== characterId) throw new Error('动作所属角色造型不存在')
    if (!outfit.characterTemplateUrl) throw new Error('正式角色造型没有可用的角色图')
    return outfit.characterTemplateUrl
  }

  async function collectActionFirstFrameCandidates(
    runId: string,
    characterImageUrl: string,
  ): Promise<ActionFirstFrameCandidateBatch> {
    let run = requireRun(store, runId)
    if (run.purpose !== 'add_action') throw new Error('该 WorkflowRun 不是动作任务')
    let firstFrameStep = requireStep(run, 'first-frame')

    if (firstFrameStep.status === 'active') {
      while (firstFrameStep.candidateTaskIds.length < ACTION_FIRST_FRAME_CANDIDATE_COUNT) {
        if (run.purpose !== 'add_action') {
          throw new Error('动作首帧生成过程中 WorkflowRun 目的发生了变化')
        }
        const task = await generationApis.create({
          type: 'first_frame',
          projectId: run.projectId,
          characterId: run.characterId,
          outfitId: run.outfitId,
          actionType: run.actionType,
          prompt: run.prompt,
          referenceMedia: [characterImageUrl as MediaReference],
        })
        run = appendCandidateTask(run, 'first-frame', task.id, now())
        store.save(run)
        firstFrameStep = requireStep(run, 'first-frame')
      }
    } else if (
      firstFrameStep.status !== 'passed' ||
      requireStep(run, 'first-frame-candidate').status !== 'active'
    ) {
      throw new Error('当前 WorkflowRun 不在动作首帧选择阶段')
    }

    const taskIds = requireStep(run, 'first-frame').candidateTaskIds
    const terminals = await Promise.all(
      taskIds.map(async (taskId) =>
        waitForTerminal(generationApis, await generationApis.get(run.projectId, taskId)),
      ),
    )
    const candidates = terminals.map(requireFirstFrame)
    if (firstFrameStep.status === 'active') {
      run = completeGenerationStep(run, 'first-frame', 'first-frame-candidate', now())
      store.save(run)
    }
    return { run, candidateTaskIds: taskIds, candidates }
  }

  async function confirmActionFirstFrame(
    input: ConfirmActionFirstFrameInput,
  ): Promise<WorkflowRun> {
    const batch = await resumeActionFirstFrameCandidates(input.runId)
    if (!batch.candidates.includes(input.selectedImageUrl)) {
      throw new Error('选中图片不属于当前动作首帧任务')
    }
    const run = batch.run
    if (run.purpose !== 'add_action') throw new Error('该 WorkflowRun 不是动作任务')

    try {
      const animationTask = await generationApis.create({
        type: 'complete_animation',
        projectId: run.projectId,
        characterId: run.characterId,
        outfitId: run.outfitId,
        actionType: run.actionType,
        firstFrameUrl: input.selectedImageUrl,
        prompt: run.prompt,
        referenceMedia: [],
      })
      const generating = startAnimationFromCandidate(run, animationTask.id, now())
      store.save(generating)
      const terminal = await waitForTerminal(generationApis, animationTask)
      requireAnimation(terminal)
      const completed = completeGenerationStep(
        requireRun(store, run.id),
        'complete-animation',
        'review',
        now(),
      )
      store.save(completed)
      return completed
    } catch (cause) {
      failActiveRun(store, run.id, errorMessage(cause, '完整动画生成失败'), now())
      throw asError(cause)
    }
  }

  async function resumeAction(runId: string): Promise<WorkflowRun> {
    let run = requireRun(store, runId)
    if (run.purpose !== 'add_action') throw new Error('该 WorkflowRun 不是动作任务')
    if (run.status !== 'active' || requireStep(run, 'review').status === 'active') return run
    const animationStep = requireStep(run, 'complete-animation')
    if (animationStep.status !== 'active') return run
    if (!animationStep.taskId) throw new Error('完整动画任务 ID 不存在，无法恢复')

    try {
      const terminal = await waitForTerminal(
        generationApis,
        await generationApis.get(run.projectId, animationStep.taskId),
      )
      requireAnimation(terminal)
      run = completeGenerationStep(run, 'complete-animation', 'review', now())
      store.save(run)
      return run
    } catch (cause) {
      failActiveRun(store, run.id, errorMessage(cause, '完整动画恢复失败'), now())
      throw asError(cause)
    }
  }

  async function getActionReview(runId: string): Promise<ActionReviewResult> {
    const run = requireRun(store, runId)
    if (run.purpose !== 'add_action') throw new Error('该 WorkflowRun 不是动作任务')
    if (run.status !== 'active' || requireStep(run, 'review').status !== 'active') {
      throw new Error('动作尚未进入可审核状态')
    }
    const animationStep = requireStep(run, 'complete-animation')
    if (!animationStep.taskId) throw new Error('完整动画任务 ID 不存在')
    const animation = requireAnimation(
      await generationApis.get(run.projectId, animationStep.taskId),
    )

    return {
      run,
      generationId: animationStep.taskId,
      frames: animation.frames.map((frame) => ({ imageUrl: frame.url })),
    }
  }

  async function approveAction(runId: string): Promise<PublishActionResult> {
    // 审核页展示和最终写入角色必须读取同一份、经过同一套校验的动画结果。
    // 这样可以避免页面看见一组帧，点击通过后却导入另一组帧。
    const review = await getActionReview(runId)
    const run = review.run

    const character = await characterApis.get(run.characterId)
    const outfit = character.outfits.find((item) => item.id === run.outfitId)
    if (!outfit) throw new Error('动作所属造型不存在')
    const action: Action = {
      id: run.actionId,
      outfitId: outfit.id,
      name: run.actionName,
      kind: 'custom',
      type: run.actionType,
      fps: run.fps,
      keyFrameIndex: null,
      frames: review.frames.map<Frame>((frame) => ({
        imageUrl: frame.imageUrl,
        durationMs: null,
        rootMotion: null,
      })),
    }
    const saved = await characterApis.update({
      ...character,
      outfits: character.outfits.map((item) =>
        item.id === outfit.id
          ? {
              ...item,
              actions: [...item.actions.filter((existing) => existing.id !== run.actionId), action],
            }
          : item,
      ),
    })

    const completedAt = now()
    const completed = editCurrentRevision(run, completedAt, (revision) => {
      requireRevisionStep(revision, 'review').status = 'passed'
      requireRevisionStep(revision, 'export').status = 'passed'
      revision.status = 'completed'
      revision.exportStatus = 'exported'
    }) as WorkflowRun
    const result: WorkflowRun = {
      ...completed,
      status: 'completed',
      updatedAt: completedAt,
    }
    store.save(result)
    return {
      run: result,
      character: saved,
      characterId: run.characterId,
      outfitId: run.outfitId,
      actionId: run.actionId,
    }
  }

  return {
    interruptRun,
    continueRun,
    startCharacter,
    resumeCharacterCandidates,
    confirmCharacter,
    startAction,
    resumeActionFirstFrameCandidates,
    confirmActionFirstFrame,
    resumeAction,
    getActionReview,
    approveAction,
  }
}

function requireRun(store: WorkflowRunStore, runId: string): WorkflowRun {
  const run = store.get(runId)
  if (!run) throw new Error(`WorkflowRun 不存在：${runId}`)
  return run
}

function currentRevision(run: WorkflowRun): WorkflowRevision {
  const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
  if (!revision) throw new Error('WorkflowRun 的当前 Revision 不存在')
  return revision
}

function requireRevisionStep(revision: WorkflowRevision, type: WorkflowStepType): WorkflowStep {
  const step = revision.steps.find((item) => item.type === type)
  if (!step) throw new Error(`WorkflowRun 缺少 ${type} 步骤`)
  return step
}

function requireStep(run: WorkflowRun, type: WorkflowStepType): WorkflowStep {
  return requireRevisionStep(currentRevision(run), type)
}

function editCurrentRevision(
  run: WorkflowRun,
  updatedAt: string,
  edit: (revision: WorkflowRevision) => void,
): WorkflowRun {
  const next = structuredClone(run)
  edit(currentRevision(next))
  next.updatedAt = updatedAt
  return next
}

function advanceStep(
  run: WorkflowRun,
  currentType: WorkflowStepType,
  nextType: WorkflowStepType,
  updatedAt: string,
): WorkflowRun {
  return editCurrentRevision(run, updatedAt, (revision) => {
    const current = requireRevisionStep(revision, currentType)
    const next = requireRevisionStep(revision, nextType)
    if (current.status !== 'active' || next.status !== 'locked') {
      throw new Error(`不能从 ${currentType} 推进到 ${nextType}`)
    }
    current.status = 'passed'
    next.status = 'active'
  })
}

function recordTask(
  run: WorkflowRun,
  type: WorkflowStepType,
  taskId: string,
  updatedAt: string,
): WorkflowRun {
  return editCurrentRevision(run, updatedAt, (revision) => {
    const step = requireRevisionStep(revision, type)
    if (step.status !== 'active') throw new Error(`${type} 步骤未激活`)
    step.taskId = taskId
    step.submissionId = null
    revision.generationStatus = 'in_progress'
  })
}

/**
 * 每次后端成功返回一个首帧任务 ID 就立即保存。
 * 如果第 3 个请求时页面刷新，恢复后只需补齐缺少的任务，
 * 不会重复提交前两个。
 */
function appendCandidateTask(
  run: WorkflowRun,
  type: WorkflowStepType,
  taskId: string,
  updatedAt: string,
): WorkflowRun {
  return editCurrentRevision(run, updatedAt, (revision) => {
    const step = requireRevisionStep(revision, type)
    if (step.status !== 'active') throw new Error(`${type} 步骤未激活`)
    if (step.candidateTaskIds.includes(taskId)) throw new Error('首帧候选任务 ID 重复')
    if (step.candidateTaskIds.length >= ACTION_FIRST_FRAME_CANDIDATE_COUNT) {
      throw new Error('首帧候选任务数量已达上限')
    }
    step.candidateTaskIds.push(taskId)
    step.submissionId = null
    revision.generationStatus = 'in_progress'
  })
}

/** 选中首帧后，把候选步骤和完整动画 taskId 一次写入同一份快照。 */
function startAnimationFromCandidate(
  run: WorkflowRun,
  taskId: string,
  updatedAt: string,
): WorkflowRun {
  return editCurrentRevision(run, updatedAt, (revision) => {
    const candidate = requireRevisionStep(revision, 'first-frame-candidate')
    const animation = requireRevisionStep(revision, 'complete-animation')
    if (candidate.status !== 'active' || animation.status !== 'locked') {
      throw new Error('当前 WorkflowRun 不能从首帧候选进入完整动画')
    }
    candidate.status = 'passed'
    animation.status = 'active'
    animation.taskId = taskId
    animation.submissionId = null
    revision.generationStatus = 'in_progress'
  })
}

function completeGenerationStep(
  run: WorkflowRun,
  currentType: WorkflowStepType,
  nextType: WorkflowStepType,
  updatedAt: string,
): WorkflowRun {
  return editCurrentRevision(run, updatedAt, (revision) => {
    const current = requireRevisionStep(revision, currentType)
    const next = requireRevisionStep(revision, nextType)
    const hasGenerationTasks =
      current.taskId !== null ||
      (current.type === 'first-frame' &&
        current.candidateTaskIds.length === ACTION_FIRST_FRAME_CANDIDATE_COUNT)
    if (current.status !== 'active' || !hasGenerationTasks || next.status !== 'locked') {
      throw new Error(`${currentType} 步骤没有可完成的生成任务`)
    }
    current.status = 'passed'
    next.status = 'active'
    revision.generationStatus = nextType === 'complete-animation' ? 'in_progress' : 'completed'
  })
}

function failActiveRun(
  store: WorkflowRunStore,
  runId: string,
  message: string,
  updatedAt: string,
): void {
  const existing = store.get(runId)
  if (!existing || existing.status !== 'active') return
  const failed = editCurrentRevision(existing, updatedAt, (revision) => {
    const active = revision.steps.find((step) => step.status === 'active')
    if (active) {
      active.status = 'failed'
      active.error = message
      active.submissionId = null
    }
    revision.status = 'failed'
    revision.generationStatus = 'failed'
  })
  failed.status = 'failed'
  store.save(failed)
}

function requireCharacterCandidates(generation: Generation): CharacterTemplateGenerationResult {
  if (generation.status === 'failed') throw new Error(generation.error || '角色候选生成失败')
  if (
    generation.type !== 'character_template' ||
    generation.status !== 'completed' ||
    generation.result?.type !== 'character_template' ||
    generation.result.images.length !== CHARACTER_CANDIDATE_COUNT ||
    generation.result.images.some((image) => !image.url)
  ) {
    throw new Error(`角色生成必须返回 ${CHARACTER_CANDIDATE_COUNT} 张有效候选图`)
  }
  return generation.result
}

function requireAnimation(generation: Generation): CompleteAnimationGenerationResult {
  if (generation.status === 'failed') throw new Error(generation.error || '完整动画生成失败')
  if (
    generation.type !== 'complete_animation' ||
    generation.status !== 'completed' ||
    generation.result?.type !== 'complete_animation' ||
    generation.result.frames.length === 0 ||
    generation.result.frames.some((frame) => !frame.url)
  ) {
    throw new Error('完整动画任务没有返回有效帧')
  }
  return generation.result
}

function requireFirstFrame(generation: Generation): string {
  if (generation.status === 'failed') throw new Error(generation.error || '首帧生成失败')
  if (
    generation.type !== 'first_frame' ||
    generation.status !== 'completed' ||
    generation.result?.type !== 'first_frame' ||
    !generation.result.image.url
  ) {
    throw new Error('首帧生成未返回有效图片')
  }
  return generation.result.image.url
}

function toCandidateBatch(
  run: WorkflowRun,
  generationId: string,
  result: CharacterTemplateGenerationResult,
): CharacterCandidateBatch {
  return { run, generationId, candidates: result.images.map((image) => image.url) }
}

function waitForTerminal(
  generationApis: GenerationApis,
  generation: Generation,
): Promise<Generation> {
  if (generation.status === 'completed' || generation.status === 'failed') {
    return Promise.resolve(generation)
  }
  return new Promise((resolve, reject) => {
    let stop: () => void = () => undefined
    let settledBeforeSubscription = false
    const settle = (event: GenerationEvent) => {
      if (event.status !== 'completed' && event.status !== 'failed') return
      settledBeforeSubscription = true
      stop()
      resolve({
        id: event.taskId,
        projectId: generation.projectId,
        type: event.type,
        status: event.status,
        result: event.result,
        error: event.error,
      })
    }
    try {
      stop = generationApis.subscribe(generation.projectId, generation.id, settle)
      if (settledBeforeSubscription) stop()
    } catch (cause) {
      reject(asError(cause))
    }
  })
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message.trim() : fallback
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}
