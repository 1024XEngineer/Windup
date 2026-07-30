import { describe, expect, it, vi } from 'vitest'

import {
  createWorkflowRunStore,
  type Generation,
  type GenerationApis,
  type GenerationInput,
  type TaskApis,
  type TaskEvent,
} from '@/entities'
import { createWorkflowController } from '.'

describe('WorkflowRun first vertical slice', () => {
  it('runs character setup through a completed character-template task', async () => {
    const store = createWorkflowRunStore({ storage: null })
    const taskChannel: { listener?: (event: TaskEvent) => void } = {}

    const createGeneration: GenerationApis['create'] = async <T extends GenerationInput>(
      input: T,
    ) =>
      ({
        id: 'task-character-template-1',
        projectId: input.projectId,
        type: input.type,
        status: 'pending',
        result: null,
        error: null,
      }) as Generation<T['type']>

    const generationApis: Pick<GenerationApis, 'create'> = {
      create: vi.fn(createGeneration),
    }
    const taskApis: TaskApis = {
      get: vi.fn(async () => {
        throw new Error('not used in this slice')
      }),
      subscribe: vi.fn((_projectId, taskId, onEvent) => {
        taskChannel.listener = onEvent
        onEvent({
          taskId,
          type: 'character_template',
          status: 'pending',
          error: null,
          result: null,
        })
        return () => {
          delete taskChannel.listener
        }
      }),
    }
    const ids = ['run-1', 'revision-1']
    const controller = createWorkflowController({
      store,
      generationApis,
      taskApis,
      createId: () => ids.shift() ?? 'unexpected-id',
      now: () => '2026-07-30T12:00:00.000Z',
    })

    const created = await controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      driver: 'ai',
      prompt: '像素骑士',
    })

    await controller.nextStep(created.id)

    const inFlight = store.get(created.id)
    expect(
      inFlight?.revisions[0].steps.find((step) => step.type === 'character-template'),
    ).toMatchObject({
      status: 'active',
      taskId: 'task-character-template-1',
    })

    const taskListener = taskChannel.listener
    if (!taskListener) throw new Error('expected the task subscription to be active')
    taskListener({
      taskId: 'task-character-template-1',
      type: 'character_template',
      status: 'completed',
      error: null,
      result: {
        type: 'character_template',
        images: [{ url: 'https://example.com/knight.png' }],
      },
    })
    await Promise.resolve()

    const completed = store.get(created.id)
    expect(
      completed?.revisions[0].steps.find((step) => step.type === 'character-template'),
    ).toMatchObject({
      status: 'passed',
      taskId: null,
      output: {
        type: 'character_template',
        images: [{ url: 'https://example.com/knight.png' }],
      },
    })
    expect(
      completed?.revisions[0].steps.find((step) => step.type === 'template-candidate'),
    ).toMatchObject({ status: 'active' })
  })
})
