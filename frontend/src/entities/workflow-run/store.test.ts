import { describe, expect, it, vi } from 'vitest'

import type { WorkflowRevision, WorkflowRun, WorkflowStep } from './index'
import {
  createWorkflowRunStore,
  WORKFLOW_RUN_STORAGE_KEY,
  WORKFLOW_RUN_STORAGE_VERSION,
} from './store'
import { WORKFLOW_STEP_ORDER } from './constants'

class TestStorage {
  value: string | null
  failOnSet = false

  constructor(value: string | null = null) {
    this.value = value
  }

  getItem() {
    return this.value
  }

  setItem(_key: string, value: string) {
    if (this.failOnSet) throw new Error('storage full')
    this.value = value
  }
}

function createSteps(prefix: string, activeIndex = 0): WorkflowStep[] {
  return WORKFLOW_STEP_ORDER.map((type, index) => ({
    id: `${prefix}:${type}`,
    type,
    status: index === activeIndex ? 'active' : 'locked',
    input: null,
    output: null,
    taskId: null,
    submissionId: null,
    error: null,
    referenceStepIds: [],
  }))
}

function createRevision(id = 'revision-1'): WorkflowRevision {
  return {
    id,
    basedOnRevisionId: null,
    restartStepId: null,
    status: 'active',
    steps: createSteps(id),
    generationStatus: 'not_started',
    exportStatus: 'not_exported',
    createdAt: '2026-08-03T00:00:00.000Z',
  }
}

function createRun(id = 'run-1'): WorkflowRun {
  return {
    id,
    projectId: 'project-1',
    characterId: null,
    outfitId: null,
    purpose: 'create_character',
    driver: 'ai',
    status: 'active',
    currentRevisionId: 'revision-1',
    revisions: [createRevision()],
    prompt: 'Create a hero',
  }
}

function createRunWithHistory(): WorkflowRun {
  const first = createRevision()
  first.status = 'abandoned'
  first.steps = first.steps.map((step, index) => ({
    ...step,
    status: index === 0 ? 'passed' : 'locked',
  }))
  const second = createRevision('revision-2')
  second.basedOnRevisionId = first.id
  second.restartStepId = first.steps[0]!.id
  second.steps[0]!.referenceStepIds = [first.steps[0]!.id]

  return {
    ...createRun(),
    currentRevisionId: second.id,
    revisions: [first, second],
  }
}

describe('createWorkflowRunStore', () => {
  it('persists versioned snapshots and returns defensive copies', () => {
    const storage = new TestStorage()
    const store = createWorkflowRunStore({ storage })
    const run = createRun()

    store.save(run)
    run.prompt = 'changed outside'
    const restored = store.get(run.id)!
    restored.revisions[0]!.steps[0]!.status = 'failed'

    expect(store.get(run.id)?.prompt).toBe('Create a hero')
    expect(store.get(run.id)?.revisions[0]?.steps[0]?.status).toBe('active')
    expect(JSON.parse(storage.value!)).toEqual({
      version: WORKFLOW_RUN_STORAGE_VERSION,
      runs: [createRun()],
    })
  })

  it('hydrates a valid revision history and exposes it through list', () => {
    const run = createRunWithHistory()
    const storage = new TestStorage(
      JSON.stringify({ version: WORKFLOW_RUN_STORAGE_VERSION, runs: [run] }),
    )
    const store = createWorkflowRunStore({ storage })

    expect(store.get(run.id)).toEqual(run)
    expect(store.list()).toEqual([run])
  })

  it.each([
    ['invalid JSON', '{'],
    ['unknown version', JSON.stringify({ version: 99, runs: [createRun()] })],
    [
      'missing history source',
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [
          {
            ...createRunWithHistory(),
            revisions: [
              createRunWithHistory().revisions[0],
              { ...createRunWithHistory().revisions[1], basedOnRevisionId: 'missing' },
            ],
          },
        ],
      }),
    ],
    [
      'unknown referenced step',
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [
          {
            ...createRunWithHistory(),
            revisions: [
              createRunWithHistory().revisions[0],
              {
                ...createRunWithHistory().revisions[1],
                steps: createRunWithHistory().revisions[1]!.steps.map((step, index) =>
                  index === 0 ? { ...step, referenceStepIds: ['missing-step'] } : step,
                ),
              },
            ],
          },
        ],
      }),
    ],
  ])('ignores %s during hydration', (_label, serialized) => {
    expect(createWorkflowRunStore({ storage: new TestStorage(serialized) }).list()).toEqual([])
  })

  it('rejects invalid snapshots before they reach memory', () => {
    const store = createWorkflowRunStore({ storage: null })
    const invalid = createRun()
    invalid.revisions[0]!.steps[0]!.error = 'failed without failed status'

    expect(() => store.save(invalid)).toThrow('Invalid WorkflowRun snapshot')
    expect(store.get(invalid.id)).toBeNull()
  })

  it('keeps memory authoritative when persistence fails', () => {
    const storage = new TestStorage()
    storage.failOnSet = true
    const store = createWorkflowRunStore({ storage })

    expect(() => store.save(createRun())).not.toThrow()
    expect(store.get('run-1')).toEqual(createRun())
  })

  it('notifies run and history subscribers without sharing mutable values', () => {
    const store = createWorkflowRunStore({ storage: null })
    const runListener = vi.fn((run: WorkflowRun) => {
      run.prompt = 'listener mutation'
    })
    const listListener = vi.fn()
    const unsubscribeRun = store.subscribe('run-1', runListener)
    const unsubscribeAll = store.subscribeAll(listListener)

    store.save(createRun())

    expect(store.get('run-1')?.prompt).toBe('Create a hero')
    expect(listListener).toHaveBeenCalledWith([createRun()])
    unsubscribeRun()
    unsubscribeAll()
    store.save({ ...createRun(), prompt: 'second save' })
    expect(runListener).toHaveBeenCalledTimes(1)
    expect(listListener).toHaveBeenCalledTimes(1)
  })

  it('uses the stable browser storage key', () => {
    const setItem = vi.fn()
    const store = createWorkflowRunStore({ storage: { getItem: () => null, setItem } })

    store.save(createRun())

    expect(setItem).toHaveBeenCalledWith(WORKFLOW_RUN_STORAGE_KEY, expect.any(String))
  })
})
