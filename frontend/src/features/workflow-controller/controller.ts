import {
  parseCharacterTemplateGenerationResult,
  WORKFLOW_STEP_ORDER,
  type CharacterSetupStepInput,
  type CharacterTemplateGenerationInput,
  type CreateWorkflowRunInput,
  type GenerationApis,
  type Task,
  type TaskApis,
  type TaskEvent,
  type WorkflowRevision,
  type WorkflowRun,
  type WorkflowRunStore,
  type WorkflowStep,
  type WorkflowStepStatus,
  type WorkflowStepType,
} from '@/entities'

interface ApplyServerResultInput {
  revisionId: WorkflowRevision['id']
  stepId: WorkflowStep['id']
  /** 结果必须仍属于步骤当前记录的任务；重试前的旧结果会被忽略。 */
  taskId: string
  result: unknown
}

/** 首个纵切只开放创建角色；增加动作进入对应步骤实现时再加入 Controller。 */
export type CreateWorkflowControllerInput = Extract<
  CreateWorkflowRunInput,
  { purpose: 'create_character' }
>

export interface WorkflowController {
  /** 创建并保存一条纯前端运行记录。 */
  create(input: CreateWorkflowControllerInput): WorkflowRun

  /** 按路由中的 runId 读取快照；不存在时返回 null。 */
  getWorkflow(runId: WorkflowRun['id']): WorkflowRun | null

  /** 订阅指定运行记录的本地变化。 */
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void

  /** 修改当前角色资料步骤，页面无需知道步骤内部 ID。 */
  updateCharacterSetup(runId: WorkflowRun['id'], input: CharacterSetupStepInput): WorkflowRun

  /**
   * 推进一个步骤。当前纵切只实现角色资料到角色图生成；
   * 后续步骤进入各自实现 PR 后再扩展，不在这里伪造完成。
   */
  nextStep(runId: WorkflowRun['id']): Promise<WorkflowRun>

  /** 页面恢复时先读取任务终态；仍在运行时再恢复订阅。 */
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>

  /** 只停止前端自动推进和任务订阅；后端当前没有取消任务能力。 */
  interrupt(runId: WorkflowRun['id']): WorkflowRun
}

export interface CreateWorkflowControllerOptions {
  store: WorkflowRunStore
  generationApis: Pick<GenerationApis, 'create'>
  taskApis: TaskApis
  /** 测试可注入确定性 ID；生产默认使用浏览器随机 UUID。 */
  createId?: (scope: 'run' | 'revision' | 'submission') => string
  /** 测试可注入确定性时间。 */
  now?: () => string
}

interface ActiveSubscription {
  runId: WorkflowRun['id']
  stop: () => void
}

/**
 * WorkflowRun 的唯一推进实现。
 *
 * Controller 管前端状态和后端任务的关联；Generation 与 Task 只认识自己的 ID，
 * 不读取 WorkflowRun、Revision 或 Step。
 * submissions 与 subscriptions 是实例内锁；生产接入必须复用同一个实例，
 * 不能在组件渲染期间重复创建。
 */
