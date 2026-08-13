// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlaytestAction } from '../model'
import { preloadActionFrames, usePlaytestRuntime } from './use-playtest-runtime'

afterEach(() => {
  vi.unstubAllGlobals()
})

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
  it('prioritizes the active action while preloading every unique bound frame', () => {
    const loaded: string[] = []
    const decoded: string[] = []
    const priorities: string[] = []
    const createImage = () => {
      let currentUrl = ''
      let currentPriority = 'auto'
      return {
        get src() {
          return currentUrl
        },
        set src(url: string) {
          currentUrl = url
          loaded.push(url)
          priorities.push(currentPriority)
        },
        get fetchPriority() {
          return currentPriority
        },
        set fetchPriority(priority: string) {
          currentPriority = priority
        },
        decode: vi.fn(() => {
          decoded.push(currentUrl)
          return Promise.resolve()
        }),
      } as unknown as HTMLImageElement
    }

    preloadActionFrames(actions, 'walk', createImage)

    expect(loaded).toEqual(['/walk-1.png', '/idle-1.png', '/idle-2.png'])
    expect(priorities).toEqual(['high', 'high', 'low'])
    expect(decoded).toEqual(loaded)
  })

  it('does not restart the preload batch when the user switches actions', () => {
    const createImage = vi.fn(() => ({
      decode: vi.fn(() => Promise.resolve()),
    }))
    vi.stubGlobal('Image', function Image() {
      return createImage()
    })
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { result } = renderHook(() => usePlaytestRuntime(actions, 'idle'))
    expect(createImage).toHaveBeenCalledTimes(3)

    act(() => result.current.selectAction('walk'))

    expect(createImage).toHaveBeenCalledTimes(3)
  })
})
