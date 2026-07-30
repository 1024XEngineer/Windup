import {
  parseCharacterTemplateGenerationResult,
  type GenerationApis,
  type Task,
  type TaskApis,
  type TaskEvent,
  type WorkflowRevision,
  type WorkflowRun,
  type WorkflowRunStore,
  type WorkflowStep,
} from '@/entities'
import {
  getActiveStep,
  getCurrentRevision,
  replaceWorkflowStep,
  type WorkflowStepTarget,
} from './workflow-state'

interface ApplyServerResultInput extends WorkflowStepTarget {
  /** 结果必须仍属于步骤当前记录的任务；重试前的旧结果会被忽略。 */
  taskId: string
  result: unknown
}

interface ActiveSubscription {
  runId: WorkflowRun['id']
  stop: () => void
}

export interface CharacterTemplateTask {
  /** 启动或继续目标角色图步骤；同一实例内的重复调用共享一次提交。 */
  start(runId: WorkflowRun['id'], target: WorkflowStepTarget): Promise<WorkflowRun>

  /** 页面恢复时先读取任务终态；仍在运行时再恢复订阅。 */
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>

  /** 停止指定运行记录的前端任务订阅，不改变 WorkflowRun 状态。 */
  stop(runId: WorkflowRun['id']): void
}

interface CreateCharacterTemplateTaskOptions {
  store: WorkflowRunStore
  generationApis: Pick<GenerationApis, 'create'>
  taskApis: TaskApis
  createSubmissionId: () => string
}

/**
 * 角色图异步任务的生命周期。
 *
 * 它只处理当前角色图步骤与后端 Task 的关联，不决定整个工作流下一步走什么。
 * submissions 与 subscriptions 属于实例锁；生产环境必须复用同一个实例。
 */
export function createCharacterTemplateTask({
  store,
  generationApis,
  taskApis,
  createSubmissionId,
}: CreateCharacterTemplateTaskOptions): CharacterTemplateTask {
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

  function start(runId: WorkflowRun['id'], target: WorkflowStepTarget): Promise<WorkflowRun> {
    const run = requireWorkflow(runId)
    const revision = getCurrentRevision(run)
    const step = revision.steps.find((item) => item.id === target.stepId)
    if (
      revision.id !== target.revisionId ||
      !step ||
      step.type !== 'character-template' ||
      step.status !== 'active'
    ) {
      return Promise.resolve(run)
    }
    if (step.taskId) {
      ensureTaskSubscription(run, target.revisionId, target.stepId, step.taskId)
      return Promise.resolve(requireWorkflow(runId))
    }
    if (!step.input) throw new Error('角色图生成步骤缺少输入快照')
    return submit(runId, target)
  }

  function submit(runId: WorkflowRun['id'], target: WorkflowStepTarget) {
    const key = submissionKey(runId, target.revisionId, target.stepId)
    const pending = submissions.get(key)
    if (pending) return pending

    const submission = performSubmission(runId, target).finally(() => {
      submissions.delete(key)
    })
    submissions.set(key, submission)
    return submission
  }

  async function performSubmission(
    runId: WorkflowRun['id'],
    target: WorkflowStepTarget,
  ): Promise<WorkflowRun> {
    const before = requireWorkflow(runId)
    const beforeRevision = getCurrentRevision(before)
    const beforeStep = beforeRevision.steps.find((step) => step.id === target.stepId)
    if (
      before.status !== 'active' ||
      beforeRevision.id !== target.revisionId ||
      !beforeStep ||
      beforeStep.type !== 'character-template' ||
      beforeStep.status !== 'active' ||
      !beforeStep.input
    ) {
      return before
    }
    if (beforeStep.taskId) {
      ensureTaskSubscription(before, target.revisionId, target.stepId, beforeStep.taskId)
      return before
    }
    if (beforeStep.submissionId) {
      throw new Error('角色图生成请求仍在等待后端确认，不能重复提交')
    }

    const submissionId = createSubmissionId()
    const submitting = replaceWorkflowStep(before, target.revisionId, target.stepId, (current) => {
      if (current.type !== 'character-template') return current
      return { ...current, submissionId }
    })
    save(submitting)

    try {
      const generation = await generationApis.create(beforeStep.input)
      const latest = requireWorkflow(runId)
      const latestRevision = getCurrentRevision(latest)
      const latestStep = latestRevision.steps.find((step) => step.id === target.stepId)
      if (
        (latest.status !== 'active' && latest.status !== 'interrupted') ||
        latestRevision.id !== target.revisionId ||
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

      const withTask = replaceWorkflowStep(latest, target.revisionId, target.stepId, (current) => {
        if (current.type !== 'character-template') return current
        return { ...current, taskId: generation.id, submissionId: null }
      })
      save(withTask)

      if (latest.status === 'interrupted') return withTask
      if (generation.status === 'failed') {
        return markFailed(
          runId,
          target,
          generation.id,
          null,
          generation.error?.trim() || '角色图生成任务失败',
        )
      }
      if (generation.status === 'completed') {
        return applyServerResult(runId, {
          ...target,
          taskId: generation.id,
          result: generation.result,
        })
      }

      ensureTaskSubscription(withTask, target.revisionId, target.stepId, generation.id)
      return requireWorkflow(runId)
    } catch (cause) {
      markFailed(runId, target, null, submissionId, errorMessage(cause, '角色图生成请求失败'))
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
        handleTaskEvent(run.id, { revisionId, stepId }, taskId, event)
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
    target: WorkflowStepTarget,
    taskId: string,
    event: TaskEvent,
  ) {
    if (event.taskId !== taskId) return
    if (event.status === 'pending' || event.status === 'running') return
    if (event.status === 'failed') {
      markFailed(runId, target, taskId, null, event.error?.trim() || '角色图生成任务失败')
      return
    }
    if (event.type !== 'character_template') {
      markFailed(runId, target, taskId, null, '任务结果类型与角色图生成步骤不匹配')
      return
    }
    applyServerResult(runId, {
      ...target,
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
    const target = { revisionId: revision.id, stepId: activeStep.id }

    if (activeStep.submissionId && !activeStep.taskId) {
      if (submissions.has(submissionKey(run.id, revision.id, activeStep.id))) {
        return run
      }
      return markFailed(
        run.id,
        target,
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
        return markFailed(
          latest.id,
          { revisionId: latestRevision.id, stepId: latestStep.id },
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
          { revisionId: latestRevision.id, stepId: latestStep.id },
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
      return markFailed(
        runId,
        { revisionId: revision.id, stepId: step.id },
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

  function markFailed(
    runId: WorkflowRun['id'],
    target: WorkflowStepTarget,
    expectedTaskId: string | null,
    expectedSubmissionId: string | null,
    error: string,
  ) {
    const run = requireWorkflow(runId)
    if (run.status !== 'active' || run.currentRevisionId !== target.revisionId) return run
    const revision = getCurrentRevision(run)
    const step = revision.steps.find((item) => item.id === target.stepId)
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
      ...replaceWorkflowStep(
        run,
        target.revisionId,
        target.stepId,
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
      stopSubscription(subscriptionKey(run.id, revision.id, step.id, step.taskId))
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

  function stop(runId: WorkflowRun['id']) {
    for (const [key, subscription] of subscriptions) {
      if (subscription.runId === runId) stopSubscription(key)
    }
  }

  return { start, resume, stop }
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
