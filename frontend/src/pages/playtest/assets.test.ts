import { describe, expect, it, vi } from 'vitest'

import type { Character } from '@/entities/character'

import { loadPlayableCharacters, toPlayableCharacter } from './assets'

const playableCharacter: Character = {
  id: 'character-1',
  projectId: 'project-1',
  createdAt: '',
  updatedAt: '',
  outfits: [
    {
      id: 'outfit-1',
      characterId: 'character-1',
      name: 'Explorer',
      candidateCharacterTemplates: [],
      characterTemplateUrl: null,
      baseFrames: [],
      actions: [
        {
          id: 'idle',
          outfitId: 'outfit-1',
          name: 'Idle',
          type: 'idle',
          fps: 8,
          keyFrameIndex: 0,
          frames: [
            {
              imageUrl: 'https://cdn.example.test/idle.png',
              durationMs: 125,
              rootMotion: null,
            },
          ],
        },
      ],
    },
  ],
}

describe('Playtest playable assets', () => {
  it('过滤零帧动作及其形成的空造型', () => {
    const empty = {
      ...playableCharacter,
      outfits: [
        {
          ...playableCharacter.outfits[0]!,
          actions: [{ ...playableCharacter.outfits[0]!.actions[0]!, frames: [] }],
        },
      ],
    }

    expect(toPlayableCharacter(empty)).toBeNull()
    expect(toPlayableCharacter(playableCharacter)?.outfits).toHaveLength(1)
  })

  it('从多个项目汇总可播放角色并去重', async () => {
    const result = await loadPlayableCharacters({
      projects: {
        list: vi.fn().mockResolvedValue({
          items: [{ id: 'project-1' }, { id: 'project-2' }],
          total: 2,
          page: 1,
          pageSize: 100,
        }),
      },
      characters: {
        listByProject: vi.fn().mockResolvedValue([playableCharacter]),
      },
    })

    expect(result.map((character) => character.id)).toEqual(['character-1'])
  })
})
