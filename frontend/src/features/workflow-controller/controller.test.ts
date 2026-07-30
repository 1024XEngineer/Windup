import { describe, expect, it, vi } from 'vitest'

import {
  WORKFLOW_STEP_ORDER,
  type Generation,
  type GenerationApis,
  type GenerationInput,
  type Task,
  type TaskApis,
  type TaskEvent,
  type WorkflowRevision,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowStepType,
} from '@/entities'
import { createWorkflowController } from '.'

const NOW = '2026-07-30T12:00:00.000Z'

type RunListener = (run: WorkflowRun) => void

function cloneRun(run: WorkflowRun): WorkflowRun {
  return structuredClone(run)
}

function createMemoryStore() {
  const runs = new Map<string, WorkflowRun>()
  const listeners = new Map<string, Set<RunListener>>()

  const get = vi.fn((runId: string): WorkflowRun | null => {
    const run = runs.get(runId)
    return run ? cloneRun(run) : null
  })

  const save = vi.fn((run: WorkflowRun): void => {
    const snapshot = cloneRun(run)
    runs.set(run.id, snapshot)

    for (const listener of listeners.get(run.id) ?? []) {
      listener(cloneRun(snapshot))
    }
  })

  const subscribe = vi.fn((runId: string, listener: RunListener): (() => void) => {
    const runListeners = listeners.get(runId) ?? new Set<RunListener>()
    runListeners.add(listener)
    listeners.set(runId, runListeners)

    return () => {
      runListeners.delete(listener)
    }
  })

  return { get, save, subscribe }
}

function createIdFactory() {
  let nextId = 0
  return vi.fn(() => `id-${++nextId}`)
}

function deferNextGeneration(harness: ReturnType<typeof createHarness>) {
  let resolve!: (generation: Generation<'character_template'>) => void
  const promise = new Promise<Generation<'character_template'>>((resolvePromise) => {
    resolve = resolvePromise
  })
  vi.mocked(harness.generationApis.create).mockImplementationOnce(
    async <T extends GenerationInput>() => (await promise) as Generation<T['type']>,
  )
  return { resolve }
}

function pendingCharacterTemplateGeneration(): Generation<'character_template'> {
  return {
    id: 'task-1',
    projectId: 'project-1',
    type: 'character_template',
    status: 'pending',
    result: null,
    error: null,
  }
}

function createHarness() {
  const store = createMemoryStore()
  const taskListeners = new Map<string, (event: TaskEvent) => void>()

  const createGeneration: GenerationApis['create'] = async <T extends GenerationInput>(input: T) =>
    ({
      id: 'task-1',
      projectId: input.projectId,
      type: input.type,
      status: 'pending',
      result: null,
      error: null,
    }) as Generation<T['type']>

  const generationApis: Pick<GenerationApis, 'create'> = {
    create: vi.fn(createGeneration),
  }

  const subscribeTask = vi.fn(
    (projectId: string, taskId: string, onEvent: (event: TaskEvent) => void) => {
      taskListeners.set(`${projectId}:${taskId}`, onEvent)
      onEvent({
        taskId,
        type: 'character_template',
        status: 'pending',
        error: null,
        result: null,
      })
      return () => {
        taskListeners.delete(`${projectId}:${taskId}`)
      }
    },
  )

  const taskApis: TaskApis = {
    get: vi.fn(async () => {
      throw new Error('TaskApis.get is not used until a run is resumed')
    }),
    subscribe: subscribeTask,
  }

  const controller = createWorkflowController({
    store,
    generationApis,
    taskApis,
    createId: createIdFactory(),
    now: () => NOW,
  })

  return {
    controller,
    generationApis,
    subscribeTask,
    store,
    taskApis,
    getTaskListener(projectId: string, taskId: string) {
      return taskListeners.get(`${projectId}:${taskId}`) ?? null
    },
    emitTask(projectId: string, taskId: string, event: TaskEvent) {
      const listener = taskListeners.get(`${projectId}:${taskId}`)
      expect(listener, `missing task subscription for ${projectId}:${taskId}`).toBeTypeOf(
        'function',
      )
      listener?.(event)
    },
  }
}

function currentRevision(run: WorkflowRun): WorkflowRevision {
  const revision = run.revisions.find(({ id }) => id === run.currentRevisionId)
  if (!revision) {
    throw new Error(`Current revision ${run.currentRevisionId} is missing`)
  }
  return revision
}

function step(run: WorkflowRun, type: WorkflowStepType): WorkflowStep {
  const workflowStep = currentRevision(run).steps.find((item) => item.type === type)
  if (!workflowStep) {
    throw new Error(`Workflow step ${type} is missing`)
  }
  return workflowStep
}

