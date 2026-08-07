import { describe, expect, it, vi } from 'vitest'

import type { PlaytestAction } from '../model'
import { preloadActionFrames } from './use-playtest-runtime'

const actions: readonly PlaytestAction[] = [
  {
    id: 'idle',
    name: '待机',
    type: 'idle',
    loop: true,
    frames: [
      { imageUrl: '/idle-1.png', durationMs: 100 },
      { imageUrl: '/idle-2.png', durationMs: 100 },
    ],
  },
  {
    id: 'walk',
    name: '行走',
    type: 'walk',
    loop: true,
    frames: [
      { imageUrl: '/walk-1.png', durationMs: 100 },
      { imageUrl: '/idle-1.png', durationMs: 100 },
    ],
  },
]

describe('preloadActionFrames', () => {
  it('loads and decodes every unique bound frame before it is selected', () => {
    const loaded: string[] = []
    const decoded: string[] = []
    const createImage = () => {
      let currentUrl = ''
      return {
        get src() {
          return currentUrl
        },
        set src(url: string) {
          currentUrl = url
          loaded.push(url)
        },
        decode: vi.fn(() => {
          decoded.push(currentUrl)
          return Promise.resolve()
        }),
      } as unknown as HTMLImageElement
    }

    preloadActionFrames(actions, createImage)

    expect(loaded).toEqual(['/idle-1.png', '/idle-2.png', '/walk-1.png'])
    expect(decoded).toEqual(loaded)
  })
})
