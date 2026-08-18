import { describe, expect, it, vi } from 'vitest'

import type { Character, CharacterApis, WorkflowRunApis } from '@/entities'
import { createExistingCharacterActionRun } from './existing-character-action'

const character: Character = {
  id: '51',
  projectId: '42',
  workflowRunId: 'original-run',
  name: '轻装信使',
  description: '戴兜帽的像素信使',
  referenceImageUrl: '/reference.png',
  dataVersion: 1,
  status: 1,
  outfits: [
    {
      id: 'outfit-default',
      characterId: '51',
      name: '常态造型',
      description: null,
      previewUrl: '/master.png',
      actions: [],
    },
  ],
}

describe('createExistingCharacterActionRun', () => {
  it('creates a new run with the existing character and outfit template already completed', async () => {
    const create = vi.fn(async (input) => ({
      id: 'new-run',
      projectId: input.projectId,
      version: 1,
      storageStatus: 'active' as const,
      nodes: input.nodes,
    }))

    const result = await createExistingCharacterActionRun(
      { characterId: '51', outfitId: 'outfit-default' },
      {
        characterApis: { get: vi.fn(async () => character) } as Pick<CharacterApis, 'get'>,
        workflowRunApis: { create } as Pick<WorkflowRunApis, 'create'>,
      },
    )

    expect(result.run.id).toBe('new-run')
    expect(create).toHaveBeenCalledWith({
      projectId: '42',
      nodes: [
        expect.objectContaining({
          type: 'character-setup',
          status: 'passed',
          input: expect.objectContaining({ characterId: '51' }),
        }),
        expect.objectContaining({
          type: 'character-template',
          status: 'passed',
          selectedImageUrl: '/master.png',
        }),
      ],
    })
  })

  it('refuses to guess another outfit or template', async () => {
    const dependencies = {
      characterApis: { get: vi.fn(async () => character) } as Pick<CharacterApis, 'get'>,
      workflowRunApis: { create: vi.fn() } as Pick<WorkflowRunApis, 'create'>,
    }

    await expect(
      createExistingCharacterActionRun({ characterId: '51', outfitId: 'missing' }, dependencies),
    ).rejects.toThrow('当前造型没有可用于生成动作的角色母版')
    expect(dependencies.workflowRunApis.create).not.toHaveBeenCalled()
  })
})
