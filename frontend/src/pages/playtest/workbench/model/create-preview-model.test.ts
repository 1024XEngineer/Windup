import { describe, expect, it } from 'vitest'

import type { Character } from '../../../../entities'
import { createPreviewModel } from './create-preview-model'

const character: Character = {
  id: 'character-1',
  projectId: 'project-1',
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  outfits: [
    {
      id: 'outfit-1',
      characterId: 'character-1',
      name: 'Explorer',
      candidateCharacterTemplates: [],
      characterTemplateUrl: 'https://cdn.example.test/aster.png',
      baseFrames: [
        { imageUrl: 'https://cdn.example.test/base-1.png' },
        { imageUrl: 'https://cdn.example.test/base-2.png' },
      ],
      actions: [
        {
          id: 'walk',
          outfitId: 'outfit-1',
          name: 'Walk',
          kind: 'preset',
          type: 'walk',
          fps: 5,
          keyFrameIndex: 1,
          frames: [
            {
              imageUrl: 'https://cdn.example.test/walk-0.png',
              durationMs: 125,
              rootMotion: { dx: 2, dy: 0 },
            },
            {
              imageUrl: 'https://cdn.example.test/walk-1.png',
              durationMs: null,
              rootMotion: { dx: 5, dy: 1 },
            },
            {
              imageUrl: 'https://cdn.example.test/walk-2.png',
              durationMs: null,
              rootMotion: null,
            },
          ],
        },
        {
          id: 'idle',
          outfitId: 'outfit-1',
          name: 'Idle',
          kind: 'custom',
          type: 'idle',
          fps: 0,
          keyFrameIndex: 0,
          frames: [
            {
              imageUrl: 'https://cdn.example.test/idle-0.png',
              durationMs: null,
              rootMotion: null,
            },
          ],
        },
      ],
    },
  ],
}

describe('createPreviewModel', () => {
  it('reports a missing outfit without constructing a preview model', () => {
    expect(createPreviewModel(character, 'missing-outfit')).toEqual({
      ok: false,
      reason: 'outfit_not_found',
    })
  })

  it('maps the standard skeleton single-frame list to one default preview direction', () => {
    const result = createPreviewModel(character, 'outfit-1')
    if (!result.ok) throw new Error('expected preview model')

    expect(result.model.actions.map((action) => action.id)).toEqual(['walk', 'idle'])
    expect(result.model.actions[0].sequences.map((sequence) => sequence.direction)).toEqual([
      'default',
    ])
    expect(result.model).toMatchObject({
      characterId: 'character-1',
      characterName: 'character-1',
      outfitId: 'outfit-1',
      outfitName: 'Explorer',
      characterTemplateUrl: 'https://cdn.example.test/aster.png',
      baseFrameCount: 2,
    })
  })

  it('uses frame duration before fps fallback and maps the action key frame', () => {
    const result = createPreviewModel(character, 'outfit-1')
    if (!result.ok) throw new Error('expected preview model')

    const frames = result.model.actions[0].sequences[0].frames
    expect(frames.map((frame) => frame.durationMs)).toEqual([125, 200, 200])
    expect(frames.map((frame) => frame.keyFrame)).toEqual([false, true, false])
  })

  it('converts absolute-from-first root motion into playback increments', () => {
    const result = createPreviewModel(character, 'outfit-1')
    if (!result.ok) throw new Error('expected preview model')

    expect(result.model.actions[0].sequences[0].frames.map((frame) => frame.rootMotion)).toEqual([
      { dx: 2, dy: 0 },
      { dx: 3, dy: 1 },
      null,
    ])
  })

  it('uses a safe display fallback for invalid fps without mutating the character', () => {
    const before = JSON.stringify(character)
    const result = createPreviewModel(character, 'outfit-1')
    if (!result.ok) throw new Error('expected preview model')

    expect(result.model.actions[1].sequences[0].frames[0].durationMs).toBe(100)
    expect(JSON.stringify(character)).toBe(before)
  })
})
