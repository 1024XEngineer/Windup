import type {
  CharacterSetupStepInput,
  CompleteAnimationGenerationInput,
  CompleteAnimationGenerationResult,
  GenerationApis,
  MediaReference,
  WorkflowRun,
  WorkflowRunStore,
} from '@/entities'
import { createActionGenerationTask } from './action-generation-task'
import { createCharacterTemplateTask } from './character-template-task'
import {
  advanceCharacterSetupState,
  acceptUploadedCharacterTemplateState,
  approveReviewState,
  completeActionGenerationState,
  confirmCandidateState,
  createWorkflowRunState,
  getActiveStep,
  getCurrentRevision,
  interruptWorkflowRunState,
  recordActionGenerationTaskState,
  restartWorkflowRunState,
  requireActiveWorkflow,
  updateCharacterSetupState,
  type CreateWorkflowRunStateInput,
} from './workflow-state'

/** 创建角色与给已有角色增加动作共用同一条运行状态机。 */
export type CreateWorkflowControllerInput = CreateWorkflowRunStateInput

export interface WorkflowController {
  /** 创建并保存一条纯前端运行记录。 */
  create(input: CreateWorkflowControllerInput): WorkflowRun

  /** 按路由中的 runId 读取快照；不存在时返回 null。 */
  getWorkflow(runId: WorkflowRun['id']): WorkflowRun | null

  /** 订阅指定运行记录的本地变化。 */
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void

  /** 修改当前角色资料步骤，页面无需知道步骤内部 ID。 */
  updateCharacterSetup(runId: WorkflowRun['id'], input: CharacterSetupStepInput): WorkflowRun

  /** 采用已上传的角色母版，跳过图片生成与候选选择并激活动作生成。 */
  acceptUploadedCharacterTemplate(
    runId: WorkflowRun['id'],
    templateUrl: MediaReference,
  ): WorkflowRun

  /**
   * 推进一个步骤。当前纵切只实现角色资料到角色图生成；
   * 后续步骤进入各自实现 PR 后再扩展，不在这里伪造完成。
   * spriteSize 为项目精灵图尺寸，角色图生成步骤需要传给后端做尺寸校验。
   */
  nextStep(
    runId: WorkflowRun['id'],
    spriteSize?: { width: number; height: number },
  ): Promise<WorkflowRun>

  /** 页面恢复时先读取任务终态；仍在运行时再恢复订阅。 */
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>

  /** 只停止前端自动推进和任务订阅；后端当前没有取消任务能力。 */
  interrupt(runId: WorkflowRun['id']): WorkflowRun

  /** 确认候选选择，推进到下一个步骤。 */
  confirmCandidate(runId: WorkflowRun['id'], selectedImageUrl: string): WorkflowRun

  /** 动作生成完成后写回结果，标记 action-generation 为 passed。 */
  completeActionGeneration(
    runId: WorkflowRun['id'],
    result: CompleteAnimationGenerationResult | { error: string },
  ): WorkflowRun

  /** 提交完整动作生成，并由 Controller 统一处理订阅和刷新恢复。 */
  startActionGeneration(
    runId: WorkflowRun['id'],
    input: CompleteAnimationGenerationInput,
  ): Promise<WorkflowRun>

  /** 审核通过后完成当前版本和整条运行；不在这里执行发布或下载。 */
  approveReview(runId: WorkflowRun['id']): WorkflowRun

  /** 动作生成任务提交后把任务 ID 落盘，供页面刷新后 resume 恢复轮询。 */
  recordActionGenerationTask(runId: WorkflowRun['id'], taskId: string): WorkflowRun

  /** 记录动作生成关联的角色与造型 ID，供导出到 Playtest 使用（刷新后可恢复）。 */
  recordCharacterRefs(
    runId: WorkflowRun['id'],
    refs: { characterId: string; outfitId: string },
  ): WorkflowRun

  /** 从当前执行线中一个已通过的节点创建新的本地 Revision。 */
  restart(runId: WorkflowRun['id'], stepId: string): WorkflowRun
}

export interface CreateWorkflowControllerOptions {
  store: WorkflowRunStore
  generationApis: GenerationApis
  /** 测试可注入确定性 ID；生产默认使用浏览器随机 UUID。 */
  createId?: (scope: 'run' | 'revision' | 'submission') => string
  /** 测试可注入确定性时间。 */
  now?: () => string
}

/**
 * Quick Start 与手动工作流共用的流程协调器。
 *
 * Controller 只负责读取当前步骤、保存状态并委派角色图任务；纯状态转换和异步任务
 * 生命周期分别留在本 Feature 的内部模块。生产接入必须复用同一个 Controller 实例，
 * 不能在组件渲染期间重复创建。
 */
