import { useEffect, useState } from 'react'

import type { PreviewAction, PreviewSequence } from '../model/types'
import { readImageGeometry } from './image-geometry'
import type { CanvasBaseline } from './quality-policy'
import {
  buildSequenceEvidence,
  type FrameGeometryResult,
  type SequenceReviewEvidence,
} from './sequence-evidence'
import type { ImageGeometryReader } from './use-frame-review-evidence'

export type PreviewQualityEvidenceState =
  | { status: 'loading'; evidenceBySequence: ReadonlyMap<string, SequenceReviewEvidence> }
  | { status: 'ready'; evidenceBySequence: ReadonlyMap<string, SequenceReviewEvidence> }

/** 同一个动作内未来可能出现多个方向，因此质量结果必须使用动作和方向共同定位。 */
export function previewSequenceKey(action: PreviewAction, sequence: PreviewSequence): string {
  return `${action.id}\u0000${sequence.direction}`
}

/**
 * 导出前检查全部动作序列，而不是只复用用户当前正在看的那一个动作。
 * 同一图片地址只读取一次，任何读取失败都会成为对应序列的阻断性质量证据。
 */
export function usePreviewQualityEvidence(
  actions: readonly PreviewAction[],
  expectedCanvas: CanvasBaseline | null,
  reader: ImageGeometryReader = readImageGeometry,
): PreviewQualityEvidenceState {
  const analysisKey = JSON.stringify([expectedCanvas, actions])
  const [resolved, setResolved] = useState<{
    key: string | null
    evidenceBySequence: ReadonlyMap<string, SequenceReviewEvidence>
  }>({ key: null, evidenceBySequence: new Map() })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const inFlight = new Map<string, Promise<FrameGeometryResult>>()

    const readFrame = (imageUrl: string) => {
      const existing = inFlight.get(imageUrl)
      if (existing !== undefined) return existing

      const pending = reader(imageUrl, controller.signal).catch(
        (): FrameGeometryResult => ({ status: 'unavailable', reason: '图片分析失败' }),
      )
      inFlight.set(imageUrl, pending)
      return pending
    }

    const analyses = actions.flatMap((action) =>
      action.sequences.map(async (sequence) => {
        const frameResults = await Promise.all(
          sequence.frames.map((frame) => readFrame(frame.imageUrl)),
        )
        return [
          previewSequenceKey(action, sequence),
          buildSequenceEvidence(
            frameResults.map((geometry, index) => ({
              geometry,
              rootMotion: sequence.frames[index]?.rootMotion ?? null,
            })),
            action.type,
            expectedCanvas,
          ),
        ] as const
      }),
    )

    void Promise.all(analyses).then((entries) => {
      if (!active || controller.signal.aborted) return
      setResolved({ key: analysisKey, evidenceBySequence: new Map(entries) })
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [actions, analysisKey, expectedCanvas, reader])

  return resolved.key === analysisKey
    ? { status: 'ready', evidenceBySequence: resolved.evidenceBySequence }
    : { status: 'loading', evidenceBySequence: new Map() }
}