export function createWorkflowController({
  store,
  generationApis,
  taskApis,
  createId = createRuntimeId,
  now = () => new Date().toISOString(),
}: CreateWorkflowControllerOptions): WorkflowController {
  const submissions = new Map<string, Promise<WorkflowRun>>()
  const subscriptions = new Map<string, ActiveSubscription>()

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

  function getCurrentRevision(run: WorkflowRun) {
    const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
    if (!revision) throw new Error(`WorkflowRun ${run.id} 的 currentRevisionId 无效`)
    return revision
  }

  function getActiveStep(revision: WorkflowRevision) {
    return revision.steps.find((step) => step.status === 'active') ?? null
  }

  function replaceStep(
    run: WorkflowRun,
    revisionId: WorkflowRevision['id'],
    stepId: WorkflowStep['id'],
    update: (step: WorkflowStep) => WorkflowStep,
    revisionUpdate?: (revision: WorkflowRevision) => WorkflowRevision,
  ) {
    return {
      ...run,
      revisions: run.revisions.map((revision) => {
        if (revision.id !== revisionId) return revision
        const nextRevision = {
          ...revision,
          steps: revision.steps.map((step) => (step.id === stepId ? update(step) : step)),
        }
        return revisionUpdate ? revisionUpdate(nextRevision) : nextRevision
      }),
    }
  }

  function create(input: CreateWorkflowControllerInput): WorkflowRun {
    const prompt = input.prompt?.trim() || null
    const runId = createId('run')
    const revisionId = createId('revision')
    const steps = WORKFLOW_STEP_ORDER.map((type, index) =>
      createInitialStep(type, revisionId, index, prompt),
    )
    const run: WorkflowRun = {
      id: runId,
      projectId: input.projectId,
      characterId: null,
      outfitId: null,
      purpose: input.purpose,
      driver: input.driver,
      status: 'active',
      currentRevisionId: revisionId,
      revisions: [
        {
          id: revisionId,
          basedOnRevisionId: null,
          restartStepId: null,
          status: 'active',
          steps,
          generationStatus: 'not_started',
          exportStatus: 'not_exported',
          createdAt: now(),
        },
      ],
      prompt,
    }
    save(run)
    return run
  }

  function subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void) {
    return store.subscribe(runId, listener)
  }

  function updateCharacterSetup(
    runId: WorkflowRun['id'],
    input: CharacterSetupStepInput,
  ): WorkflowRun {
    const run = requireActiveWorkflow(runId, requireWorkflow)
    const revision = getCurrentRevision(run)
    const step = revision.steps.find((item) => item.type === 'character-setup')
    if (!step || step.type !== 'character-setup' || step.status !== 'active') {
      throw new Error('当前只能更新处于 active 状态的角色资料步骤')
    }

    const description = input.description.trim()
    if (!description) throw new Error('角色描述不能为空')

    const updated = replaceStep(run, revision.id, step.id, (current) => {
      if (current.type !== 'character-setup') return current
      return {
        ...current,
        input: {
          description,
          referenceMedia: [...input.referenceMedia],
        },
      }
    })
    return save(updated)
  }

  async function nextStep(runId: WorkflowRun['id']): Promise<WorkflowRun> {
    const run = requireActiveWorkflow(runId, requireWorkflow)
    const revision = getCurrentRevision(run)
    const activeStep = getActiveStep(revision)
    if (!activeStep) throw new Error('当前 WorkflowRun 没有 active 步骤')

    if (activeStep.type === 'character-template') {
      if (activeStep.taskId) {
        ensureTaskSubscription(run, revision.id, activeStep.id, activeStep.taskId)
        return requireWorkflow(runId)
      }
      if (!activeStep.input) throw new Error('角色图生成步骤缺少输入快照')
      return submitCharacterTemplate(runId, revision.id, activeStep.id)
    }

    if (activeStep.type !== 'character-setup') {
      throw new Error(`步骤 ${activeStep.type} 尚未进入本轮实现`)
    }
    if (!activeStep.input) throw new Error('请先填写角色资料')

    const templateStep = revision.steps.find((step) => step.type === 'character-template')
    if (!templateStep) throw new Error('WorkflowRun 缺少 character-template 步骤')

    const generationInput: CharacterTemplateGenerationInput = {
      type: 'character_template',
      projectId: run.projectId,
      prompt: activeStep.input.description,
      referenceMedia: activeStep.input.referenceMedia,
    }

    const transitioned: WorkflowRun = {
      ...run,
      revisions: run.revisions.map((item) => {
        if (item.id !== revision.id) return item
        return {
          ...item,
          generationStatus: 'in_progress' as const,
          steps: item.steps.map((step) => {
            if (step.id === activeStep.id) return { ...step, status: 'passed' as const }
            if (step.id !== templateStep.id || step.type !== 'character-template') return step
            return {
              ...step,
              status: 'active' as const,
              input: generationInput,
            }
          }),
        }
      }),
    }
    save(transitioned)
    return submitCharacterTemplate(runId, revision.id, templateStep.id)
  }

  function submitCharacterTemplate(
    runId: WorkflowRun['id'],
    revisionId: WorkflowRevision['id'],
    stepId: WorkflowStep['id'],
  ) {
    const key = submissionKey(runId, revisionId, stepId)
    const pending = submissions.get(key)
    if (pending) return pending

    const submission = performCharacterTemplateSubmission(runId, revisionId, stepId).finally(() => {
      submissions.delete(key)
    })
    submissions.set(key, submission)
    return submission
  }

  async function performCharacterTemplateSubmission(
    runId: WorkflowRun['id'],
    revisionId: WorkflowRevision['id'],
    stepId: WorkflowStep['id'],
  ): Promise<WorkflowRun> {
    const before = requireWorkflow(runId)
    const beforeRevision = getCurrentRevision(before)
    const beforeStep = beforeRevision.steps.find((step) => step.id === stepId)
    if (
      before.status !== 'active' ||
      beforeRevision.id !== revisionId ||
      !beforeStep ||
      beforeStep.type !== 'character-template' ||
      beforeStep.status !== 'active' ||
      !beforeStep.input
    ) {
      return before
    }
    if (beforeStep.taskId) {
      ensureTaskSubscription(before, revisionId, stepId, beforeStep.taskId)
      return before
    }
    if (beforeStep.submissionId) {
      throw new Error('角色图生成请求仍在等待后端确认，不能重复提交')
    }

    const submissionId = createId('submission')
    const submitting = replaceStep(before, revisionId, stepId, (current) => {
      if (current.type !== 'character-template') return current
      return { ...current, submissionId }
    })
    save(submitting)
    try {
      const generation = await generationApis.create(beforeStep.input)
      const latest = requireWorkflow(runId)
      const latestRevision = getCurrentRevision(latest)
      const latestStep = latestRevision.steps.find((step) => step.id === stepId)
      if (
        (latest.status !== 'active' && latest.status !== 'interrupted') ||
        latestRevision.id !== revisionId ||
        !latestStep ||
        latestStep.type !== 'character-template' ||
        latestStep.status !== 'active' ||
        latestStep.taskId ||
        latestStep.submissionId !== submissionId
      ) {
        return latest
      }
      if (generation.type !== 'character_template' || generation.projectId !== latest.projectId) {
        throw new Error('生成任务返回的类型或项目与当前 WorkflowRun 不匹配')
      }

      const withTask = replaceStep(latest, revisionId, stepId, (current) => {
        if (current.type !== 'character-template') return current
        return { ...current, taskId: generation.id, submissionId: null }
      })
      save(withTask)

      if (latest.status === 'interrupted') return withTask
      if (generation.status === 'failed') {
        return markGenerationFailed(
          runId,
          revisionId,
          stepId,
          generation.id,
          null,
          generation.error?.trim() || '角色图生成任务失败',
        )
      }
      if (generation.status === 'completed') {
        return applyServerResult(runId, {
          revisionId,
          stepId,
          taskId: generation.id,
          result: generation.result,
        })
      }

      ensureTaskSubscription(withTask, revisionId, stepId, generation.id)
      return requireWorkflow(runId)
    } catch (cause) {
      markGenerationFailed(
        runId,
        revisionId,
        stepId,
        null,
        submissionId,
        errorMessage(cause, '角色图生成请求失败'),
      )
      throw cause instanceof Error ? cause : new Error(String(cause))
    }
  }

  function ensureTaskSubscription(
    run: WorkflowRun,
    revisionId: WorkflowRevision['id'],
    stepId: WorkflowStep['id'],
    taskId: string,
  ) {
    const key = subscriptionKey(run.id, revisionId, stepId, taskId)
    if (subscriptions.has(key)) return

    subscriptions.set(key, { runId: run.id, stop: () => undefined })
    try {
      const stop = taskApis.subscribe(run.projectId, taskId, (event) => {
        handleTaskEvent(run.id, revisionId, stepId, taskId, event)
      })
      const active = subscriptions.get(key)
      if (active) subscriptions.set(key, { ...active, stop })
      else stop()
    } catch (cause) {
      subscriptions.delete(key)
      throw cause
    }
  }

  function handleTaskEvent(
    runId: WorkflowRun['id'],
    revisionId: WorkflowRevision['id'],
    stepId: WorkflowStep['id'],
    taskId: string,
    event: TaskEvent,
  ) {
    if (event.taskId !== taskId) return
    if (event.status === 'pending' || event.status === 'running') return
    if (event.status === 'failed') {
      markGenerationFailed(
        runId,
        revisionId,
        stepId,
        taskId,
        null,
        event.error?.trim() || '角色图生成任务失败',
      )
      return
    }
    if (event.type !== 'character_template') {
      markGenerationFailed(
        runId,
        revisionId,
        stepId,
        taskId,
        null,
        '任务结果类型与角色图生成步骤不匹配',
      )
      return
    }
    applyServerResult(runId, {
      revisionId,
      stepId,
      taskId,
      result: event.result,
    })
  }

  async function resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null> {
    const run = getWorkflow(runId)
    if (!run || run.status !== 'active') return run
    const revision = getCurrentRevision(run)
    const activeStep = getActiveStep(revision)
    if (activeStep?.type !== 'character-template' || activeStep.status !== 'active') {
      return run
    }
    if (activeStep.submissionId && !activeStep.taskId) {
      if (submissions.has(submissionKey(run.id, revision.id, activeStep.id))) {
        return run
      }
      return markGenerationFailed(
        run.id,
        revision.id,
        activeStep.id,
        null,
        activeStep.submissionId,
        '页面刷新时生成请求尚未返回任务 ID，已停止恢复以避免重复提交',
      )
    }
    if (activeStep.taskId) {
      const task = await taskApis.get(run.projectId, activeStep.taskId)
      const latest = getWorkflow(run.id)
      if (!latest || latest.status !== 'active' || latest.currentRevisionId !== revision.id) {
        return latest
      }
      const latestRevision = getCurrentRevision(latest)
      const latestStep = latestRevision.steps.find((step) => step.id === activeStep.id)
      if (
        latestStep?.type !== 'character-template' ||
        latestStep.status !== 'active' ||
        latestStep.taskId !== activeStep.taskId
      ) {
        return latest
      }
      if (task.id !== latestStep.taskId) {
        throw new Error('任务查询结果与 WorkflowRun 记录的 taskId 不匹配')
      }
      if (task.type !== 'character_template') {
        return markGenerationFailed(
          latest.id,
          latestRevision.id,
          latestStep.id,
          latestStep.taskId,
          null,
          '任务查询结果类型与角色图生成步骤不匹配',
        )
      }
      if (task.status === 'pending' || task.status === 'running') {
        ensureTaskSubscription(latest, latestRevision.id, latestStep.id, latestStep.taskId)
      } else {
        handleTaskEvent(
          latest.id,
          latestRevision.id,
          latestStep.id,
          latestStep.taskId,
          taskEvent(task),
        )
      }
    }
    return getWorkflow(runId)
  }

  function applyServerResult(runId: WorkflowRun['id'], input: ApplyServerResultInput): WorkflowRun {
    const run = requireWorkflow(runId)
    if (run.status !== 'active' || run.currentRevisionId !== input.revisionId) {
      return run
    }

    const revision = getCurrentRevision(run)
    const step = revision.steps.find((item) => item.id === input.stepId)
    if (
      !step ||
      step.type !== 'character-template' ||
      step.status !== 'active' ||
      step.taskId !== input.taskId
    ) {
      return run
    }

    const result = parseCharacterTemplateGenerationResult(input.result)
    if (!result) {
      return markGenerationFailed(
        runId,
        revision.id,
        step.id,
        input.taskId,
        null,
        '角色图生成任务返回了无法识别的结果',
      )
    }
    const candidateStep = revision.steps.find((item) => item.type === 'template-candidate')
    if (!candidateStep) throw new Error('WorkflowRun 缺少 template-candidate 步骤')

    const updated: WorkflowRun = {
      ...run,
      revisions: run.revisions.map((item) => {
        if (item.id !== revision.id) return item
        return {
          ...item,
          steps: item.steps.map((current) => {
            if (current.id === step.id && current.type === 'character-template') {
              return {
                ...current,
                status: 'passed' as const,
                output: result,
                taskId: null,
                submissionId: null,
              }
            }
            if (current.id === candidateStep.id && current.type === 'template-candidate') {
              return { ...current, status: 'active' as const }
            }
            return current
          }),
        }
      }),
    }
    stopSubscription(subscriptionKey(run.id, revision.id, step.id, input.taskId))
    return save(updated)
  }

  function markGenerationFailed(
    runId: WorkflowRun['id'],
    revisionId: WorkflowRevision['id'],
    stepId: WorkflowStep['id'],
    expectedTaskId: string | null,
    expectedSubmissionId: string | null,
    error: string,
  ) {
    const run = requireWorkflow(runId)
    if (run.status !== 'active' || run.currentRevisionId !== revisionId) return run
    const revision = getCurrentRevision(run)
    const step = revision.steps.find((item) => item.id === stepId)
    if (
      !step ||
      step.type !== 'character-template' ||
      step.status !== 'active' ||
      (expectedTaskId !== null && step.taskId !== expectedTaskId) ||
      (expectedSubmissionId !== null && step.submissionId !== expectedSubmissionId)
    ) {
      return run
    }

    const failureMessage = error.trim() || '角色图生成失败'
    const failed: WorkflowRun = {
      ...replaceStep(
        run,
        revisionId,
        stepId,
        (current) => ({
          ...current,
          status: 'failed',
          taskId: null,
          submissionId: null,
          error: failureMessage,
        }),
        (current) => ({
          ...current,
          status: 'failed',
          generationStatus: 'failed',
        }),
      ),
      status: 'failed',
    }
    if (step.taskId) {
      stopSubscription(subscriptionKey(run.id, revisionId, stepId, step.taskId))
    }
    return save(failed)
  }

  function stopSubscription(key: string) {
    const subscription = subscriptions.get(key)
    subscriptions.delete(key)
    try {
      subscription?.stop()
    } catch {
      // 取消轮询失败不能反向破坏已经落盘的 WorkflowRun 状态。
    }
  }

  function interrupt(runId: WorkflowRun['id']): WorkflowRun {
    const run = requireWorkflow(runId)
    if (run.status !== 'active') return run
    for (const [key, subscription] of subscriptions) {
      if (subscription.runId === runId) stopSubscription(key)
    }
    const latest = requireWorkflow(runId)
    if (latest.status !== 'active') return latest
    return save({ ...latest, status: 'interrupted' })
  }

  return {
    create,
    getWorkflow,
    subscribe,
    updateCharacterSetup,
    nextStep,
    resume,
    interrupt,
  }
}

