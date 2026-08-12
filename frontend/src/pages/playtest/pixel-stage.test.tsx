// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPlaytestSceneState } from './pixel-stage-model'
import { PlaytestPixelStage } from './pixel-stage'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlaytestPixelStage', () => {
  it('renders the moving scene as one persistent dot-matrix canvas', () => {
    const context = {
      globalAlpha: 1,
      fillStyle: '',
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
    }
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.stubGlobal('matchMedia', () => ({ matches: false }))

    const frames: FrameRequestCallback[] = []
    let nextFrameId = 0
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      nextFrameId += 1
      return nextFrameId
    })
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)

    const { unmount } = render(<PlaytestPixelStage />)

    frames.shift()?.(360)
    frames.shift()?.(2916)

    const stage = screen.getByTestId('playtest-pixel-stage')
    const canvas = screen.getByTestId('playtest-dot-canvas')
    expect(stage.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.tagName).toBe('CANVAS')
    expect(stage.querySelector('svg')).toBeNull()
    expect(context.fillRect).toHaveBeenCalledTimes(3)
    expect(context.arc.mock.calls.length).toBeGreaterThan(500)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(3)

    unmount()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(3)
  })

  it('aligns the obstacle crossing with the jump and closes the runner loop without a seam', () => {
    const crossingTime = 3600 * ((154 - 43) / 180)
    const crossing = getPlaytestSceneState(crossingTime)
    expect(Math.abs(crossing.obstacleX - (crossing.runner.originX + 5))).toBeLessThan(1)
    expect(crossing.runner.originY).toBeLessThan(28)

    expect(getPlaytestSceneState(3600)).toEqual(getPlaytestSceneState(0))
  })

  it('redraws the static frame after a reduced-motion resize clears the canvas', () => {
    const context = {
      globalAlpha: 1,
      fillStyle: '',
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
    }
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    let resize: ResizeObserverCallback | undefined
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)

    render(<PlaytestPixelStage />)
    expect(context.fillRect).toHaveBeenCalledOnce()

    resize?.([], {} as ResizeObserver)
    expect(context.fillRect).toHaveBeenCalledTimes(2)
  })
})
