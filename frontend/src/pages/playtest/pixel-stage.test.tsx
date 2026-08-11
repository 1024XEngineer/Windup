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
})

describe('PlaytestPixelStage', () => {
  it('renders the moving scene as one persistent dot-matrix canvas', () => {
    render(<PlaytestPixelStage />)

    const stage = screen.getByTestId('playtest-pixel-stage')
    const canvas = screen.getByTestId('playtest-dot-canvas')
    expect(stage.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.tagName).toBe('CANVAS')
    expect(stage.querySelector('svg')).toBeNull()
  })

  it('aligns the obstacle crossing with the jump and closes the runner loop without a seam', () => {
    const crossingTime = 3600 * ((154 - 43) / 180)
    const crossing = getPlaytestSceneState(crossingTime)
    expect(Math.abs(crossing.obstacleX - (crossing.runner.originX + 5))).toBeLessThan(1)
    expect(crossing.runner.originY).toBeLessThan(28)

    expect(getPlaytestSceneState(3600)).toEqual(getPlaytestSceneState(0))
  })
})
