import { describe, expect, it } from 'vitest'

import type { Outfit } from './index'
import { getOutfitPlayback } from './outfit-playback'

function makeOutfit(frameCount: number): Outfit {
  return {
    id: 'outfit-default',
    characterId: '51',
    name: '常态造型',
    description: null,
    previewUrl: null,
    model3dUrl: null,
    actions: [
      {
        id: 'walk',
        outfitId: 'outfit-default',
        name: '行走',
        type: 'walk',
        loop: true,
        fps: 10,
        frameCount,
        frames: Array.from({ length: frameCount }, (_, index) => ({
          index,
          imageUrl: `https://cdn.windup.test/walk-${index}.png`,
          durationMs: 100,
        })),
      },
    ],
  }
}

describe('getOutfitPlayback', () => {
  it('treats an outfit as playable only when its actions contain real frames', () => {
    expect(getOutfitPlayback(makeOutfit(2))).toEqual({ frameCount: 2, playable: true })
    expect(getOutfitPlayback(makeOutfit(0))).toEqual({ frameCount: 0, playable: false })
  })

  it('counts sequence-only source frames without counting mirrored directions twice', () => {
    const outfit = makeOutfit(0)
    outfit.actions[0]!.sequences = [
      {
        direction: 'east',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 2,
        frames: [
          { index: 0, imageUrl: '/east-0.png', durationMs: 100 },
          { index: 1, imageUrl: '/east-1.png', durationMs: 100 },
        ],
      },
      {
        direction: 'west',
        sourceDirection: 'east',
        mirrorX: true,
        frameCount: 2,
        frames: [],
      },
    ]

    expect(getOutfitPlayback(outfit)).toEqual({ frameCount: 2, playable: true })
  })
})