function createInitialStep(
  type: WorkflowStepType,
  revisionId: string,
  index: number,
  prompt: string | null,
): WorkflowStep {
  const status: WorkflowStepStatus = index === 0 ? 'active' : 'locked'
  const base: {
    id: string
    status: WorkflowStepStatus
    taskId: null
    submissionId: null
    error: null
    referenceStepIds: string[]
  } = {
    id: `${revisionId}:${type}`,
    status,
    taskId: null,
    submissionId: null,
    error: null,
    referenceStepIds: [],
  }

  if (type === 'character-setup') {
    return {
      ...base,
      type,
      input: prompt ? { description: prompt, referenceMedia: [] } : null,
      output: null,
    }
  }
  if (type === 'character-template') {
    return {
      ...base,
      type,
      input: null,
      output: null,
    }
  }
  return { ...base, type, input: null, output: null } as WorkflowStep
}

function requireActiveWorkflow(
  runId: WorkflowRun['id'],
  getWorkflow: (runId: WorkflowRun['id']) => WorkflowRun,
) {
  const run = getWorkflow(runId)
  if (run.status !== 'active') throw new Error(`WorkflowRun 当前不可推进：${run.status}`)
  return run
}

function taskEvent(task: Task): TaskEvent {
  return {
    taskId: task.id,
    type: task.type,
    status: task.status,
    error: task.error,
    result: task.result,
  }
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message.trim() : fallback
}

function subscriptionKey(
  runId: WorkflowRun['id'],
  revisionId: WorkflowRevision['id'],
  stepId: WorkflowStep['id'],
  taskId: string,
) {
  return `${runId}:${revisionId}:${stepId}:${taskId}`
}

function submissionKey(
  runId: WorkflowRun['id'],
  revisionId: WorkflowRevision['id'],
  stepId: WorkflowStep['id'],
) {
  return `${runId}:${revisionId}:${stepId}`
}

function createRuntimeId(scope: 'run' | 'revision' | 'submission') {
  const suffix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${scope}-${suffix}`
}
