import { describe, expect, it, vi } from 'vitest'

import { WORKFLOW_STEP_ORDER } from './constants'
import type { WorkflowRun, WorkflowStep } from './index'
import {
  createWorkflowRunStore,
  WORKFLOW_RUN_STORAGE_KEY,
  WORKFLOW_RUN_STORAGE_VERSION,
} from './store'

class TestStorage {
  value: string | null
  failOnSet = false

  constructor(value: string | null = null) {
    this.value = value
  }

  getItem(): string | null {
    return this.value
  }

  setItem(_key: string, value: string): void {
    if (this.failOnSet) throw new Error('storage unavailable')
    this.value = value
  }
}

function createSteps(): WorkflowStep[] {
  return WORKFLOW_STEP_ORDER.map((type, index) => {
    const common = {
      id: `revision-1:${type}`,
      status: index === 0 ? ('active' as const) : ('locked' as const),
      taskId: null,
      submissionId: null,
      error: null,
      referenceStepIds: [],
    }
    if (type === 'character-setup') {
      return {
        ...common,
        type,
        input: { description: 'slime', referenceMedia: [] },
        output: null,
      }
    }
    if (type === 'character-template') {
      return { ...common, type, input: null, output: null }
    }
    return { ...common, type, input: null, output: null } as WorkflowStep
  })
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
    revisions: [
      {
        id: 'revision-1',
        basedOnRevisionId: null,
        restartStepId: null,
        status: 'active',
        steps: createSteps(),
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        createdAt: '2026-07-30T12:00:00.000Z',
      },
    ],
    prompt: 'Create a slime',
  }
}

describe('createWorkflowRunStore', () => {
  it('stores a versioned snapshot and returns defensive clones', () => {
    const storage = new TestStorage()
    const store = createWorkflowRunStore({ storage })
    const source = createRun()

    store.save(source)
    source.prompt = 'mutated outside'

    const firstRead = store.get(source.id)
    expect(firstRead?.prompt).toBe('Create a slime')

    firstRead!.revisions[0].steps[0].status = 'failed'
    expect(store.get(source.id)?.revisions[0].steps[0].status).toBe('active')

    expect(JSON.parse(storage.value!)).toEqual({
      version: WORKFLOW_RUN_STORAGE_VERSION,
      runs: [createRun()],
    })
  })

  it('hydrates valid runs from localStorage', () => {
    const run = createRun()
    const storage = new TestStorage(
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [run],
      }),
    )

    const store = createWorkflowRunStore({ storage })

    expect(store.get(run.id)).toEqual(run)
  })

  it.each([
    ['invalid JSON', '{'],
    ['unknown version', JSON.stringify({ version: 2, runs: [createRun()] })],
    ['invalid payload', JSON.stringify({ version: WORKFLOW_RUN_STORAGE_VERSION, runs: {} })],
    [
      'invalid run',
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [{ ...createRun(), currentRevisionId: 'missing-revision' }],
      }),
    ],
    [
      'inconsistent run status',
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [{ ...createRun(), status: 'failed' }],
      }),
    ],
    [
      'multiple revisions in storage version 1',
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [
          {
            ...createRun(),
            revisions: [
              ...createRun().revisions,
              {
                ...createRun().revisions[0],
                id: 'revision-2',
                status: 'abandoned',
              },
            ],
          },
        ],
      }),
    ],
    [
      'restart metadata in storage version 1',
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [
          {
            ...createRun(),
            revisions: [
              {
                ...createRun().revisions[0],
                restartStepId: 'revision-1:character-setup',
              },
            ],
          },
        ],
      }),
    ],
  ])('ignores %s in localStorage', (_label, serialized) => {
    const store = createWorkflowRunStore({ storage: new TestStorage(serialized) })

    expect(store.get('run-1')).toBeNull()
  })

  it('keeps the memory snapshot and notifies subscribers when persistence fails', () => {
    const storage = new TestStorage()
    storage.failOnSet = true
    const store = createWorkflowRunStore({ storage })
    const listener = vi.fn()
    const run = createRun()

    store.subscribe(run.id, listener)

    expect(() => store.save(run)).not.toThrow()
    expect(store.get(run.id)).toEqual(run)
    expect(listener).toHaveBeenCalledWith(run)
  })

  it('isolates subscriber values and stops notifications after unsubscribe', () => {
    const store = createWorkflowRunStore({ storage: null })
    const run = createRun()
    const secondListener = vi.fn()
    const unsubscribeFirst = store.subscribe(run.id, (savedRun) => {
      savedRun.prompt = 'mutated by first listener'
    })
    const unsubscribeSecond = store.subscribe(run.id, secondListener)

    store.save(run)

    expect(secondListener).toHaveBeenLastCalledWith(run)
    expect(store.get(run.id)).toEqual(run)

    unsubscribeFirst()
    unsubscribeSecond()
    store.save({ ...run, prompt: 'new prompt' })

    expect(secondListener).toHaveBeenCalledTimes(1)
  })

  it('does not let one failing subscriber block the saved state or other subscribers', () => {
    const store = createWorkflowRunStore({ storage: null })
    const run = createRun()
    const secondListener = vi.fn()

    store.subscribe(run.id, () => {
      throw new Error('render failed')
    })
    store.subscribe(run.id, secondListener)

    expect(() => store.save(run)).not.toThrow()
    expect(store.get(run.id)).toEqual(run)
    expect(secondListener).toHaveBeenCalledWith(run)
  })

  it('uses the stable storage key by default', () => {
    const setItem = vi.fn()
    const store = createWorkflowRunStore({
      storage: {
        getItem: vi.fn(() => null),
        setItem,
      },
    })

    store.save(createRun())

    expect(setItem).toHaveBeenCalledWith(WORKFLOW_RUN_STORAGE_KEY, expect.any(String))
  })
})
