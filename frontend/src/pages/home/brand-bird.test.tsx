// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HomeBrandBird } from './brand-bird'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('HomeBrandBird', () => {
  it('stops the running animation when reduced motion is enabled', () => {
    const preference = createReducedMotionPreference(false)
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    const images: EventTarget[] = []
    const pixels = new Uint8ClampedArray(48 * 48 * 4)
    pixels[3] = 255
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
      getImageData: vi.fn(() => ({ data: pixels })),
      setTransform: vi.fn(),
    }

    class FakeResizeObserver {
      observe() {}
      disconnect() {}
    }

    class TestImage extends EventTarget {
      decoding: 'async' | 'sync' | 'auto' = 'auto'
      src = ''

      constructor() {
        super()
        images.push(this)
      }
    }

    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('Image', TestImage)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => preference.query),
    )
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
      frames.delete(frameId)
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => context as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 640,
      height: 360,
    } as DOMRect)

    render(<HomeBrandBird />)
    const image = images[0]
    if (!image) throw new Error('HomeBrandBird did not create its image')
    image.dispatchEvent(new Event('load'))
    expect(frames.size).toBe(1)

    preference.setMatches(true)

    expect(frames.size).toBe(0)
  })
})

interface ReducedMotionPreference {
  query: MediaQueryList
  setMatches(matches: boolean): void
}

function createReducedMotionPreference(initialMatches: boolean): ReducedMotionPreference {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    get matches() {
      return matches
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.add(listener as (event: MediaQueryListEvent) => void)
      }
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.delete(listener as (event: MediaQueryListEvent) => void)
      }
    },
  } as MediaQueryList

  return {
    query,
    setMatches(nextMatches) {
      matches = nextMatches
      const event = { matches, media: query.media } as MediaQueryListEvent
      for (const listener of listeners) listener(event)
    },
  }
}
