import { describe, expect, it, vi } from 'vitest'

import type {
  Character,
  CharacterApis,
  Generation,
  GenerationApis,
  GenerationEvent,
  Project,
  ProjectApis,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import { createQuickStartService } from './service'

describe('createQuickStartService', () => {
  it('用同一条六节点 WorkflowRun 自动生成，并在审核后写回 Character', async () => {
    const project: Project = {
      id: '1',
      ownerId: '7',
      workflowId: null,
      name: '像素信使',
      perspective: 'side',
      directionalMovement: 'single',
      spriteSize: { width: 256, height: 256 },
      gameStyle: null,
      sampleImageUrl: null,
      createdAt: '2026-08-08T00:00:00Z',
      updatedAt: '2026-08-08T00:00:00Z',
    }
    let character: Character = {
      id: '8',
      projectId: project.id,
      name: '像素信使',
      description: '像素信使',
      referenceImageUrl: null,
      dataVersion: 1,
      status: 1,
      outfits: [],
    }
    let workflow: WorkflowRun = {
      id: '9',
      projectId: project.id,
      version: 0,
      storageStatus: 'active',
      nodes: [],
    }
    const listeners = new Map<string, (event: GenerationEvent) => void>()
    const generations = new Map<string, Generation>()
    let generationSequence = 0
    const projectApis: ProjectApis = {
      list: vi.fn(async () => ({ items: [project], page: 1, pageSize: 20, total: 1 })),
      get: vi.fn(async () => structuredClone(project)),
      create: vi.fn(async () => structuredClone(project)),
      remove: vi.fn(async () => undefined),
    }
    const characterApis: CharacterApis = {
      get: vi.fn(async () => structuredClone(character)),
      listByProject: vi.fn(async () => ({
        items: [structuredClone(character)],
        page: 1,
        pageSize: 100,
        total: 1,
      })),
      create: vi.fn(async () => structuredClone(character)),
      update: vi.fn(async (next) => {
        character = structuredClone(next)
        return structuredClone(character)
      }),
      remove: vi.fn(async () => undefined),
    }
    const workflowRunApis: WorkflowRunApis = {
      create: vi.fn(async (input) => {
        workflow = {
          id: '9',
          projectId: input.projectId,
          version: 1,
          storageStatus: 'active',
          nodes: structuredClone(input.nodes),
        }
        return structuredClone(workflow)
      }),
      get: vi.fn(async () => structuredClone(workflow)),
      update: vi.fn(async (next) => {
        workflow = { ...structuredClone(next), version: next.version + 1 }
        return structuredClone(workflow)
      }),
      remove: vi.fn(async () => undefined),
    }
    const generationApis: GenerationApis = {
      create: vi.fn(async (input) => {
        const generation: Generation = {
          id: `task-${++generationSequence}`,
          projectId: input.projectId,
          type: input.type,
          status: 'pending',
          result: null,
          error: null,
        }
        generations.set(generation.id, generation)
        return structuredClone(generation)
      }) as GenerationApis['create'],
      get: vi.fn(async (_projectId, id) => structuredClone(generations.get(id)!)),
      subscribe: vi.fn((_projectId, id, listener) => {
        listeners.set(id, listener)
        return () => listeners.delete(id)
      }),
    }
    let idSequence = 0
    const service = createQuickStartService({
      projectApis,
      characterApis,
      workflowRunApis,
      generationApis,
      createId: () => `local-${++idSequence}`,
    })

    const started = await service.start({ prompt: '像素信使', actionDescription: '向前奔跑' })
    expect(started).toEqual({ runId: '9' })
    await vi.waitFor(() => expect(generationApis.create).toHaveBeenCalledTimes(1))
    expect(workflow?.nodes).toHaveLength(6)
    expect(character.outfits).toHaveLength(1)

    emit({
      taskId: 'task-1',
      type: 'character_template',
      status: 'completed',
      result: { type: 'character_template', images: [{ url: 'template.png' }] },
      error: null,
    })
    await vi.waitFor(() => expect(generationApis.create).toHaveBeenCalledTimes(2))
    expect(character.referenceImageUrl).toBe('template.png')

    emit({
      taskId: 'task-2',
      type: 'first_frame',
      status: 'completed',
      result: { type: 'first_frame', image: { url: 'first.png' } },
      error: null,
    })
    await vi.waitFor(() => expect(generationApis.create).toHaveBeenCalledTimes(3))
    const frames = Array.from({ length: 32 }, (_, index) => ({
      url: `frame-${index}.png`,
      durationMs: index === 0 ? 120 : null,
    }))
    emit({
      taskId: 'task-3',
      type: 'complete_animation',
      status: 'completed',
      result: { type: 'complete_animation', frames },
      error: null,
    })
    await vi.waitFor(async () => expect((await service.load('9'))?.status).toBe('review'))

    expect(await service.approve('9')).toEqual({ characterId: '8', outfitId: 'local-1' })
    expect(character.outfits[0]?.actions[0]?.frames).toHaveLength(32)
    expect(character.outfits[0]?.actions[0]?.frames[0]?.durationMs).toBe(120)
    expect((await service.load('9'))?.status).toBe('completed')

    function emit(event: GenerationEvent) {
      generations.set(event.taskId, {
        id: event.taskId,
        projectId: project.id,
        type: event.type,
        status: event.status,
        result: event.result,
        error: event.error,
      })
      listeners.get(event.taskId)?.(event)
    }
  })
})
