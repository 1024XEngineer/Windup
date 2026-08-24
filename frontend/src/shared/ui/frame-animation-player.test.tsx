// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as sharedUi from '.'
import { FrameAnimationPlayer } from './frame-animation-player'

const frames = [
  { index: 1, imageUrl: '/frame-2.png', durationMs: 120 },
  { index: 0, imageUrl: '/frame-1.png', durationMs: 80 },
] as const

function visibleFrame() {
  return screen.getByRole('img', { name: '角色动作' })
}

describe('FrameAnimationPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('plays frames by explicit index and per-frame duration', () => {
    render(<FrameAnimationPlayer frames={frames} alt="角色动作" />)

    expect(visibleFrame().getAttribute('src')).toBe('/frame-1.png')

    act(() => vi.advanceTimersByTime(79))
    expect(visibleFrame().getAttribute('src')).toBe('/frame-1.png')

    act(() => vi.advanceTimersByTime(1))
    expect(visibleFrame().getAttribute('src')).toBe('/frame-2.png')
  })

  it('loops to the first frame after the last frame duration', () => {
    render(<FrameAnimationPlayer frames={frames} alt="角色动作" />)

    act(() => vi.advanceTimersByTime(200))

    expect(visibleFrame().getAttribute('src')).toBe('/frame-1.png')
  })

  it('holds the last frame for a non-looping action', () => {
    render(<FrameAnimationPlayer frames={frames} alt="角色动作" loop={false} />)

    act(() => vi.advanceTimersByTime(2_000))

    expect(visibleFrame().getAttribute('src')).toBe('/frame-2.png')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    [{ ...frames[0], durationMs: null }, 20, 49, 1],
    [{ ...frames[0], durationMs: null }, 0, 99, 1],
  ] as const)(
    'falls back from a missing frame duration with fps %s',
    (firstFrame, fps, beforeAdvance, finalAdvance) => {
      render(
        <FrameAnimationPlayer
          frames={[
            { ...firstFrame, index: 0 },
            { ...frames[1], index: 1 },
          ]}
          fps={fps}
          alt="角色动作"
        />,
      )

      act(() => vi.advanceTimersByTime(beforeAdvance))
      expect(visibleFrame().getAttribute('src')).toBe('/frame-2.png')

      act(() => vi.advanceTimersByTime(finalAdvance))
      expect(visibleFrame().getAttribute('src')).toBe('/frame-1.png')
    },
  )

  it('restarts from the first frame when the sequence changes', () => {
    const { rerender } = render(<FrameAnimationPlayer frames={frames} alt="角色动作" />)
    act(() => vi.advanceTimersByTime(80))
    expect(visibleFrame().getAttribute('src')).toBe('/frame-2.png')

    rerender(
      <FrameAnimationPlayer
        frames={[
          { index: 5, imageUrl: '/new-2.png', durationMs: 100 },
          { index: 4, imageUrl: '/new-1.png', durationMs: 100 },
        ]}
        alt="角色动作"
      />,
    )

    expect(visibleFrame().getAttribute('src')).toBe('/new-1.png')
  })

  it('keeps playback progress when a parent recreates equivalent frames', () => {
    const { rerender } = render(<FrameAnimationPlayer frames={frames} alt="角色动作" />)
    act(() => vi.advanceTimersByTime(50))

    rerender(<FrameAnimationPlayer frames={frames.map((frame) => ({ ...frame }))} alt="角色动作" />)
    act(() => vi.advanceTimersByTime(30))

    expect(visibleFrame().getAttribute('src')).toBe('/frame-2.png')
  })

  it('passes image presentation attributes through to the visible frame', () => {
    render(
      <FrameAnimationPlayer
        frames={frames}
        alt="角色动作"
        className="pixel-preview"
        draggable={false}
      />,
    )

    expect(visibleFrame().className).toBe('pixel-preview')
    expect(visibleFrame().getAttribute('draggable')).toBe('false')
  })

  it('is available from the shared UI entry', () => {
    expect(sharedUi.FrameAnimationPlayer).toBeTypeOf('function')
  })
})
