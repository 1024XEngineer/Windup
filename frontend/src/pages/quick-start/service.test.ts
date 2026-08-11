import { describe, expect, it, vi } from 'vitest'

import type { GenerationApis, WorkflowRun, WorkflowRunApis } from '@/entities'
import { createQuickStartService, type QuickStartFrame, type QuickStartService } from './service'

type QuickStartServiceWithFirstFrame = QuickStartService & {
  getFirstFrameCandidates(runId: string): Promise<readonly QuickStartFrame[]>
  confirmFirstFrame(runId: string, selectedImageUrl: string): Promise<WorkflowRun>
}

function createWorkflowRunApis(initialRuns: readonly WorkflowRun[] = []): WorkflowRunApis {
  let version = 0
  const runs = new Map(initialRuns.map((run) => [run.id, structuredClone(run)]))
  return {
    async create(input) {
      const run: WorkflowRun = {
        id: 'run-1',
        projectId: input.projectId,
        version: ++version,
        storageStatus: 'active',
        nodes: structuredClone(input.nodes),
      }
      runs.set(run.id, run)
      return structuredClone(run)
    },
    async listByProject(projectId) {
      const items = [...runs.values()].filter((run) => run.projectId === projectId)
      return { items: structuredClone(items), total: items.length, page: 1, pageSize: 100 }
    },
    async get(id) {
      const run = runs.get(id)
      if (!run) throw new Error('not found')
      return structuredClone(run)
    },
    async update(run) {
      const saved = { ...structuredClone(run), version: ++version }
      runs.set(saved.id, saved)
      return structuredClone(saved)
    },
    async remove(id) {
      runs.delete(id)
    },
  }
}

describe('createQuickStartService', () => {
  it('creates one persisted node graph and starts the character image task', async () => {
    const generationApis: GenerationApis = {
      create: vi.fn(async () => ({
        id: 'task-template',
        projectId: 'project-1',
        type: 'character_template' as const,
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      get: vi.fn(async () => ({
        id: 'task-template',
        projectId: 'project-1',
        type: 'character_template' as const,
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      subscribe: vi.fn(() => () => undefined),
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis(),
      generationApis,
      prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
    })

    const run = await service.start('像素骑士')

    expect(run.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'character-setup', status: 'passed' }),
        expect.objectContaining({
          type: 'character-template',
          phase: 'generating',
          generations: [{ taskId: 'task-template', role: 'character_template' }],
        }),
      ]),
    )
    expect(generationApis.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'character_template', spriteWidth: 256, spriteHeight: 256 }),
    )
  })

  it('confirms the action first frame and automatically starts a 32-frame animation', async () => {
    const firstFrameUrl = 'https://example.test/first-frame.png'
    const generationApis: GenerationApis = {
      create: vi.fn(async () => ({
        id: 'task-animation',
        projectId: 'project-1',
        type: 'complete_animation' as const,
        status: 'pending' as const,
        result: null,
        error: null,
      })),
      get: vi.fn(async (_projectId, id) => {
        if (id !== 'task-first-frame') throw new Error(`unexpected task: ${id}`)
        return {
          id,
          projectId: 'project-1',
          type: 'first_frame' as const,
          status: 'completed' as const,
          result: {
            type: 'first_frame' as const,
            image: { url: firstFrameUrl },
          },
          error: null,
        }
      }),
      subscribe: vi.fn(() => () => undefined),
    }
    const run: WorkflowRun = {
      id: 'run-1',
      projectId: 'project-1',
      version: 1,
      storageStatus: 'active',
      nodes: [
        {
          id: 'character-setup',
          type: 'character-setup',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: [],
          generations: [],
          error: null,
          input: { characterId: 'character-1', prompt: '像素骑士', referenceMedia: [] },
        },
        {
          id: 'character-template',
          type: 'character-template',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['character-setup'],
          generations: [{ taskId: 'task-template', role: 'character_template' }],
          error: null,
          selectedImageUrl: 'https://example.test/template.png',
        },
        {
          id: 'action-walk',
          type: 'action-first-frame',
          status: 'active',
          phase: 'selecting',
          dependsOnNodeIds: ['character-template'],
          generations: [{ taskId: 'task-first-frame', role: 'first_frame' }],
          error: null,
          input: {
            outfitId: 'outfit-1',
            name: '行走',
            type: 'custom',
            prompt: '向右行走',
            fps: 12,
          },
          selectedFirstFrameUrl: null,
        },
        {
          id: 'action-walk:action-generation-method',
          type: 'action-generation-method',
          status: 'locked',
          phase: 'selecting',
          dependsOnNodeIds: ['action-walk'],
          generations: [],
          error: null,
          method: null,
        },
        {
          id: 'action-walk:action-full-frame',
          type: 'action-full-frame',
          status: 'locked',
          phase: 'ready',
          dependsOnNodeIds: ['action-walk:action-generation-method'],
          generations: [],
          error: null,
        },
        {
          id: 'action-walk:review',
          type: 'review',
          status: 'locked',
          phase: 'reviewing',
          dependsOnNodeIds: ['action-walk:action-full-frame'],
          generations: [],
          error: null,
        },
      ],
    }
    const service = createQuickStartService({
      workflowRunApis: createWorkflowRunApis([run]),
      generationApis,
      prepareProject: async () => ({ id: 'project-1', spriteSize: { width: 256, height: 256 } }),
    }) as QuickStartServiceWithFirstFrame

    await expect(service.getFirstFrameCandidates('run-1')).resolves.toEqual([
      { index: 0, imageUrl: firstFrameUrl, durationMs: null },
    ])
    await service.confirmFirstFrame('run-1', firstFrameUrl)

    await vi.waitFor(() => {
      expect(generationApis.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete_animation',
          characterId: 'character-1',
          outfitId: 'outfit-1',
          firstFrameUrl,
        }),
      )
    })
  })
})
