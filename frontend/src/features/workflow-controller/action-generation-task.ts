import type {
  CompleteAnimationGenerationInput,
  CompleteAnimationGenerationResult,
  Generation,
  GenerationApis,
  GenerationEvent,
  WorkflowRun,
  WorkflowRunStore,
} from '@/entities'
import {
  beginActionGenerationState,
  completeActionGenerationState,
  getActiveStep,
  getCurrentRevision,
  recordActionGenerationTaskState,
} from './workflow-state'

interface ActiveSubscription {
  runId: WorkflowRun['id']
  stop: () => void
}

export interface ActionGenerationTask {
  start(runId: WorkflowRun['id'], input: CompleteAnimationGenerationInput): Promise<WorkflowRun>
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  stop(runId: WorkflowRun['id']): void
}

interface CreateActionGenerationTaskOptions {
  store: WorkflowRunStore
  generationApis: GenerationApis
  createSubmissionId: () => string
}

/** 管理完整动作生成的提交、订阅和刷新恢复，页面只负责提供业务输入。 */
export function createActionGenerationTask({
  store,
  generationApis,
  createSubmissionId,
}: CreateActionGenerationTaskOptions): ActionGenerationTask {
  const submissions = new Map<string, Promise<WorkflowRun>>()
  const subscriptions = new Map<string, ActiveSubscription>()

  function requireRun(runId: WorkflowRun['id']) {
    const run = store.get(runId)
    if (!run) throw new Error(`WorkflowRun 不存在：${runId}`)
    return run
  }

  function save(run: WorkflowRun) {
    store.save(run)
    return run
  }

  function currentActionStep(runId: WorkflowRun['id']) {
    const run = requireRun(runId)
    const revision = getCurrentRevision(run)
    const step = getActiveStep(revision)
    return { run, revision, step }
  }

  function start(runId: WorkflowRun['id'], input: CompleteAnimationGenerationInput) {
    const { run, revision, step } = currentActionStep(runId)
    if (run.status !== 'active' || step?.type !== 'action-generation') return Promise.resolve(run)
    if (step.taskId) {
      subscribe(run, step.taskId)
      return Promise.resolve(run)
    }
    if (step.submissionId) throw new Error('动作生成请求仍在等待后端确认，不能重复提交')

    const key = `${runId}:${revision.id}:${step.id}`
    const pending = submissions.get(key)
    if (pending) return pending
    const submission = submit(runId, input).finally(() => submissions.delete(key))
    submissions.set(key, submission)
    return submission
  }

  async function submit(runId: WorkflowRun['id'], input: CompleteAnimationGenerationInput) {
    const submissionId = createSubmissionId()
    save(beginActionGenerationState(requireRun(runId), input, submissionId))
    try {
      const generation = await generationApis.create(input)
      const latest = requireRun(runId)
      const revision = getCurrentRevision(latest)
      const step = getActiveStep(revision)
      if (
        (latest.status !== 'active' && latest.status !== 'interrupted') ||
        step?.type !== 'action-generation' ||
        step.submissionId !== submissionId
      ) {
        return latest
      }
      if (generation.type !== 'complete_animation') {
        throw new Error('生成任务类型与动作生成步骤不匹配')
      }
      const withTask = save(recordActionGenerationTaskState(latest, generation.id, input))
      if (latest.status === 'interrupted') return withTask
      if (generation.status === 'pending' || generation.status === 'running') {
        subscribe(withTask, generation.id)
        return withTask
      }
      return applyTerminal(runId, generation.id, generation)
    } catch (cause) {
      const latest = store.get(runId)
      if (latest?.status === 'active') {
        const step = getActiveStep(getCurrentRevision(latest))
        if (step?.type === 'action-generation') {
          save(completeActionGenerationState(latest, { error: message(cause, '动作生成请求失败') }))
        }
      }
      throw cause instanceof Error ? cause : new Error(String(cause))
    }
  }

  function subscribe(run: WorkflowRun, taskId: string) {
    const key = `${run.id}:${taskId}`
    if (subscriptions.has(key)) return
    subscriptions.set(key, { runId: run.id, stop: () => undefined })
    try {
      const stop = generationApis.subscribe(run.projectId, taskId, (event) => {
        if (event.taskId !== taskId || event.status === 'pending' || event.status === 'running')
          return
        applyTerminal(run.id, taskId, event)
      })
      const active = subscriptions.get(key)
      if (active) subscriptions.set(key, { ...active, stop })
      else stop()
    } catch (cause) {
      subscriptions.delete(key)
      throw cause
    }
  }

  function applyTerminal(
    runId: WorkflowRun['id'],
    taskId: string,
    task: Generation | GenerationEvent,
  ) {
    const latest = requireRun(runId)
    if (latest.status !== 'active') return latest
    const step = getActiveStep(getCurrentRevision(latest))
    if (step?.type !== 'action-generation' || step.taskId !== taskId) return latest
    stopSubscription(runId, taskId)
    if (task.status === 'failed') {
      return save(
        completeActionGenerationState(latest, {
          error: task.error?.trim() || '动作生成任务失败',
        }),
      )
    }
    const result = task.result
    if (
      task.type !== 'complete_animation' ||
      result?.type !== 'complete_animation' ||
      result.frames.length === 0
    ) {
      return save(
        completeActionGenerationState(latest, { error: '动作生成完成但未返回有效动画帧' }),
      )
    }
    return save(completeActionGenerationState(latest, result as CompleteAnimationGenerationResult))
  }

  async function resume(runId: WorkflowRun['id']) {
    const run = store.get(runId)
    if (!run || run.status !== 'active') return run
    const step = getActiveStep(getCurrentRevision(run))
    if (step?.type !== 'action-generation') return run
    if (step.submissionId && !step.taskId) {
      return save(
        completeActionGenerationState(run, {
          error: '页面刷新时动作生成请求尚未返回任务 ID，请重新开始该步骤',
        }),
      )
    }
    if (!step.taskId) {
      if (step.input) return start(runId, step.input)
      return save(
        completeActionGenerationState(run, {
          error: '动作生成尚未完成提交，请重新确认角色候选',
        }),
      )
    }
    try {
      const task = await generationApis.get(run.projectId, step.taskId)
      if (task.status === 'pending' || task.status === 'running') {
        subscribe(run, step.taskId)
        return store.get(runId)
      }
      return applyTerminal(runId, step.taskId, task)
    } catch (cause) {
      const latest = store.get(runId)
      if (!latest || latest.status !== 'active') return latest
      return save(
        completeActionGenerationState(latest, {
          error: message(cause, '恢复动作生成任务失败'),
        }),
      )
    }
  }

  function stopSubscription(runId: string, taskId: string) {
    const key = `${runId}:${taskId}`
    const active = subscriptions.get(key)
    subscriptions.delete(key)
    try {
      active?.stop()
    } catch {
      // 停止订阅失败不能破坏已经保存的工作流状态。
    }
  }

  function stop(runId: WorkflowRun['id']) {
    for (const [key, active] of subscriptions) {
      if (active.runId !== runId) continue
      subscriptions.delete(key)
      try {
        active.stop()
      } catch {
        // 同上。
      }
    }
  }

  return { start, resume, stop }
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message.trim() : fallback
}
