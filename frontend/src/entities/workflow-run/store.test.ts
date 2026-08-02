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

function createLegacyRun(): unknown {
  const run = createRun()
  const revision = run.revisions[0]
  if (!revision) throw new Error('Expected a revision')

  const [characterSetup, characterTemplate, templateCandidate, actionGeneration, review] =
    revision.steps
  if (!characterSetup || !characterTemplate || !templateCandidate || !actionGeneration || !review) {
    throw new Error('Expected the five current workflow steps')
  }

  return {
    ...run,
    revisions: [
      {
        ...revision,
        steps: [
          characterSetup,
          characterTemplate,
          templateCandidate,
          { ...actionGeneration, id: 'revision-1:action-setup', type: 'action-setup' },
          { ...actionGeneration, id: 'revision-1:first-frame', type: 'first-frame' },
          { ...actionGeneration, id: 'revision-1:complete-animation', type: 'complete-animation' },
          review,
          { ...review, id: 'revision-1:export', type: 'export' },
        ],
      },
    ],
  }
}

function createRestartedRun(): WorkflowRun {
  const source = createRun()
  const sourceRevision = source.revisions[0]!
  const sourceSteps = sourceRevision.steps.map((step) =>
    step.type === 'character-setup' || step.type === 'character-template'
      ? { ...step, status: 'passed' as const }
      : step.type === 'template-candidate'
        ? { ...step, status: 'active' as const }
        : step,
  )
  const restartedSteps = sourceSteps.map((step, index) => {
    const common = {
      ...step,
      id: `revision-2:${step.type}`,
      taskId: null,
      submissionId: null,
      error: null,
    }
    if (index === 0) return { ...common, status: 'passed' as const, referenceStepIds: [step.id] }
    if (index === 1) {
      return {
        ...common,
        status: 'active' as const,
        output: null,
        referenceStepIds: [step.id],
      }
    }
    return { ...common, status: 'locked' as const, input: null, output: null, referenceStepIds: [] }
  }) as WorkflowStep[]

  return {
    ...source,
    currentRevisionId: 'revision-2',
    revisions: [
      { ...sourceRevision, status: 'abandoned', steps: sourceSteps },
      {
        id: 'revision-2',
        basedOnRevisionId: 'revision-1',
        restartStepId: 'revision-1:character-template',
        status: 'active',
        steps: restartedSteps,
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        createdAt: '2026-07-31T03:00:00.000Z',
      },
    ],
  }
}

describe('createWorkflowRunStore', () => {
  it('lists cloned snapshots and notifies whole-store subscribers', () => {
    const store = createWorkflowRunStore({ storage: null })
    const listener = vi.fn()
    const unsubscribe = store.subscribeAll(listener)

    store.save(createRun('run-1'))
    store.save(createRun('run-2'))

    expect(store.list().map((run) => run.id)).toEqual(['run-1', 'run-2'])
    expect(listener).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'run-1' }),
      expect.objectContaining({ id: 'run-2' }),
    ])
    unsubscribe()
    store.save(createRun('run-3'))
    expect(listener).toHaveBeenCalledTimes(2)
  })
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

  it('migrates version-three single-frame action output without dropping history', () => {
    const run = createRun()
    const revision = run.revisions[0]!
    revision.steps = revision.steps.map((step) => {
      if (step.type === 'character-setup') return { ...step, status: 'passed' }
      if (step.type === 'character-template') {
        return {
          ...step,
          status: 'passed',
          output: { type: 'character_template', images: [{ url: 'template.png' }] },
        }
      }
      if (step.type === 'template-candidate') return { ...step, status: 'passed' }
      if (step.type === 'action-generation') {
        return {
          ...step,
          status: 'passed',
          input: {
            type: 'complete_animation',
            projectId: 'project-1',
            characterId: 'character-1',
            outfitId: 'outfit-1',
            actionType: 'idle',
            firstFrameUrl: 'template.png',
            prompt: null,
            referenceMedia: ['template.png'],
          },
          output: { type: 'first_frame', image: { url: 'frame.png' } },
        } as unknown as WorkflowStep
      }
      return { ...step, status: 'active' }
    })
    const storage = new TestStorage(JSON.stringify({ version: 3, runs: [run] }))

    const restored = createWorkflowRunStore({ storage }).get(run.id)
    const action = restored?.revisions[0]?.steps.find((step) => step.type === 'action-generation')

    expect(action?.output).toEqual({
      type: 'complete_animation',
      actionType: 'idle',
      frames: [{ url: 'frame.png', durationMs: null }],
    })
  })

  it('migrates a version-one run to the fixed five-step model', () => {
    const store = createWorkflowRunStore({
      storage: new TestStorage(
        JSON.stringify({
          version: 1,
          runs: [createLegacyRun()],
        }),
      ),
    })

    expect(store.get('run-1')?.revisions[0]?.steps.map((step) => step.type)).toEqual([
      'character-setup',
      'character-template',
      'template-candidate',
      'action-generation',
      'review',
    ])
    expect(store.get('run-1')?.revisions[0]?.exportStatus).toBe('not_exported')
  })

  it('migrates version-two runs and restores their restart history', () => {
    const legacyRun = createRun()
    const versionTwoStore = createWorkflowRunStore({
      storage: new TestStorage(JSON.stringify({ version: 2, runs: [legacyRun] })),
    })
    const historyStore = createWorkflowRunStore({
      storage: new TestStorage(
        JSON.stringify({ version: WORKFLOW_RUN_STORAGE_VERSION, runs: [createRestartedRun()] }),
      ),
    })

    expect(versionTwoStore.get('run-1')).toEqual(legacyRun)
    expect(historyStore.get('run-1')).toMatchObject({
      currentRevisionId: 'revision-2',
      revisions: [
        { id: 'revision-1', status: 'abandoned' },
        {
          id: 'revision-2',
          basedOnRevisionId: 'revision-1',
          restartStepId: 'revision-1:character-template',
        },
      ],
    })
  })

  it.each([
    ['invalid JSON', '{'],
    ['unknown version', JSON.stringify({ version: 99, runs: [createRun()] })],
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
      'orphaned restart revision',
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [
          {
            ...createRestartedRun(),
            revisions: [
              createRestartedRun().revisions[0],
              { ...createRestartedRun().revisions[1], basedOnRevisionId: 'missing-revision' },
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
