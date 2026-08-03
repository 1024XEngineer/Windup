import { useEffect, useState } from 'react'

import type { PlaytestActionType, PreviewFrame, PreviewSequence } from '../model/types'
import { readImageGeometry } from './image-geometry'
import type { CanvasBaseline } from './quality-policy'
import {
  buildSequenceEvidence,
  type FrameGeometryResult,
  type SequenceReviewEvidence,
} from './sequence-evidence'

export type FrameReviewEvidenceState =
  | { status: 'idle'; evidence: null }
  | { status: 'loading'; evidence: null }
  | { status: 'ready'; evidence: SequenceReviewEvidence }

export type ImageGeometryReader = (
  imageUrl: string,
  signal?: AbortSignal,
) => Promise<FrameGeometryResult>

interface ResolvedState {
  key: string | null
  value: FrameReviewEvidenceState
}

const IDLE_STATE: FrameReviewEvidenceState = { status: 'idle', evidence: null }
const LOADING_STATE: FrameReviewEvidenceState = { status: 'loading', evidence: null }

export function useFrameReviewEvidence(
  sequence: PreviewSequence | null,
  actionType: PlaytestActionType | null,
  reader: ImageGeometryReader = readImageGeometry,
  expectedCanvas: CanvasBaseline | null = null,
): FrameReviewEvidenceState {
  const sequenceKey =
    sequence === null || actionType === null
      ? null
      : JSON.stringify([
          actionType,
          expectedCanvas,
          ...sequence.frames.map((frame) => ({
            imageUrl: frame.imageUrl,
            rootMotion: frame.rootMotion,
          })),
        ])
  const [resolved, setResolved] = useState<ResolvedState>({ key: null, value: IDLE_STATE })

  useEffect(() => {
    if (sequenceKey === null || actionType === null) {
      setResolved({ key: null, value: IDLE_STATE })
      return
    }

    const [, , ...frameDescriptors] = JSON.parse(sequenceKey) as [
      PlaytestActionType,
      CanvasBaseline | null,
      ...Array<{ imageUrl: string; rootMotion: PreviewFrame['rootMotion'] }>,
    ]
    const imageUrls = frameDescriptors.map((frame) => frame.imageUrl)

    const controller = new AbortController()
    let active = true
    const inFlight = new Map<string, Promise<FrameGeometryResult>>()

    setResolved({ key: sequenceKey, value: LOADING_STATE })

    const results = imageUrls.map((imageUrl) => {
      const existing = inFlight.get(imageUrl)
      if (existing !== undefined) return existing

      const pending = reader(imageUrl, controller.signal).catch(
        (): FrameGeometryResult => ({ status: 'unavailable', reason: '图片分析失败' }),
      )
      inFlight.set(imageUrl, pending)
      return pending
    })

    void Promise.all(results).then((frameResults) => {
      if (!active || controller.signal.aborted) return

      setResolved({
        key: sequenceKey,
        value: {
          status: 'ready',
          evidence: buildSequenceEvidence(
            frameResults.map((geometry, index) => ({
              geometry,
              rootMotion: frameDescriptors[index]?.rootMotion ?? null,
            })),
            actionType,
            expectedCanvas,
          ),
        },
      })
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [actionType, expectedCanvas, reader, sequenceKey])

  if (sequenceKey === null) return IDLE_STATE
  return resolved.key === sequenceKey ? resolved.value : LOADING_STATE
}
