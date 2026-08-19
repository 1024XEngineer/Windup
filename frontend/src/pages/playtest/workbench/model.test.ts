import { describe, expect, it } from 'vitest'

import type { Character } from '@/entities'

import { createPlaytestModel } from './model'

const character: Character = {
  id: '51',
  projectId: '42',
  workflowRunId: 'workflow-run-51',
  name: '轻装信使',
  description: null,
  referenceImageUrl: null,
  dataVersion: 1,
  status: 1,
  outfits: [
    {
      id: 'outfit-default',
      characterId: '51',
      name: '常态造型',
      description: null,
      previewUrl: null,
      actions: [
        {
          id: 'idle',
          outfitId: 'outfit-default',
          name: '待机',
          type: 'idle',
          loop: true,
          fps: 8,
          frameCount: 1,
          frames: [{ index: 0, imageUrl: '/idle-01.png', durationMs: null }],
        },
        {
          id: 'walk',
          outfitId: 'outfit-default',
          name: '行走',
          type: 'walk',
          loop: true,
          fps: 10,
          frameCount: 3,
          frames: [
            { index: 2, imageUrl: '/walk-03.png', durationMs: 100 },
            { index: 0, imageUrl: '/walk-01.png', durationMs: 100 },
            { index: 1, imageUrl: '/walk-02.png', durationMs: 100 },
          ],
        },
      ],
    },
  ],
}

describe('createPlaytestModel', () => {
  it('keeps only the fields needed to control and render an action', () => {
    const result = createPlaytestModel(character, 'outfit-default')

    expect(result.ok && result.model.characterId).toBe('51')
    expect(result.ok && result.model.outfitName).toBe('常态造型')
    expect(result.ok && result.model.actions[0]).toEqual({
      id: 'idle',
      name: '待机',
      type: 'idle',
      loop: true,
      // durationMs 为 null 时按所属动作的 fps 换算，不用前端常量顶上。
      frames: [{ imageUrl: '/idle-01.png', durationMs: 125 }],
      sequences: {
        east: {
          frames: [{ imageUrl: '/idle-01.png', durationMs: 125 }],
          mirrorX: false,
          sourceDirection: 'east',
        },
        west: {
          frames: [{ imageUrl: '/idle-01.png', durationMs: 125 }],
          mirrorX: true,
          sourceDirection: 'east',
        },
      },
    })
  })

  it('orders frames by the backend index instead of array position', () => {
    const result = createPlaytestModel(character, 'outfit-default')

    expect(result.ok && result.model.actions[1]?.frames.map((frame) => frame.imageUrl)).toEqual([
      '/walk-01.png',
      '/walk-02.png',
      '/walk-03.png',
    ])
  })

  it('resolves real and mirrored eight-way sequences without copying stored frames', () => {
    const directionalCharacter = structuredClone(character)
    directionalCharacter.outfits[0]!.actions[1]!.sequences = [
      {
        direction: 'east',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 2,
        frames: [
          { index: 1, imageUrl: '/walk-east-02.png', durationMs: 90 },
          { index: 0, imageUrl: '/walk-east-01.png', durationMs: 90 },
        ],
      },
      {
        direction: 'west',
        sourceDirection: 'east',
        mirrorX: true,
        frameCount: 2,
        frames: [],
      },
      {
        direction: 'north_east',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: '/walk-north-east-01.png', durationMs: 110 }],
      },
      {
        direction: 'north_west',
        sourceDirection: 'north_east',
        mirrorX: true,
        frameCount: 1,
        frames: [],
      },
    ]

    const result = createPlaytestModel(directionalCharacter, 'outfit-default')
    const walk = result.ok ? result.model.actions.find((action) => action.id === 'walk') : undefined

    expect(walk?.sequences?.east).toEqual({
      frames: [
        { imageUrl: '/walk-east-01.png', durationMs: 90 },
        { imageUrl: '/walk-east-02.png', durationMs: 90 },
      ],
      mirrorX: false,
      sourceDirection: 'east',
    })
    expect(walk?.sequences?.west).toEqual({
      frames: [
        { imageUrl: '/walk-east-01.png', durationMs: 90 },
        { imageUrl: '/walk-east-02.png', durationMs: 90 },
      ],
      mirrorX: true,
      sourceDirection: 'east',
    })
    expect(walk?.sequences?.north_west).toEqual({
      frames: [{ imageUrl: '/walk-north-east-01.png', durationMs: 110 }],
      mirrorX: true,
      sourceDirection: 'north_east',
    })
  })

  it('treats legacy top-level frames as east and derives west', () => {
    const result = createPlaytestModel(character, 'outfit-default')
    const walk = result.ok ? result.model.actions.find((action) => action.id === 'walk') : undefined

    expect(walk?.sequences?.east?.frames.map((frame) => frame.imageUrl)).toEqual([
      '/walk-01.png',
      '/walk-02.png',
      '/walk-03.png',
    ])
    expect(walk?.sequences?.west).toMatchObject({ mirrorX: true, sourceDirection: 'east' })
  })

  it('drops actions that have no frames to play', () => {
    const withEmptyAction = structuredClone(character)
    withEmptyAction.outfits[0]!.actions[1]!.frames = []

    const result = createPlaytestModel(withEmptyAction, 'outfit-default')

    expect(result.ok && result.model.actions.map((action) => action.id)).toEqual(['idle'])
  })

  it('rejects a missing outfit instead of falling back to another one', () => {
    expect(createPlaytestModel(character, 'missing')).toEqual({
      ok: false,
      reason: 'outfit_not_found',
    })
  })

  it('clamps an unusably short frame duration before it reaches the animation loop', () => {
    const tinyDurationCharacter = structuredClone(character)
    tinyDurationCharacter.outfits[0]!.actions[0]!.frames[0]!.durationMs = 0.001

    const result = createPlaytestModel(tinyDurationCharacter, 'outfit-default')

    expect(result.ok && result.model.actions[0]?.frames[0]?.durationMs).toBe(1)
  })

  it('keeps a north-only sequence out of the legacy side-frame field', () => {
    const directionalCharacter = structuredClone(character)
    const idle = directionalCharacter.outfits[0]!.actions[0]!
    idle.frames = []
    idle.fps = 0
    idle.sequences = [
      {
        direction: 'north',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: '/idle-north.png', durationMs: null }],
      },
    ]

    const result = createPlaytestModel(directionalCharacter, 'outfit-default')
    const mappedIdle = result.ok
      ? result.model.actions.find((action) => action.id === 'idle')
      : undefined

    expect(mappedIdle?.frames).toEqual([])
    expect(mappedIdle?.sequences?.north?.frames).toEqual([
      { imageUrl: '/idle-north.png', durationMs: 100 },
    ])
  })

  it('does not invent playback for empty sources or mirrors whose source is missing', () => {
    const malformed = structuredClone(character)
    const idle = malformed.outfits[0]!.actions[0]!
    idle.sequences = [
      {
        direction: 'north',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 0,
        frames: [],
      },
    ]
    const walk = malformed.outfits[0]!.actions[1]!
    walk.frames = []
    walk.sequences = [
      {
        direction: 'west',
        sourceDirection: 'east',
        mirrorX: true,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: '/invalid-derived-frame.png', durationMs: 100 }],
      },
    ]

    const result = createPlaytestModel(malformed, 'outfit-default')
    const mappedWalk = result.ok
      ? result.model.actions.find((action) => action.id === 'walk')
      : undefined

    expect(mappedWalk?.sequences).toEqual({})
    expect(mappedWalk?.frames).toEqual([])
  })
})
