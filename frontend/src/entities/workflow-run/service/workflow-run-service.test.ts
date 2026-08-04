/** WorkflowRun Service 的真实用例链测试，不用伪造的页面成功状态代替端口结果。 */

import { describe, expect, it, vi } from 'vitest'

import type { Character, CharacterApis } from '../../character'
import type { Generation, GenerationApis, GenerationInput } from '../../generation'
import { createWorkflowRunStore } from '../store'
import {
  createWorkflowRunService,
  type CharacterCandidateConfirmationApis,
} from './workflow-run-service'

function createCharacter(): Character {
  return {
    id: 'character-1',
    projectId: 'project-1',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    outfits: [
      {
        id: 'outfit-1',
        characterId: 'character-1',
        name: '默认造型',
        candidateCharacterTemplates: [],
        characterTemplateUrl: 'candidate-2.png',
        baseFrames: [],
        actions: [],
      },
    ],
  }
}

function createGenerationApis() {
  const tasks = new Map<string, Generation>()
  let nextId = 0
  const create = vi.fn(async (input: GenerationInput): Promise<Generation> => {
    const id = `generation-${++nextId}`
    const result =
      input.type === 'character_template'
        ? {
            type: 'character_template' as const,
            images: [1, 2, 3, 4].map((index) => ({ url: `candidate-${index}.png` })),
          }
        : input.type === 'first_frame'
          ? { type: 'first_frame' as const, image: { url: `first-frame-${id}.png` } }
          : {
              type: 'complete_animation' as const,
              frames: [{ url: 'frame-1.png' }, { url: 'frame-2.png' }],
            }
    const task: Generation = {
      id,
      projectId: input.projectId,
      type: input.type,
      status: 'completed',
      result,
      error: null,
    }
    tasks.set(id, task)
    return task
  })
  const apis: GenerationApis = {
    create,
    async get(_projectId, id) {
      const task = tasks.get(id)
      if (!task) throw new Error('任务不存在')
      return task
    },
    subscribe() {
      return () => undefined
    },
  }
  return { apis, create, tasks }
}

function createService() {
  let id = 0
  let timestamp = 0
  const store = createWorkflowRunStore({
    storage: null,
    createId: () => `workflow-id-${++id}`,
    now: () => `2026-08-03T00:00:${String(++timestamp).padStart(2, '0')}.000Z`,
  })
  const generation = createGenerationApis()
  let character = createCharacter()
  const characterApis: CharacterApis = {
    get: vi.fn(async () => {
      return structuredClone(character)
    }),
    async listByProject() {
      return [structuredClone(character)]
    },
    async create() {
      return structuredClone(character)
    },
    update: vi.fn(async (next: Character) => {
      character = structuredClone(next)
      return structuredClone(character)
    }),
  }
  const confirmSelection = vi.fn(async () => ({
    character: structuredClone(character),
    outfitId: 'outfit-1',
  }))
  const candidateConfirmationApis: CharacterCandidateConfirmationApis = { confirmSelection }
  const service = createWorkflowRunService({
    store,
    generationApis: generation.apis,
    characterApis,
    candidateConfirmationApis,
    now: () => `2026-08-03T01:00:${String(++timestamp).padStart(2, '0')}.000Z`,
  })
  return { service, store, generation, characterApis, confirmSelection }
}

