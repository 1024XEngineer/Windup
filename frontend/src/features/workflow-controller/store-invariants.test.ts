import { describe, expect, it, vi } from 'vitest'

import type { Generation, GenerationApis, GenerationInput } from '@/entities'
import { createWorkflowRunStore } from '@/entities/workflow-run/store'
import { createWorkflowController } from '.'

function createHarness() {
  const store = createWorkflowRunStore()
  const generationApis: GenerationApis = {
    create: vi.fn(
      async <T extends GenerationInput>(input: T) =>
        ({
          id: 'task-1',
          projectId: input.projectId,
          type: input.type,
          status: 'pending',
          result: null,
          error: null,
        }) as Generation<T['type']>,
    ),
    get: vi.fn(async () => {
      throw new Error('not used')
    }),
    subscribe: vi.fn(() => () => undefined),
  }
  return {
    store,
    controller: createWorkflowController({
      store,
      generationApis,
      now: () => '2026-07-31T12:00:00.000Z',
    }),
  }
}

describe('workflow persistence invariants', () => {
  it('persists a complete frontend node graph immediately after creation', async () => {
    const { controller, store } = createHarness()
    const created = await controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      prompt: '像素骑士',
    })

    const restored = await store.get(created.id)
    expect(restored?.nodes).toHaveLength(6)
    expect(restored?.nodes.filter((node) => node.status === 'active')).toHaveLength(1)
  })

  it('persists the existing character references for add_action', async () => {
    const { controller, store } = createHarness()
    const created = await controller.create({
      projectId: 'project-1',
      purpose: 'add_action',
      prompt: '挥手',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      characterTemplateUrl: 'template.png',
      baseFrameUrls: [],
    })

    const restored = await store.get(created.id)
    expect(restored).toMatchObject({
      characterId: 'character-1',
      outfitId: 'outfit-1',
    })
    expect(restored?.nodes.find((node) => node.type === 'action-first-frame')?.status).toBe(
      'active',
    )
    expect(restored?.nodes.find((node) => node.type === 'action-generation-method')?.status).toBe(
      'locked',
    )
  })

  it('persists interruption without clearing the active node', async () => {
    const { controller, store } = createHarness()
    const created = await controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
    })
    await controller.interrupt(created.id)

    const restored = await store.get(created.id)
    expect(restored?.status).toBe('interrupted')
    expect(restored?.nodes.filter((node) => node.status === 'active')).toHaveLength(1)
  })
})
