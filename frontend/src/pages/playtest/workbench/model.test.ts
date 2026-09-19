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
      model3dUrl: null,
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

  it('keeps a locomotion cycle stable when the same motion has more sampled frames', () => {
    const denseCharacter = structuredClone(character)
    const walk = denseCharacter.outfits[0]!.actions[1]!
    const denseFrames = Array.from({ length: 32 }, (_, index) => ({
      index,
      imageUrl: `/walk-${index}.png`,
      durationMs: 125,
    }))
    walk.frameCount = 32
    walk.frames = denseFrames
    walk.sequences = [
      {
        direction: 'north',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 32,
        frames: denseFrames,
      },
    ]

    const result = createPlaytestModel(denseCharacter, 'outfit-default')
    const mappedWalk = result.ok
      ? result.model.actions.find((action) => action.id === 'walk')
      : undefined

    expect(mappedWalk?.frames).toHaveLength(32)
    expect(mappedWalk?.frames.reduce((total, frame) => total + frame.durationMs, 0)).toBe(1000)
    expect(
      mappedWalk?.sequences?.north?.frames.reduce((total, frame) => total + frame.durationMs, 0),
    ).toBe(1000)
    expect(mappedWalk?.sequences?.west).toMatchObject({
      mirrorX: true,
      sourceDirection: 'east',
    })
    expect(mappedWalk?.sequences?.west?.frames).toBe(mappedWalk?.sequences?.east?.frames)
  })

  it('normalizes the known 32-frame run output to its denser cycle', () => {
    const denseCharacter = structuredClone(character)
    const run = denseCharacter.outfits[0]!.actions[1]!
    run.type = 'run'
    run.frameCount = 32
    run.frames = Array.from({ length: 32 }, (_, index) => ({
      index,
      imageUrl: `/run-${index}.png`,
      durationMs: 90,
    }))

    const result = createPlaytestModel(denseCharacter, 'outfit-default')
    const mappedRun = result.ok
      ? result.model.actions.find((action) => action.id === 'walk')
      : undefined

    expect(mappedRun?.frames.reduce((total, frame) => total + frame.durationMs, 0)).toBe(720)
  })

  it('does not reinterpret other frame counts or already-correct dense timing', () => {
    const variants = [
      {
        frameCount: 16,
        durationMs: 125,
        expectedCycleMs: 2000,
      },
      {
        frameCount: 32,
        durationMs: 31.25,
        expectedCycleMs: 1000,
      },
    ]

    for (const variant of variants) {
      const variantCharacter = structuredClone(character)
      const walk = variantCharacter.outfits[0]!.actions[1]!
      walk.frameCount = variant.frameCount
      walk.frames = Array.from({ length: variant.frameCount }, (_, index) => ({
        index,
        imageUrl: `/walk-${index}.png`,
        durationMs: variant.durationMs,
      }))

      const result = createPlaytestModel(variantCharacter, 'outfit-default')
      const mappedWalk = result.ok
        ? result.model.actions.find((action) => action.id === 'walk')
        : undefined

      expect(mappedWalk?.frames.reduce((total, frame) => total + frame.durationMs, 0)).toBe(
        variant.expectedCycleMs,
      )
    }
  })

  it('requires the known dense timing to be explicit on every source frame', () => {
    const authoredCharacter = structuredClone(character)
    const walk = authoredCharacter.outfits[0]!.actions[1]!
    walk.fps = 8
    walk.frameCount = 32
    walk.frames = Array.from({ length: 32 }, (_, index) => ({
      index,
      imageUrl: `/walk-${index}.png`,
      durationMs: index === 17 ? null : 125,
    }))

    const result = createPlaytestModel(authoredCharacter, 'outfit-default')
    const mappedWalk = result.ok
      ? result.model.actions.find((action) => action.id === 'walk')
      : undefined

    expect(mappedWalk?.frames.map((frame) => frame.durationMs)).toEqual(
      Array.from({ length: 32 }, () => 125),
    )
  })

  it('preserves dense locomotion timing when the action is not looping', () => {
    const oneShotCharacter = structuredClone(character)
    const walk = oneShotCharacter.outfits[0]!.actions[1]!
    walk.loop = false
    walk.frameCount = 32
    walk.frames = Array.from({ length: 32 }, (_, index) => ({
      index,
      imageUrl: `/walk-${index}.png`,
      durationMs: 125,
    }))

    const result = createPlaytestModel(oneShotCharacter, 'outfit-default')
    const mappedWalk = result.ok
      ? result.model.actions.find((action) => action.id === 'walk')
      : undefined

    expect(mappedWalk?.frames.reduce((total, frame) => total + frame.durationMs, 0)).toBe(4000)
  })

  it('preserves authored timing for non-locomotion actions with dense frames', () => {
    const denseCharacter = structuredClone(character)
    const idle = denseCharacter.outfits[0]!.actions[0]!
    idle.type = 'attack'
    idle.frameCount = 32
    idle.frames = Array.from({ length: 32 }, (_, index) => ({
      index,
      imageUrl: `/idle-${index}.png`,
      durationMs: 125,
    }))

    const result = createPlaytestModel(denseCharacter, 'outfit-default')
    const mappedIdle = result.ok
      ? result.model.actions.find((action) => action.id === 'idle')
      : undefined

    expect(mappedIdle?.frames.reduce((total, frame) => total + frame.durationMs, 0)).toBe(4000)
  })

  it.each([
    { type: 'idle', frameCount: 12, sourceDurationMs: 125 },
    { type: 'idle', frameCount: 12, sourceDurationMs: 450 },
    { type: 'jump', frameCount: 32, sourceDurationMs: 110 },
    { type: 'attack', frameCount: 32, sourceDurationMs: 90 },
  ])(
    'matches the walk cycle for dense generated $type playback',
    ({ type, frameCount, sourceDurationMs }) => {
      const denseCharacter = structuredClone(character)
      const action = denseCharacter.outfits[0]!.actions[0]!
      action.type = type
      action.frameCount = frameCount
      action.frames = Array.from({ length: frameCount }, (_, index) => ({
        index,
        imageUrl: `/${type}-${index}.png`,
        durationMs: sourceDurationMs,
      }))

      const result = createPlaytestModel(denseCharacter, 'outfit-default')
      const mappedAction = result.ok ? result.model.actions[0] : undefined

      expect(
        mappedAction?.frames.reduce((total, frame) => total + frame.durationMs, 0),
      ).toBeCloseTo(1000)
    },
  )

  it('优先播放全部真实八向序列，不对任何方向应用镜像', () => {
    const directionalCharacter = structuredClone(character)
    const directions = [
      'east',
      'west',
      'north',
      'south',
      'north_east',
      'north_west',
      'south_east',
      'south_west',
    ] as const
    directionalCharacter.outfits[0]!.actions[1]!.sequences = directions.map((direction, index) => ({
      direction,
      sourceDirection: null,
      mirrorX: false,
      frameCount: 2,
      frames: [
        { index: 1, imageUrl: `/walk-${direction}-02.png`, durationMs: 90 + index },
        { index: 0, imageUrl: `/walk-${direction}-01.png`, durationMs: 90 + index },
      ],
    }))

    const result = createPlaytestModel(directionalCharacter, 'outfit-default')
    const walk = result.ok ? result.model.actions.find((action) => action.id === 'walk') : undefined

    expect(Object.keys(walk?.sequences ?? {})).toEqual(directions)
    expect(walk?.sequences?.west).toEqual({
      frames: [
        { imageUrl: '/walk-west-01.png', durationMs: 91 },
        { imageUrl: '/walk-west-02.png', durationMs: 91 },
      ],
      mirrorX: false,
      sourceDirection: 'west',
    })
    for (const direction of directions) {
      expect(walk?.sequences?.[direction]).toMatchObject({
        mirrorX: false,
        sourceDirection: direction,
      })
    }
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
    tinyDurationCharacter.outfits[0]!.actions[0]!.type = 'attack'
    tinyDurationCharacter.outfits[0]!.actions[0]!.frames[0]!.durationMs = 0.001

    const result = createPlaytestModel(tinyDurationCharacter, 'outfit-default')

    expect(result.ok && result.model.actions[0]?.frames[0]?.durationMs).toBe(1)
  })

  it('plays the persisted pixel-perfect frame when the action selects that version', () => {
    const versioned = structuredClone(character) as unknown as Character
    const walk = versioned.outfits[0]!
      .actions[1]! as Character['outfits'][number]['actions'][number] & {
      preferredVersion: 'pixel-perfect'
    }
    walk.preferredVersion = 'pixel-perfect'
    walk.frames.find((frame) => frame.index === 0)!.pixelPerfectImageUrl = '/walk-pixel.png'
    const result = createPlaytestModel(versioned, 'outfit-default')
    const mapped = result.ok ? result.model.actions.find((action) => action.id === 'walk') : null
    expect(mapped?.frames[0]?.imageUrl).toBe('/walk-pixel.png')
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
