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
})