describe('createWorkflowRunService', () => {
  it('runs character selection and action publishing as two linked user tasks', async () => {
    const { service, store, generation, characterApis, confirmSelection } = createService()

    const candidates = await service.startCharacter({
      projectId: 'project-1',
      prompt: '一位像素风守夜人',
      driver: 'ai',
    })

    expect(candidates.candidates).toEqual([
      'candidate-1.png',
      'candidate-2.png',
      'candidate-3.png',
      'candidate-4.png',
    ])
    expect(candidates.run.purpose).toBe('create_character')
    expect(
      candidates.run.revisions[0]?.steps.find((step) => step.type === 'template-candidate')?.status,
    ).toBe('active')
    expect(JSON.stringify(store.get(candidates.run.id))).not.toContain('candidate-1.png')

    const characterRun = await service.confirmCharacter({
      runId: candidates.run.id,
      selectedImageUrl: 'candidate-2.png',
    })
    expect(characterRun).toMatchObject({
      purpose: 'create_character',
      status: 'completed',
      characterId: 'character-1',
      outfitId: 'outfit-1',
    })
    expect(confirmSelection).toHaveBeenCalledWith({
      projectId: 'project-1',
      generationId: 'generation-1',
      selectedImageUrl: 'candidate-2.png',
      description: '一位像素风守夜人',
    })

    const firstFrames = await service.startAction({
      projectId: 'project-1',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionName: '向前行走',
      actionType: 'walk',
      prompt: '轻快地向前行走',
      fps: 12,
      driver: 'ai',
    })

    expect(firstFrames.run.id).not.toBe(characterRun.id)
    expect(firstFrames.run.purpose).toBe('add_action')
    expect(firstFrames.candidates).toEqual([
      'first-frame-generation-2.png',
      'first-frame-generation-3.png',
      'first-frame-generation-4.png',
      'first-frame-generation-5.png',
    ])
    expect(
      firstFrames.run.revisions[0]?.steps.find((step) => step.type === 'first-frame-candidate')
        ?.status,
    ).toBe('active')
    expect(JSON.stringify(store.get(firstFrames.run.id))).not.toContain('first-frame-generation')
    expect(generation.create).toHaveBeenCalledTimes(5)

    const actionRun = await service.confirmActionFirstFrame({
      runId: firstFrames.run.id,
      selectedImageUrl: firstFrames.candidates[1]!,
    })
    expect(actionRun.revisions[0]?.steps.find((step) => step.type === 'review')?.status).toBe(
      'active',
    )
    expect(generation.create).toHaveBeenCalledTimes(6)

    const review = await service.getActionReview(actionRun.id)
    expect(review).toEqual({
      run: actionRun,
      generationId: 'generation-6',
      frames: [{ imageUrl: 'frame-1.png' }, { imageUrl: 'frame-2.png' }],
    })
    expect(store.get(actionRun.id)).toEqual(actionRun)

    const published = await service.approveAction(actionRun.id)
    expect(published.run.status).toBe('completed')
    expect(published.actionId).toBe(actionRun.actionId)
    expect(published.character.outfits[0]?.actions[0]).toMatchObject({
      id: actionRun.actionId,
      name: '向前行走',
      type: 'walk',
      fps: 12,
    })
    expect(published.character.outfits[0]?.actions[0]?.frames).toHaveLength(2)
    expect(characterApis.update).toHaveBeenCalledTimes(1)
  })

  it('rejects a candidate that was not returned by the current generation task', async () => {
    const { service, confirmSelection } = createService()
    const batch = await service.startCharacter({
      projectId: 'project-1',
      prompt: '角色',
      driver: 'manual',
    })

    await expect(
      service.confirmCharacter({ runId: batch.run.id, selectedImageUrl: 'foreign.png' }),
    ).rejects.toThrow('选中图片不属于当前角色生成任务')
    expect(confirmSelection).not.toHaveBeenCalled()
  })

  it('does not complete the character run when backend confirmation fails', async () => {
    const fixture = createService()
    fixture.confirmSelection.mockRejectedValueOnce(new Error('后端候选确认失败'))
    const batch = await fixture.service.startCharacter({
      projectId: 'project-1',
      prompt: '角色',
      driver: 'ai',
    })

    await expect(
      fixture.service.confirmCharacter({
        runId: batch.run.id,
        selectedImageUrl: 'candidate-1.png',
      }),
    ).rejects.toThrow('后端候选确认失败')
    expect(fixture.store.get(batch.run.id)?.status).toBe('active')
  })

  it('interrupts an active run and continues it without changing the active step', async () => {
    const { service, store } = createService()
    const batch = await service.startCharacter({
      projectId: 'project-1',
      prompt: '角色',
      driver: 'ai',
    })
    const activeStepId = batch.run.revisions[0]?.steps.find((step) => step.status === 'active')?.id

    const interrupted = service.interruptRun(batch.run.id)
    expect(interrupted.status).toBe('interrupted')
    expect(interrupted.revisions[0]?.steps.find((step) => step.status === 'active')?.id).toBe(
      activeStepId,
    )
    expect(store.get(batch.run.id)?.status).toBe('interrupted')

    const resumed = service.continueRun(batch.run.id)
    expect(resumed.status).toBe('active')
    expect(resumed.revisions[0]?.steps.find((step) => step.status === 'active')?.id).toBe(
      activeStepId,
    )
    expect(store.get(batch.run.id)?.status).toBe('active')
  })

  it('restores two persisted first-frame candidates and only creates the two missing tasks', async () => {
    const { service, store, generation } = createService()
    const run = store.create({
      projectId: 'project-1',
      purpose: 'add_action',
      driver: 'ai',
      prompt: '向前行走',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionName: '行走',
      actionType: 'walk',
      fps: 12,
    })
    const restored = structuredClone(run)
    const revision = restored.revisions[0]!
    revision.steps[0]!.status = 'passed'
    revision.steps[1]!.status = 'active'
    revision.steps[1]!.candidateTaskIds = ['persisted-first-frame-1', 'persisted-first-frame-2']
    revision.generationStatus = 'in_progress'
    store.save(restored)
    for (const index of [1, 2]) {
      generation.tasks.set(`persisted-first-frame-${index}`, {
        id: `persisted-first-frame-${index}`,
        projectId: 'project-1',
        type: 'first_frame',
        status: 'completed',
        result: { type: 'first_frame', image: { url: `restored-first-frame-${index}.png` } },
        error: null,
      })
    }

    const resumed = await service.resumeActionFirstFrameCandidates(run.id)

    expect(generation.create).toHaveBeenCalledTimes(2)
    expect(resumed.candidates).toHaveLength(4)
    expect(resumed.candidates.slice(0, 2)).toEqual([
      'restored-first-frame-1.png',
      'restored-first-frame-2.png',
    ])
    expect(resumed.run.revisions[0]?.steps[2]?.type).toBe('first-frame-candidate')
    expect(resumed.run.revisions[0]?.steps[2]?.status).toBe('active')
  })

  it('restores an action already in review without rerunning generation', async () => {
    const { service, generation, characterApis } = createService()
    const firstFrames = await service.startAction({
      projectId: 'project-1',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionName: '行走',
      actionType: 'walk',
      fps: 12,
      driver: 'ai',
    })
    const actionRun = await service.confirmActionFirstFrame({
      runId: firstFrames.run.id,
      selectedImageUrl: firstFrames.candidates[0]!,
    })
    expect(generation.create).toHaveBeenCalledTimes(5)
    expect(characterApis.get).toHaveBeenCalledTimes(2)

    const resumed = await service.resumeAction(actionRun.id)
    const review = await service.getActionReview(actionRun.id)

    expect(resumed).toEqual(actionRun)
    expect(review.frames).toEqual([{ imageUrl: 'frame-1.png' }, { imageUrl: 'frame-2.png' }])
    expect(generation.create).toHaveBeenCalledTimes(5)
    expect(characterApis.get).toHaveBeenCalledTimes(2)
  })

  it('does not expose animation frames before the action reaches review', async () => {
    const { service } = createService()
    const firstFrames = await service.startAction({
      projectId: 'project-1',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionName: '行走',
      actionType: 'walk',
      fps: 12,
      driver: 'ai',
    })

    await expect(service.getActionReview(firstFrames.run.id)).rejects.toThrow(
      '动作尚未进入可审核状态',
    )
  })

  it('rejects a first-frame image that is not one of the four current candidates', async () => {
    const { service, generation } = createService()
    const firstFrames = await service.startAction({
      projectId: 'project-1',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionName: '行走',
      actionType: 'walk',
      fps: 12,
      driver: 'ai',
    })

    await expect(
      service.confirmActionFirstFrame({
        runId: firstFrames.run.id,
        selectedImageUrl: 'foreign-first-frame.png',
      }),
    ).rejects.toThrow('选中图片不属于当前动作首帧任务')
    expect(generation.create).toHaveBeenCalledTimes(4)
  })
})
