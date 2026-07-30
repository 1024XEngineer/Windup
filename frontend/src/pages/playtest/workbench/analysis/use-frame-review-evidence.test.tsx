/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PreviewSequence } from '../model/types'
import type { FrameGeometry } from './frame-geometry'
import type { FrameGeometryResult } from './sequence-evidence'
import { useFrameReviewEvidence, type ImageGeometryReader } from './use-frame-review-evidence'

function sequence(...imageUrls: string[]): PreviewSequence {
  return {
    direction: 'south',
    frames: imageUrls.map((imageUrl) => ({
      imageUrl,
      durationMs: 100,
      rootMotion: null,
      keyFrame: false,
    })),
  }
}

function geometry(x: number, y = 10): FrameGeometryResult {
  const value: FrameGeometry = {
    width: 256,
    height: 256,
    bounds: { left: x, top: 0, right: x + 9, bottom: 19, width: 10, height: 20 },
    centroid: { x, y },
    footY: 19,
    subjectHeight: 20,
    opaquePixels: 100,
    coverageRatio: 100 / (256 * 256),
  }
  return { status: 'ready', geometry: value }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolvePromise: ((value: T) => void) | null = null
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve(value) {
      if (resolvePromise === null) throw new Error('deferred promise is not initialized')
      resolvePromise(value)
    },
  }
}

afterEach(cleanup)

describe('useFrameReviewEvidence', () => {
  it('exposes loading before producing real sequence evidence', async () => {
    // Catches the Inspector flashing fabricated zeros before image analysis completes.
    const pending = deferred<FrameGeometryResult>()
    const reader: ImageGeometryReader = () => pending.promise
    const { result } = renderHook(() =>
      useFrameReviewEvidence(sequence('/frame-1.png'), 'walk', reader),
    )

    expect(result.current).toEqual({ status: 'loading', evidence: null })

    await act(async () => pending.resolve(geometry(4)))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.evidence?.frames[0]?.geometry?.centroid.x).toBe(4)
  })

  it('ignores a previous sequence result that resolves after a direction switch', async () => {
    // Catches a slow old direction replacing the evidence for the currently selected direction.
    const south = deferred<FrameGeometryResult>()
    const north = deferred<FrameGeometryResult>()
    const reader: ImageGeometryReader = (imageUrl) =>
      imageUrl.includes('south') ? south.promise : north.promise
    const { result, rerender } = renderHook(
      ({ current }) => useFrameReviewEvidence(current, 'walk', reader),
      { initialProps: { current: sequence('/south.png') } },
    )

    rerender({ current: sequence('/north.png') })
    await act(async () => north.resolve(geometry(20)))
    await waitFor(() => expect(result.current.evidence?.frames[0]?.geometry?.centroid.x).toBe(20))

    await act(async () => south.resolve(geometry(2)))
    expect(result.current.evidence?.frames[0]?.geometry?.centroid.x).toBe(20)
  })

  it('passes an abort signal to image reads and aborts stale sequence work', () => {
    const pending = deferred<FrameGeometryResult>()
    const reader = vi.fn<ImageGeometryReader>(() => pending.promise)
    const { rerender } = renderHook(
      ({ current }) => useFrameReviewEvidence(current, 'walk', reader),
      { initialProps: { current: sequence('/south.png') } },
    )

    const firstSignal = reader.mock.calls[0]?.[1]
    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(firstSignal?.aborted).toBe(false)

    rerender({ current: sequence('/north.png') })

    expect(firstSignal?.aborted).toBe(true)
    expect(reader.mock.calls[1]?.[1]).toBeInstanceOf(AbortSignal)
  })

  it('reuses settled image results when frames are selected or revisited', async () => {
    // Catches frame navigation repeatedly decoding every image in the same review session.
    const reader = vi.fn<ImageGeometryReader>(async (imageUrl) =>
      geometry(imageUrl.includes('one') ? 1 : 2),
    )
    const first = sequence('/one.png')
    const second = sequence('/two.png')
    const { result, rerender } = renderHook(
      ({ current }) => useFrameReviewEvidence(current, 'walk', reader),
      { initialProps: { current: first } },
    )

    await waitFor(() => expect(result.current.status).toBe('ready'))
    rerender({ current: first })
    expect(reader).toHaveBeenCalledTimes(1)

    rerender({ current: second })
    await waitFor(() => expect(result.current.evidence?.frames[0]?.geometry?.centroid.x).toBe(2))
    rerender({ current: first })
    await waitFor(() => expect(result.current.evidence?.frames[0]?.geometry?.centroid.x).toBe(1))
    expect(reader).toHaveBeenCalledTimes(2)
  })

  it('retries an unavailable image when its sequence is revisited', async () => {
    // A transient image failure must not become a permanent session-level cache entry.
    let failedOnce = false
    const reader = vi.fn<ImageGeometryReader>(async (imageUrl) => {
      if (imageUrl.includes('retry') && !failedOnce) {
        failedOnce = true
        return { status: 'unavailable', reason: 'temporary failure' }
      }
      return geometry(imageUrl.includes('retry') ? 9 : 2)
    })
    const retrySequence = sequence('/retry.png')
    const otherSequence = sequence('/other.png')
    const { result, rerender } = renderHook(
      ({ current }) => useFrameReviewEvidence(current, 'walk', reader),
      { initialProps: { current: retrySequence } },
    )

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.evidence?.complete).toBe(false)

    rerender({ current: otherSequence })
    await waitFor(() => expect(result.current.evidence?.frames[0]?.geometry?.centroid.x).toBe(2))
    rerender({ current: retrySequence })
    await waitFor(() => expect(result.current.evidence?.frames[0]?.geometry?.centroid.x).toBe(9))

    expect(reader).toHaveBeenCalledTimes(3)
  })

  it('stays idle without a review sequence and does not read an image', () => {
    // Catches direct-control mode starting hidden Canvas work.
    const reader = vi.fn<ImageGeometryReader>()
    const { result } = renderHook(() => useFrameReviewEvidence(null, null, reader))

    expect(result.current).toEqual({ status: 'idle', evidence: null })
    expect(reader).not.toHaveBeenCalled()
  })

  it('does not update React state after the consumer unmounts', async () => {
    // Catches an image completion writing into a removed Playtest workbench.
    const pending = deferred<FrameGeometryResult>()
    const reader: ImageGeometryReader = () => pending.promise
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const mounted = renderHook(() => useFrameReviewEvidence(sequence('/slow.png'), 'walk', reader))

    mounted.unmount()
    await act(async () => pending.resolve(geometry(1)))

    expect(consoleError).not.toHaveBeenCalled()
  })

  it('keeps each preview frame root motion beside its measured geometry', async () => {
    // Catches asynchronous image results losing their matching motion contract before aggregation.
    const base = sequence('/first.png', '/second.png')
    const motionSequence: PreviewSequence = {
      ...base,
      frames: [
        { ...base.frames[0]!, rootMotion: null },
        { ...base.frames[1]!, rootMotion: { dx: 10, dy: 6 } },
      ],
    }
    const reader: ImageGeometryReader = async (imageUrl) =>
      imageUrl.includes('first') ? geometry(0, 10) : geometry(3, 14)
    const { result } = renderHook(() => useFrameReviewEvidence(motionSequence, 'walk', reader))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.evidence?.frames[1]).toMatchObject({
      expectedRootDelta: { dx: 10, dy: 6 },
      composedPreviewDelta: { dx: 13, dy: 2 },
    })
  })
})
