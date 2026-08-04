/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { PreviewFrame } from './model/types'
import { createStageMotionState, reduceStageMotion, useStageMotion } from './stage-motion'

const movingFrame: PreviewFrame = {
  imageUrl: 'https://cdn.example.test/walk.png',
  durationMs: 100,
  rootMotion: { dx: 4, dy: 3 },
  keyFrame: false,
}

afterEach(cleanup)

function MotionProbe({
  frame,
  playing,
  frameTick,
  resetKey,
}: {
  frame: PreviewFrame | null
  playing: boolean
  frameTick: number
  resetKey: string
}) {
  const motion = useStageMotion({ frame, playing, frameTick, resetKey })

  return (
    <>
      <output>{`${motion.offset.x},${motion.offset.y}`}</output>
      <button type="button" onClick={() => motion.setMirrored(true)}>
        向左
      </button>
      <button type="button" onClick={() => motion.setMirrored(false)}>
        向右
      </button>
    </>
  )
}

describe('stage motion', () => {
  it('clamps at the right edge, turns left, and keeps moving inward', () => {
    const bounded = reduceStageMotion(createStageMotionState(0), {
      type: 'set-bounds',
      bounds: { minX: -10, maxX: 10 },
    })
    const nearEdge = reduceStageMotion(bounded, {
      type: 'consume-frame',
      tick: 1,
      rootMotion: { dx: 8, dy: 0 },
    })
    const hitEdge = reduceStageMotion(nearEdge, {
      type: 'consume-frame',
      tick: 2,
      rootMotion: { dx: 4, dy: 0 },
    })
    const movedInward = reduceStageMotion(hitEdge, {
      type: 'consume-frame',
      tick: 3,
      rootMotion: { dx: 3, dy: 0 },
    })

    expect(hitEdge).toMatchObject({ offset: { x: 10, y: 0 }, mirrored: true })
    expect(movedInward).toMatchObject({ offset: { x: 7, y: 0 }, mirrored: true })
  })

  it('clamps at the left edge, turns right, and keeps moving inward', () => {
    const bounded = reduceStageMotion(createStageMotionState(0), {
      type: 'set-bounds',
      bounds: { minX: -10, maxX: 10 },
    })
    const facingLeft = reduceStageMotion(bounded, { type: 'set-mirrored', mirrored: true })
    const nearEdge = reduceStageMotion(facingLeft, {
      type: 'consume-frame',
      tick: 1,
      rootMotion: { dx: 8, dy: 0 },
    })
    const hitEdge = reduceStageMotion(nearEdge, {
      type: 'consume-frame',
      tick: 2,
      rootMotion: { dx: 4, dy: 0 },
    })
    const movedInward = reduceStageMotion(hitEdge, {
      type: 'consume-frame',
      tick: 3,
      rootMotion: { dx: 3, dy: 0 },
    })

    expect(hitEdge).toMatchObject({ offset: { x: -10, y: 0 }, mirrored: false })
    expect(movedInward).toMatchObject({ offset: { x: -7, y: 0 }, mirrored: false })
  })

  it('reclamps an existing position when the measured stage becomes narrower', () => {
    const wide = reduceStageMotion(createStageMotionState(0), {
      type: 'set-bounds',
      bounds: { minX: -20, maxX: 20 },
    })
    const moved = reduceStageMotion(wide, {
      type: 'consume-frame',
      tick: 1,
      rootMotion: { dx: 16, dy: 0 },
    })
    const narrowed = reduceStageMotion(moved, {
      type: 'set-bounds',
      bounds: { minX: -5, maxX: 5 },
    })

    expect(narrowed).toMatchObject({ offset: { x: 5, y: 0 }, mirrored: true })
  })

  it('adds each newly advanced playback tick once', () => {
    // Catches a rerender applying a frame's incremental root motion more than once.
    const first = reduceStageMotion(createStageMotionState(0), {
      type: 'consume-frame',
      tick: 1,
      rootMotion: { dx: 4, dy: 3 },
    })
    const duplicate = reduceStageMotion(first, {
      type: 'consume-frame',
      tick: 1,
      rootMotion: { dx: 4, dy: 3 },
    })
    const second = reduceStageMotion(duplicate, {
      type: 'consume-frame',
      tick: 2,
      rootMotion: { dx: -1, dy: 2 },
    })

    expect(second.offset).toEqual({ x: 3, y: 5 })
    expect(second.consumedTick).toBe(2)
  })

  it('uses a fresh loop tick to continue accumulating when playback returns to the first frame', () => {
    // Catches loop wraps being mistaken for a duplicate frame and dropping their root-motion increment.
    const afterFirstPass = reduceStageMotion(createStageMotionState(0), {
      type: 'consume-frame',
      tick: 1,
      rootMotion: { dx: 2, dy: 0 },
    })
    const afterLoop = reduceStageMotion(afterFirstPass, {
      type: 'consume-frame',
      tick: 2,
      rootMotion: { dx: 2, dy: 0 },
    })

    expect(afterLoop.offset).toEqual({ x: 4, y: 0 })
  })

  it('sets mirrored direction idempotently without resetting position and reverses future horizontal increments', () => {
    // Catches repeated A/D presses flipping back to the opposite direction, resetting placement, or leaving mirrored locomotion moving right.
    const movedRight = reduceStageMotion(createStageMotionState(0), {
      type: 'consume-frame',
      tick: 1,
      rootMotion: { dx: 5, dy: 1 },
    })
    const mirrored = reduceStageMotion(movedRight, { type: 'set-mirrored', mirrored: true })
    const mirroredAgain = reduceStageMotion(mirrored, { type: 'set-mirrored', mirrored: true })
    const movedLeft = reduceStageMotion(mirroredAgain, {
      type: 'consume-frame',
      tick: 2,
      rootMotion: { dx: 2, dy: 0 },
    })
    const restored = reduceStageMotion(movedLeft, { type: 'set-mirrored', mirrored: false })

    expect(mirrored).toMatchObject({ offset: { x: 5, y: 1 }, mirrored: true })
    expect(mirroredAgain).toMatchObject({ offset: { x: 5, y: 1 }, mirrored: true })
    expect(movedLeft.offset).toEqual({ x: 3, y: 1 })
    expect(restored).toMatchObject({ offset: { x: 3, y: 1 }, mirrored: false })
  })

  it('treats absent root motion as stationary', () => {
    // Catches missing rootMotion producing a non-zero offset or erasing the accumulated position.
    const moved = reduceStageMotion(createStageMotionState(0), {
      type: 'consume-frame',
      tick: 1,
      rootMotion: movingFrame.rootMotion,
    })
    const stationary = reduceStageMotion(moved, {
      type: 'consume-frame',
      tick: 2,
      rootMotion: null,
    })

    expect(stationary.offset).toEqual({ x: 4, y: 3 })
  })

  it('does not consume on start, resume, direction change, or same-tick rerenders', () => {
    // Catches playback state changes applying the current frame before an automatic tick reaches its target frame.
    const { rerender } = render(
      <MotionProbe
        frame={movingFrame}
        playing={false}
        frameTick={0}
        resetKey="character-a:outfit-a"
      />,
    )

    expect(screen.getByRole('status').textContent).toBe('0,0')

    rerender(
      <MotionProbe frame={movingFrame} playing frameTick={0} resetKey="character-a:outfit-a" />,
    )
    expect(screen.getByRole('status').textContent).toBe('0,0')

    fireEvent.click(screen.getByRole('button', { name: '向左' }))
    expect(screen.getByRole('status').textContent).toBe('0,0')

    rerender(
      <MotionProbe frame={movingFrame} playing frameTick={1} resetKey="character-a:outfit-a" />,
    )
    expect(screen.getByRole('status').textContent).toBe('-4,3')

    rerender(
      <MotionProbe
        frame={{ ...movingFrame, rootMotion: { dx: 100, dy: 100 } }}
        playing={false}
        frameTick={1}
        resetKey="character-a:outfit-a"
      />,
    )
    rerender(
      <MotionProbe
        frame={{ ...movingFrame, rootMotion: { dx: 100, dy: 100 } }}
        playing
        frameTick={1}
        resetKey="character-a:outfit-a"
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('-4,3')
  })

  it('uses the current tick as a reset baseline for a new character or outfit', () => {
    // Catches a reset immediately consuming the new preview's current frame or retaining the old preview position.
    const { rerender } = render(
      <MotionProbe frame={movingFrame} playing frameTick={4} resetKey="character-a:outfit-a" />,
    )

    rerender(
      <MotionProbe frame={movingFrame} playing frameTick={5} resetKey="character-a:outfit-a" />,
    )
    expect(screen.getByRole('status').textContent).toBe('4,3')

    rerender(
      <MotionProbe frame={movingFrame} playing frameTick={5} resetKey="character-b:outfit-a" />,
    )
    expect(screen.getByRole('status').textContent).toBe('0,0')
  })
})