async function createAiRun(harness: ReturnType<typeof createHarness>) {
  return harness.controller.create({
    projectId: 'project-1',
    purpose: 'create_character',
    driver: 'ai',
    prompt: '  pixel knight  ',
  })
}

async function startCharacterTemplate(harness: ReturnType<typeof createHarness>) {
  const run = await createAiRun(harness)
  await harness.controller.nextStep(run.id)
  return run
}

describe('createWorkflowController', () => {
  it('creates one revision with the fixed eight steps and seeds AI input from the prompt', async () => {
    const harness = createHarness()

    expect(harness.controller).toEqual(
      expect.objectContaining({
        create: expect.any(Function),
        getWorkflow: expect.any(Function),
        subscribe: expect.any(Function),
        updateCharacterSetup: expect.any(Function),
        nextStep: expect.any(Function),
        resume: expect.any(Function),
        interrupt: expect.any(Function),
      }),
    )

    const run = await createAiRun(harness)
    const revision = currentRevision(run)

    expect(run.prompt).toBe('pixel knight')
    expect(run.projectId).toBe('project-1')
    expect(run.revisions).toHaveLength(1)
    expect(run.currentRevisionId).toBe(revision.id)
    expect(revision.basedOnRevisionId).toBeNull()
    expect(revision.restartStepId).toBeNull()
    expect(revision.createdAt).toBe(NOW)
    expect(revision.steps.map(({ type }) => type)).toEqual(WORKFLOW_STEP_ORDER)
    expect(revision.steps.map(({ status }) => status)).toEqual([
      'active',
      'locked',
      'locked',
      'locked',
      'locked',
      'locked',
      'locked',
      'locked',
    ])
    expect(step(run, 'character-setup').input).toEqual({
      description: 'pixel knight',
      referenceMedia: [],
    })

    const allIds = [run.id, revision.id, ...revision.steps.map(({ id }) => id)]
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(harness.store.save).toHaveBeenCalledWith(run)
  })

  it('persists the task id before subscribing and never submits the active generation twice', async () => {
    const harness = createHarness()

    await startCharacterTemplate(harness)

    expect(harness.generationApis.create).toHaveBeenCalledTimes(1)
    expect(harness.generationApis.create).toHaveBeenCalledWith({
      type: 'character_template',
      projectId: 'project-1',
      prompt: 'pixel knight',
      referenceMedia: [],
    })
    expect(harness.subscribeTask).toHaveBeenCalledWith('project-1', 'task-1', expect.any(Function))

    const taskSaveIndex = harness.store.save.mock.calls.findIndex(([savedRun]) => {
      return step(savedRun, 'character-template').taskId === 'task-1'
    })
    expect(taskSaveIndex).toBeGreaterThanOrEqual(0)
    expect(harness.store.save.mock.invocationCallOrder[taskSaveIndex]).toBeLessThan(
      harness.subscribeTask.mock.invocationCallOrder[0],
    )

    const createdRun = harness.store.save.mock.calls[0]?.[0]
    if (!createdRun) throw new Error('Expected the created WorkflowRun to be saved')
    const activeRun = harness.controller.getWorkflow(createdRun.id)
    if (!activeRun) throw new Error('Expected the WorkflowRun to remain available')
    expect(step(activeRun, 'character-setup').status).toBe('passed')
    expect(step(activeRun, 'character-template')).toMatchObject({
      status: 'active',
      taskId: 'task-1',
    })

    await harness.controller.nextStep(activeRun.id)
    expect(harness.generationApis.create).toHaveBeenCalledTimes(1)
  })

  it('shares one submission when nextStep is called concurrently', async () => {
    const harness = createHarness()
    const run = await createAiRun(harness)
    const deferred = deferNextGeneration(harness)

    const first = harness.controller.nextStep(run.id)
    const second = harness.controller.nextStep(run.id)

    expect(harness.generationApis.create).toHaveBeenCalledTimes(1)
    deferred.resolve(pendingCharacterTemplateGeneration())
    await Promise.all([first, second])

    expect(harness.generationApis.create).toHaveBeenCalledTimes(1)
    expect(step(harness.controller.getWorkflow(run.id)!, 'character-template').taskId).toBe(
      'task-1',
    )
  })

  it('keeps an active submission alive when resume uses the same controller', async () => {
    const harness = createHarness()
    const run = await createAiRun(harness)
    const deferred = deferNextGeneration(harness)

    const submission = harness.controller.nextStep(run.id)
    const resumed = await harness.controller.resume(run.id)

    expect(resumed?.status).toBe('active')
    expect(step(resumed!, 'character-template')).toMatchObject({
      status: 'active',
      taskId: null,
      submissionId: expect.any(String),
    })

    deferred.resolve(pendingCharacterTemplateGeneration())
    await submission

    expect(harness.generationApis.create).toHaveBeenCalledTimes(1)
    expect(step(harness.controller.getWorkflow(run.id)!, 'character-template').taskId).toBe(
      'task-1',
    )
  })

  it('handles a terminal snapshot emitted synchronously when subscribing', async () => {
    const harness = createHarness()
    const stop = vi.fn()
    harness.subscribeTask.mockImplementationOnce((_projectId, _taskId, onEvent) => {
      onEvent({
        taskId: 'task-1',
        type: 'character_template',
        status: 'completed',
        error: null,
        result: {
          type: 'character_template',
          images: [{ url: 'https://example.com/synchronous.png' }],
        },
      })
      return stop
    })

    const run = await createAiRun(harness)
    await harness.controller.nextStep(run.id)

    expect(step(harness.controller.getWorkflow(run.id)!, 'character-template')).toMatchObject({
      status: 'passed',
      taskId: null,
    })
    expect(step(harness.controller.getWorkflow(run.id)!, 'template-candidate').status).toBe(
      'active',
    )
    expect(stop).toHaveBeenCalledOnce()
  })

  it('ignores another task result and advances only when the matching task completes', async () => {
    const harness = createHarness()

    const run = await startCharacterTemplate(harness)

    harness.emitTask('project-1', 'task-1', {
      taskId: 'another-task',
      type: 'character_template',
      status: 'completed',
      error: null,
      result: {
        type: 'character_template',
        images: [{ url: 'https://example.com/wrong.png' }],
      },
    })

    const unchangedRun = harness.controller.getWorkflow(run.id)
    if (!unchangedRun) throw new Error('Expected the WorkflowRun to remain available')
    expect(step(unchangedRun, 'character-template')).toMatchObject({
      status: 'active',
      output: null,
      taskId: 'task-1',
    })
    expect(step(unchangedRun, 'template-candidate').status).toBe('locked')

    const result = {
      type: 'character_template' as const,
      images: [{ url: 'https://example.com/knight.png' }],
    }
    harness.emitTask('project-1', 'task-1', {
      taskId: 'task-1',
      type: 'character_template',
      status: 'completed',
      error: null,
      result,
    })

    const completedRun = harness.controller.getWorkflow(run.id)
    if (!completedRun) throw new Error('Expected the WorkflowRun to remain available')
    expect(step(completedRun, 'character-template')).toMatchObject({
      status: 'passed',
      output: result,
      taskId: null,
    })
    expect(step(completedRun, 'template-candidate').status).toBe('active')
  })

  it('marks the step, revision, generation, and run as failed when the task fails', async () => {
    const harness = createHarness()

    const run = await startCharacterTemplate(harness)

    harness.emitTask('project-1', 'task-1', {
      taskId: 'task-1',
      type: 'character_template',
      status: 'failed',
      error: 'model unavailable',
      result: null,
    })

    const failedRun = harness.controller.getWorkflow(run.id)
    if (!failedRun) throw new Error('Expected the WorkflowRun to remain available')
    const revision = currentRevision(failedRun)
    expect(step(failedRun, 'character-template')).toMatchObject({
      status: 'failed',
      taskId: null,
      submissionId: null,
      error: 'model unavailable',
    })
    expect(revision.status).toBe('failed')
    expect(revision.generationStatus).toBe('failed')
    expect(failedRun.status).toBe('failed')
  })

  it('resumes a persisted in-flight task without creating another generation', async () => {
    const harness = createHarness()
    const run = await startCharacterTemplate(harness)
    vi.mocked(harness.taskApis.get).mockResolvedValueOnce({
      id: 'task-1',
      type: 'character_template',
      status: 'running',
      error: null,
      result: null,
    })
    const resumeSubscribe = vi.fn(
      (_projectId: string, _taskId: string, _onEvent: (event: TaskEvent) => void) => () =>
        undefined,
    )
    const resumedController = createWorkflowController({
      store: harness.store,
      generationApis: harness.generationApis,
      taskApis: {
        get: harness.taskApis.get,
        subscribe: resumeSubscribe,
      },
    })

    const resumed = await resumedController.resume(run.id)

    expect(resumed?.id).toBe(run.id)
    expect(harness.taskApis.get).toHaveBeenCalledWith('project-1', 'task-1')
    expect(resumeSubscribe).toHaveBeenCalledWith('project-1', 'task-1', expect.any(Function))
    expect(harness.generationApis.create).toHaveBeenCalledTimes(1)
  })

  it('applies a completed task found during refresh before subscribing again', async () => {
    const harness = createHarness()
    const run = await startCharacterTemplate(harness)
    vi.mocked(harness.taskApis.get).mockResolvedValueOnce({
      id: 'task-1',
      type: 'character_template',
      status: 'completed',
      error: null,
      result: {
        type: 'character_template',
        images: [{ url: 'https://example.com/recovered.png' }],
      },
    })
    const resumeSubscribe = vi.fn(
      (_projectId: string, _taskId: string, _onEvent: (event: TaskEvent) => void) => () =>
        undefined,
    )
    const resumedController = createWorkflowController({
      store: harness.store,
      generationApis: harness.generationApis,
      taskApis: {
        get: harness.taskApis.get,
        subscribe: resumeSubscribe,
      },
    })

    const resumed = await resumedController.resume(run.id)

    expect(step(resumed!, 'character-template')).toMatchObject({
      status: 'passed',
      taskId: null,
    })
    expect(step(resumed!, 'template-candidate').status).toBe('active')
    expect(resumeSubscribe).not.toHaveBeenCalled()
  })

  it('does not subscribe after interrupting while resume waits for the task query', async () => {
    const harness = createHarness()
    const run = await startCharacterTemplate(harness)
    let resolveTask!: (task: Task) => void
    const pendingTask = new Promise<Task>((resolve) => {
      resolveTask = resolve
    })
    const resumeSubscribe = vi.fn(
      (_projectId: string, _taskId: string, _onEvent: (event: TaskEvent) => void) => () =>
        undefined,
    )
    const resumedController = createWorkflowController({
      store: harness.store,
      generationApis: harness.generationApis,
      taskApis: {
        get: vi.fn(() => pendingTask),
        subscribe: resumeSubscribe,
      },
    })

    const resuming = resumedController.resume(run.id)
    resumedController.interrupt(run.id)
    resolveTask({
      id: 'task-1',
      type: 'character_template',
      status: 'running',
      error: null,
      result: null,
    })
    const resumed = await resuming

    expect(resumed?.status).toBe('interrupted')
    expect(resumeSubscribe).not.toHaveBeenCalled()
  })

  it('fails safely after refresh when the request was sent before taskId arrived', async () => {
    const harness = createHarness()
    const run = await startCharacterTemplate(harness)
    const uncertainSnapshot = harness.store.save.mock.calls
      .map(([savedRun]) => savedRun)
      .find((savedRun) => {
        const template = step(savedRun, 'character-template')
        return template.submissionId !== null && template.taskId === null
      })
    if (!uncertainSnapshot) throw new Error('expected the submitting snapshot to be persisted')
    harness.store.save(uncertainSnapshot)
    vi.mocked(harness.generationApis.create).mockClear()

    const restoredController = createWorkflowController({
      store: harness.store,
      generationApis: harness.generationApis,
      taskApis: harness.taskApis,
    })

    const restored = await restoredController.resume(run.id)

    expect(restored?.status).toBe('failed')
    expect(step(restored!, 'character-template')).toMatchObject({
      status: 'failed',
      taskId: null,
      submissionId: null,
      error: '页面刷新时生成请求尚未返回任务 ID，已停止恢复以避免重复提交',
    })
    expect(harness.generationApis.create).not.toHaveBeenCalled()
  })

  it('records a task id that returns after the run was interrupted', async () => {
    const harness = createHarness()
    const run = await createAiRun(harness)
    const deferred = deferNextGeneration(harness)

    const submission = harness.controller.nextStep(run.id)
    await harness.controller.interrupt(run.id)
    deferred.resolve(pendingCharacterTemplateGeneration())
    await submission

    const interrupted = harness.controller.getWorkflow(run.id)
    expect(interrupted?.status).toBe('interrupted')
    expect(step(interrupted!, 'character-template')).toMatchObject({
      status: 'active',
      taskId: 'task-1',
      submissionId: null,
    })
    expect(harness.subscribeTask).not.toHaveBeenCalled()
  })

  it('keeps an interrupted run interrupted when a queued failure arrives late', async () => {
    const harness = createHarness()
    const run = await startCharacterTemplate(harness)
    const queuedListener = harness.getTaskListener('project-1', 'task-1')
    if (!queuedListener) throw new Error('expected an active task subscription')

    await harness.controller.interrupt(run.id)
    queuedListener({
      taskId: 'task-1',
      type: 'character_template',
      status: 'failed',
      error: 'late failure',
      result: null,
    })

    expect(harness.controller.getWorkflow(run.id)?.status).toBe('interrupted')
  })

  it('publishes saved updates and can interrupt the current run', async () => {
    const harness = createHarness()
    const run = await createAiRun(harness)
    const listener = vi.fn<RunListener>()
    const unsubscribe = harness.controller.subscribe(run.id, listener)

    const updated = await harness.controller.updateCharacterSetup(run.id, {
      description: 'revised knight',
      referenceMedia: [],
    })
    expect(step(updated, 'character-setup').input).toEqual({
      description: 'revised knight',
      referenceMedia: [],
    })

    const interrupted = await harness.controller.interrupt(run.id)

    expect(interrupted.status).toBe('interrupted')
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: run.id, status: 'interrupted' }),
    )

    unsubscribe()
  })
})
