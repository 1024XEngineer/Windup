import {
  CHARACTER_ACTION_FRAME_COUNT,
  type CharacterActionGenerationInput,
  type CharacterActionOutput,
  type Generation,
  type GenerationApis,
  type GenerationEvent,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowRunStore,
} from '@/entities'
import {
  beginActionGenerationState,
  completeActionGenerationState,
  getActiveNode,
  recordActionGenerationTaskState,
} from './workflow-state'

interface ActiveSubscription {
  runId: WorkflowRun['id']
  stop: () => void
}

export interface ActionGenerationTask {
  start(
    runId: WorkflowRun['id'],
    input: CharacterActionGenerationInput,
    nodeId?: WorkflowNode['id'],
  ): Promise<WorkflowRun>
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  stop(runId: WorkflowRun['id']): void
}

interface CreateActionGenerationTaskOptions {
  store: WorkflowRunStore
  generationApis: GenerationApis
  createSubmissionId: () => string
}

/** 管理动作首帧与完整动画的提交、订阅和刷新恢复。 */
export function createActionGenerationTask({
  store,
  generationApis,
  createSubmissionId,
}: CreateActionGenerationTaskOptions): ActionGenerationTask {
  const submissions = new Map<string, Promise<WorkflowRun>>()
  const subscriptions = new Map<string, ActiveSubscription>()

  async function requireRun(runId: WorkflowRun['id']) {
    const run = await store.get(runId)
    if (!run) throw new Error(`WorkflowRun 不存在：${runId}`)
    return run
  }

  async function save(run: WorkflowRun) {
    await store.save(run)
    return run
  }

  async function currentActionNode(runId: WorkflowRun['id'], nodeId?: WorkflowNode['id']) {
    const run = await requireRun(runId)
    const node = getActiveNode(run, nodeId)
    return { run, node }
  }

  async function start(
    runId: WorkflowRun['id'],
    input: CharacterActionGenerationInput,
    nodeId?: WorkflowNode['id'],
  ) {
    const { run, node } = await currentActionNode(runId, nodeId)
    if (run.status !== 'active' || !isActionGenerationNode(node)) return run
    if (node.taskId) {
      subscribe(run, node.taskId)
      return run
    }
    if (node.submissionId) throw new Error('动作生成请求仍在等待后端确认，不能重复提交')

    const key = `${runId}:${node.id}`
    const pending = submissions.get(key)
    if (pending) return pending
    const submission = submit(runId, node.id, input).finally(() => submissions.delete(key))
    submissions.set(key, submission)
    return submission
  }

  async function submit(
    runId: WorkflowRun['id'],
    nodeId: WorkflowNode['id'],
    input: CharacterActionGenerationInput,
  ) {
    const submissionId = createSubmissionId()
    await save(beginActionGenerationState(await requireRun(runId), input, submissionId, nodeId))
    try {
      const generation = await generationApis.create(input)
      const latest = await requireRun(runId)
      const node = getActiveNode(latest, nodeId)
      if (
        (latest.status !== 'active' && latest.status !== 'interrupted') ||
        !isActionGenerationNode(node) ||
        node.submissionId !== submissionId
      ) {
        return latest
      }
      if (generation.type !== 'character_action') {
        throw new Error('生成任务类型与动作生成节点不匹配')
      }
      const withTask = await save(
        recordActionGenerationTaskState(latest, generation.id, input, nodeId),
      )
      if (latest.status === 'interrupted') return withTask
      if (generation.status === 'pending' || generation.status === 'running') {
        subscribe(withTask, generation.id)
        return withTask
      }
      return await applyTerminal(runId, generation.id, generation)
    } catch (cause) {
      const latest = await store.get(runId)
      if (latest?.status === 'active') {
        const node = getActiveNode(latest, nodeId)
        if (isActionGenerationNode(node)) {
          await save(
            completeActionGenerationState(
              latest,
              { error: message(cause, '动作生成请求失败') },
              nodeId,
            ),
          )
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
        void applyTerminal(run.id, taskId, event).catch(async (cause) => {
          console.error('[workflow] 保存动作生成终态失败，正在重新查询', cause)
          try {
            const task = await generationApis.get(run.projectId, taskId)
            await applyTerminal(run.id, taskId, task)
          } catch (retryCause) {
            console.error('[workflow] 重新保存动作生成终态失败', retryCause)
          }
        })
      })
      const active = subscriptions.get(key)
      if (active) subscriptions.set(key, { ...active, stop })
      else stop()
    } catch (cause) {
      subscriptions.delete(key)
      throw cause
    }
  }

  async function applyTerminal(
    runId: WorkflowRun['id'],
    taskId: string,
    task: Generation | GenerationEvent,
  ) {
    const latest = await requireRun(runId)
    if (latest.status !== 'active') return latest
    const node = latest.nodes.find(
      (candidate) =>
        candidate.status === 'active' &&
        !candidate.deletedAt &&
        isActionGenerationNode(candidate) &&
        candidate.taskId === taskId,
    )
    if (!isActionGenerationNode(node) || node.taskId !== taskId) return latest
    stopSubscription(runId, taskId)
    if (task.status === 'failed') {
      return save(
        completeActionGenerationState(
          latest,
          { error: task.error?.trim() || '动作生成任务失败' },
          node.id,
        ),
      )
    }
    const result = task.result
    if (
      task.type !== 'character_action' ||
      result?.type !== 'character_action' ||
      result.frames.length === 0
    ) {
      return save(
        completeActionGenerationState(latest, { error: '动作生成完成但未返回有效动画帧' }, node.id),
      )
    }
    const completeResult = result as CharacterActionOutput
    const frameCountError = getCharacterActionFrameCountError(
      completeResult,
      node.input?.numFrames ?? CHARACTER_ACTION_FRAME_COUNT,
    )
    return save(
      completeActionGenerationState(
        latest,
        frameCountError ? { error: frameCountError } : completeResult,
        node.id,
      ),
    )
  }

  async function resume(runId: WorkflowRun['id']) {
    const initial = await store.get(runId)
    if (!initial || initial.status !== 'active') return initial
    const nodeIds = initial.nodes
      .filter((node) => node.status === 'active' && !node.deletedAt && isActionGenerationNode(node))
      .map((node) => node.id)

    for (const nodeId of nodeIds) {
      const latest = await store.get(runId)
      if (!latest || latest.status !== 'active') return latest
      const node = getActiveNode(latest, nodeId)
      if (!isActionGenerationNode(node)) continue
      if (node.submissionId && !node.taskId) {
        await save(
          completeActionGenerationState(
            latest,
            { error: '页面刷新时动作生成请求尚未返回任务 ID，请重新开始该节点' },
            node.id,
          ),
        )
        continue
      }
      if (!node.taskId) {
        if (node.input) {
          await start(runId, node.input, node.id)
        } else {
          await save(
            completeActionGenerationState(
              latest,
              { error: '动作生成尚未完成提交，请重新确认角色候选' },
              node.id,
            ),
          )
        }
        continue
      }
      try {
        const task = await generationApis.get(latest.projectId, node.taskId)
        if (task.status === 'pending' || task.status === 'running') {
          subscribe(latest, node.taskId)
        } else {
          await applyTerminal(runId, node.taskId, task)
        }
      } catch (cause) {
        // 查询失败只说明当前无法确认后端任务状态，不能把仍在运行的权威任务写成失败。
        throw cause instanceof Error ? cause : new Error(String(cause))
      }
    }
    return store.get(runId)
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

/**
 * Controller 的完整动画验收门槛。生成服务负责补帧，WorkflowRun 只接收恰好 32 帧的
 * 新结果；这里不修改结果数组，避免把后端缺帧静默伪装成成功。
 */
export function getCharacterActionFrameCountError(
  result: CharacterActionOutput,
  expectedFrameCount = CHARACTER_ACTION_FRAME_COUNT,
): string | null {
  const actualFrameCount = result.frames.length
  return actualFrameCount === expectedFrameCount
    ? null
    : `动作生成应返回 ${expectedFrameCount} 帧，实际返回 ${actualFrameCount} 帧`
}

function isActionGenerationNode(
  node: ReturnType<typeof getActiveNode> | undefined,
): node is NonNullable<ReturnType<typeof getActiveNode>> & {
  type: 'action-first-frame' | 'action-full-frame'
} {
  return node?.type === 'action-first-frame' || node?.type === 'action-full-frame'
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message.trim() : fallback
}