export function createWorkflowController({
  store,
  generationApis,
  createId = createRuntimeId,
  now = () => new Date().toISOString(),
}: CreateWorkflowControllerOptions): WorkflowController {
  const characterTemplateTask = createCharacterTemplateTask({
    store,
    generationApis,
    createSubmissionId: () => createId('submission'),
  })
  const actionGenerationTask = createActionGenerationTask({
    store,
    generationApis,
    createSubmissionId: () => createId('submission'),
  })

  function getWorkflow(runId: WorkflowRun['id']) {
    return store.get(runId)
  }

  function requireWorkflow(runId: WorkflowRun['id']) {
    const run = getWorkflow(runId)
    if (!run) throw new Error(`WorkflowRun 不存在：${runId}`)
    return run
  }

  function save(run: WorkflowRun) {
    store.save(run)
    return run
  }

  function create(input: CreateWorkflowControllerInput): WorkflowRun {
    return save(
      createWorkflowRunState(input, {
        runId: createId('run'),
        revisionId: createId('revision'),
        createdAt: now(),
      }),
    )
  }

  function subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void) {
    return store.subscribe(runId, listener)
  }

  function updateCharacterSetup(
    runId: WorkflowRun['id'],
    input: CharacterSetupStepInput,
  ): WorkflowRun {
    return save(updateCharacterSetupState(requireWorkflow(runId), input))
  }

  function acceptUploadedCharacterTemplate(
    runId: WorkflowRun['id'],
    templateUrl: MediaReference,
  ): WorkflowRun {
    return save(acceptUploadedCharacterTemplateState(requireWorkflow(runId), templateUrl))
  }

  async function nextStep(
    runId: WorkflowRun['id'],
    spriteSize?: { width: number; height: number },
  ): Promise<WorkflowRun> {
    const run = requireActiveWorkflow(requireWorkflow(runId))
    const revision = getCurrentRevision(run)
    const activeStep = getActiveStep(revision)
    if (!activeStep) throw new Error('当前 WorkflowRun 没有 active 步骤')

    if (activeStep.type === 'character-template') {
      return characterTemplateTask.start(runId, {
        revisionId: revision.id,
        stepId: activeStep.id,
      })
    }
    if (activeStep.type !== 'character-setup') {
      throw new Error(`步骤 ${activeStep.type} 尚未进入本轮实现`)
    }

    if (!spriteSize) throw new Error('推进角色资料步骤需要项目精灵图尺寸')

    const transitioned = advanceCharacterSetupState(run, spriteSize)
    save(transitioned.run)
    return characterTemplateTask.start(runId, transitioned.target)
  }

  function resume(runId: WorkflowRun['id']) {
    const run = store.get(runId)
    if (!run || run.status !== 'active') return Promise.resolve(run)
    const step = getActiveStep(getCurrentRevision(run))
    return step?.type === 'action-generation'
      ? actionGenerationTask.resume(runId)
      : characterTemplateTask.resume(runId)
  }

  function interrupt(runId: WorkflowRun['id']): WorkflowRun {
    const run = requireWorkflow(runId)
    if (run.status !== 'active') return run

    characterTemplateTask.stop(runId)
    actionGenerationTask.stop(runId)
    const latest = requireWorkflow(runId)
    if (latest.status !== 'active') return latest
    return save(interruptWorkflowRunState(latest))
  }

  function confirmCandidate(runId: WorkflowRun['id'], selectedImageUrl: string): WorkflowRun {
    return save(confirmCandidateState(requireWorkflow(runId), selectedImageUrl))
  }

  function completeActionGeneration(
    runId: WorkflowRun['id'],
    result: CompleteAnimationGenerationResult | { error: string },
  ): WorkflowRun {
    const run = requireWorkflow(runId)
    if (run.status !== 'active') {
      console.warn('[completeActionGen] run not active:', run.status)
      return run
    }
    const revision = getCurrentRevision(run)
    const step = revision.steps.find((s) => s.type === 'action-generation')
    if (!step || step.status !== 'active') {
      console.warn('[completeActionGen] step not active:', step?.type, step?.status)
      return run
    }
    return save(completeActionGenerationState(run, result))
  }

  function startActionGeneration(
    runId: WorkflowRun['id'],
    input: CompleteAnimationGenerationInput,
  ) {
    return actionGenerationTask.start(runId, input)
  }

  function approveReview(runId: WorkflowRun['id']): WorkflowRun {
    return save(approveReviewState(requireWorkflow(runId)))
  }

  function recordActionGenerationTask(runId: WorkflowRun['id'], taskId: string): WorkflowRun {
    const run = requireWorkflow(runId)
    if (run.status !== 'active') {
      console.warn('[recordActionTask] run not active:', run.status)
      return run
    }
    return save(recordActionGenerationTaskState(run, taskId))
  }

  function recordCharacterRefs(
    runId: WorkflowRun['id'],
    refs: { characterId: string; outfitId: string },
  ): WorkflowRun {
    const run = requireWorkflow(runId)
    if (run.status !== 'active') {
      console.warn('[recordCharacterRefs] run not active:', run.status)
      return run
    }
    return save({ ...run, characterId: refs.characterId, outfitId: refs.outfitId })
  }

  function restart(runId: WorkflowRun['id'], stepId: string): WorkflowRun {
    characterTemplateTask.stop(runId)
    actionGenerationTask.stop(runId)
    return save(
      restartWorkflowRunState(requireWorkflow(runId), stepId, {
        revisionId: createId('revision'),
        createdAt: now(),
      }),
    )
  }

  return {
    create,
    getWorkflow,
    subscribe,
    updateCharacterSetup,
    acceptUploadedCharacterTemplate,
    nextStep,
    confirmCandidate,
    completeActionGeneration,
    startActionGeneration,
    approveReview,
    recordActionGenerationTask,
    recordCharacterRefs,
    restart,
    resume,
    interrupt,
  }
}

function createRuntimeId(scope: 'run' | 'revision' | 'submission') {
  const suffix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${scope}-${suffix}`
}
