import type { Frame } from '@/entities/character'

import type { PlaytestActionType } from '../model/types'
import type { FrameGeometry } from './frame-geometry'
import { deriveLocalQualityPolicy, type CanvasBaseline } from './quality-policy'

export type EvidenceState = 'normal' | 'attention' | 'anomaly' | 'not_applicable'

export type QualityFindingCode =
  | 'image_unavailable'
  | 'blank_subject'
  | 'canvas_size_mismatch'
  | 'subject_cropped'
  | 'coverage_too_low'
  | 'coverage_too_high'
  | 'duplicate_frame'
  | 'motion_spike'
  | 'foot_drift'
  | 'height_drift'
  | 'area_spike'
  | 'root_motion_mismatch'

export interface QualityFinding {
  code: QualityFindingCode
  severity: 'warning' | 'error'
  frameIndex: number | null
  message: string
  metrics: Readonly<Record<string, number | string>>
}

export type FrameGeometryResult =
  | { status: 'ready'; geometry: FrameGeometry }
  | { status: 'unavailable'; reason: string }

export interface FrameEvidenceInput {
  geometry: FrameGeometryResult
  rootMotion: Frame['rootMotion']
}

export interface AdjacentFrameDelta {
  dx: number
  dy: number
  distance: number
  areaDeltaPercent: number
}

export interface MotionVector {
  dx: number
  dy: number
  distance: number
}

export interface FrameReviewEvidence {
  geometry: FrameGeometry | null
  unavailableReason: string | null
  previousDelta: AdjacentFrameDelta | null
  expectedRootDelta: MotionVector | null
  composedPreviewDelta: MotionVector | null
  canvasState: EvidenceState
  coverageState: EvidenceState
  movementState: EvidenceState
  areaState: EvidenceState
}

export interface SequenceReviewEvidence {
  complete: boolean
  unavailableFrameCount: number
  frames: readonly FrameReviewEvidence[]
  findings: readonly QualityFinding[]
  summary: {
    footDrift: number | null
    heightDrift: number | null
    medianStep: number | null
    maxStep: number | null
    movementThreshold: number | null
    heightThreshold: number | null
    footThreshold: number | null
    areaThresholdPercent: number
    expectedCanvas: CanvasBaseline | null
    maxAreaDeltaPercent: number | null
    canvasState: EvidenceState
    footState: EvidenceState
    heightState: EvidenceState
    movementState: EvidenceState
    areaState: EvidenceState
  }
}

function medianAbsoluteDeviation(values: readonly number[], center: number | null): number | null {
  if (center === null || values.length === 0) return null
  return median(values.map((value) => Math.abs(value - center)))
}

function fingerprintDistance(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined,
): number | null {
  if (
    left === undefined ||
    right === undefined ||
    left.length === 0 ||
    left.length !== right.length
  )
    return null

  const total = left.reduce(
    (sum, value, index) => sum + Math.abs(value - (right[index] ?? value)),
    0,
  )
  return total / left.length
}

function isCropped(geometry: FrameGeometry, margin: { x: number; y: number }): boolean {
  return (
    geometry.bounds.left < margin.x ||
    geometry.bounds.top < margin.y ||
    geometry.bounds.right >= geometry.width - margin.x ||
    geometry.bounds.bottom >= geometry.height - margin.y
  )
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  if (upper === undefined) return null

  if (sorted.length % 2 === 1) return upper

  const lower = sorted[middle - 1]
  return lower === undefined ? upper : (lower + upper) / 2
}

function spread(values: readonly number[]): number | null {
  if (values.length < 2) return null
  return Math.max(...values) - Math.min(...values)
}

function adjacentDelta(previous: FrameGeometry, current: FrameGeometry): AdjacentFrameDelta {
  const dx = current.centroid.x - previous.centroid.x
  const dy = current.centroid.y - previous.centroid.y

  return {
    dx,
    dy,
    distance: Math.hypot(dx, dy),
    areaDeltaPercent:
      (Math.abs(current.opaquePixels - previous.opaquePixels) /
        Math.max(current.opaquePixels, previous.opaquePixels)) *
      100,
  }
}

function motionVector(dx: number, dy: number): MotionVector {
  return { dx, dy, distance: Math.hypot(dx, dy) }
}

function rootMotion(frame: FrameEvidenceInput): { dx: number; dy: number } {
  return frame.rootMotion ?? { dx: 0, dy: 0 }
}

export function buildSequenceEvidence(
  inputs: readonly FrameEvidenceInput[],
  actionType: PlaytestActionType,
): SequenceReviewEvidence {
  const results = inputs.map((input) => input.geometry)
  const readyGeometries = results.flatMap((result) =>
    result.status === 'ready' ? [result.geometry] : [],
  )
  const policy = deriveLocalQualityPolicy(readyGeometries, actionType)
  const isBaselineGeometry = (geometry: FrameGeometry): boolean =>
    policy.expectedCanvas !== null &&
    geometry.width === policy.expectedCanvas.width &&
    geometry.height === policy.expectedCanvas.height
  const deltas = results.map((result, index): AdjacentFrameDelta | null => {
    const previous = results[index - 1]
    if (index === 0 || previous?.status !== 'ready' || result.status !== 'ready') return null
    if (!isBaselineGeometry(previous.geometry) || !isBaselineGeometry(result.geometry)) return null
    return adjacentDelta(previous.geometry, result.geometry)
  })
  const rootDeltas = inputs.map((input, index): MotionVector | null => {
    if (index === 0) return null

    const increment = rootMotion(input)
    return motionVector(increment.dx, increment.dy)
  })
  const availableDeltas = deltas.flatMap((delta) => (delta === null ? [] : [delta]))
  const steps = availableDeltas.map((delta) => delta.distance)
  const areaDeltas = availableDeltas.map((delta) => delta.areaDeltaPercent)
  const medianStep = median(steps)
  const movementMad = medianAbsoluteDeviation(steps, medianStep)
  const relativeMovementThreshold =
    medianStep === null
      ? null
      : Math.max(
          medianStep * 2.6 + policy.movementPadding,
          medianStep + (movementMad ?? 0) * 3 + policy.movementPadding,
          policy.movementFloor,
        )
  const movementThreshold =
    relativeMovementThreshold === null
      ? null
      : Math.min(relativeMovementThreshold, policy.movementCeiling)
  const maxStep = steps.length === 0 ? null : Math.max(...steps)
  const maxAreaDeltaPercent = areaDeltas.length === 0 ? null : Math.max(...areaDeltas)
  const baselineGeometries = readyGeometries.filter(isBaselineGeometry)
  const footDrift = spread(baselineGeometries.map((geometry) => geometry.footY))
  const heightDrift = spread(baselineGeometries.map((geometry) => geometry.subjectHeight))
  const unavailableFrameCount = results.length - readyGeometries.length
  const findings: QualityFinding[] = []
  const heightThreshold = policy.heightDriftThreshold

  const frames = results.map((result, index): FrameReviewEvidence => {
    const expectedRootDelta = rootDeltas[index] ?? null
    if (result.status === 'unavailable') {
      return {
        geometry: null,
        unavailableReason: result.reason,
        previousDelta: null,
        expectedRootDelta,
        composedPreviewDelta: null,
        canvasState: 'not_applicable',
        coverageState: 'not_applicable',
        movementState: 'not_applicable',
        areaState: 'not_applicable',
      }
    }

    const delta = deltas[index] ?? null
    const composedPreviewDelta =
      delta === null || expectedRootDelta === null
        ? null
        : motionVector(delta.dx + expectedRootDelta.dx, expectedRootDelta.dy - delta.dy)
    return {
      geometry: result.geometry,
      unavailableReason: null,
      previousDelta: delta,
      expectedRootDelta,
      composedPreviewDelta,
      canvasState:
        policy.expectedCanvas !== null &&
        result.geometry.width === policy.expectedCanvas.width &&
        result.geometry.height === policy.expectedCanvas.height
          ? 'normal'
          : 'anomaly',
      coverageState:
        result.geometry.coverageRatio < policy.minimumCoverageRatio ||
        result.geometry.coverageRatio > policy.maximumCoverageRatio
          ? 'anomaly'
          : 'normal',
      movementState:
        delta === null || movementThreshold === null
          ? 'not_applicable'
          : delta.distance > movementThreshold
            ? 'anomaly'
            : 'normal',
      areaState:
        delta === null
          ? 'not_applicable'
          : delta.areaDeltaPercent > policy.areaDeltaThresholdPercent
            ? 'anomaly'
            : 'normal',
    }
  })

  results.forEach((result, index) => {
    if (result.status === 'unavailable') {
      const blank = result.reason.includes('没有可见主体')
      findings.push({
        code: blank ? 'blank_subject' : 'image_unavailable',
        severity: 'error',
        frameIndex: index,
        message: blank ? '当前帧没有可见主体' : result.reason,
        metrics: {},
      })
      return
    }

    const { geometry } = result
    if (
      policy.expectedCanvas !== null &&
      (geometry.width !== policy.expectedCanvas.width ||
        geometry.height !== policy.expectedCanvas.height)
    ) {
      findings.push({
        code: 'canvas_size_mismatch',
        severity: 'error',
        frameIndex: index,
        message: '画布尺寸与当前序列基线不一致',
        metrics: {
          width: geometry.width,
          height: geometry.height,
          expectedWidth: policy.expectedCanvas.width,
          expectedHeight: policy.expectedCanvas.height,
        },
      })
    }
    if (isCropped(geometry, policy.edgeMargin)) {
      findings.push({
        code: 'subject_cropped',
        severity: 'error',
        frameIndex: index,
        message: '主体接触画布边缘，可能发生裁切',
        metrics: {
          left: geometry.bounds.left,
          top: geometry.bounds.top,
          right: geometry.bounds.right,
          bottom: geometry.bounds.bottom,
        },
      })
    }
    if (geometry.coverageRatio < policy.minimumCoverageRatio) {
      findings.push({
        code: 'coverage_too_low',
        severity: 'warning',
        frameIndex: index,
        message: '主体在画布中的占比过小',
        metrics: { coverageRatio: geometry.coverageRatio },
      })
    } else if (geometry.coverageRatio > policy.maximumCoverageRatio) {
      findings.push({
        code: 'coverage_too_high',
        severity: 'error',
        frameIndex: index,
        message: '主体在画布中的占比过大',
        metrics: { coverageRatio: geometry.coverageRatio },
      })
    }

    const previous = results[index - 1]
    if (previous?.status !== 'ready') return
    const duplicateDistance = fingerprintDistance(
      previous.geometry.fingerprint,
      geometry.fingerprint,
    )
    if (duplicateDistance !== null && duplicateDistance <= policy.duplicateDistance) {
      findings.push({
        code: 'duplicate_frame',
        severity: 'warning',
        frameIndex: index,
        message: '当前帧与上一帧高度相似',
        metrics: { distance: duplicateDistance },
      })
    }

    const delta = deltas[index]
    if (delta !== null && movementThreshold !== null && delta.distance > movementThreshold) {
      findings.push({
        code: 'motion_spike',
        severity: 'error',
        frameIndex: index,
        message: '相邻帧出现异常位移突变',
        metrics: { distance: delta.distance, threshold: movementThreshold },
      })
    }
    if (delta !== null && delta.areaDeltaPercent > policy.areaDeltaThresholdPercent) {
      findings.push({
        code: 'area_spike',
        severity: 'warning',
        frameIndex: index,
        message: '相邻帧主体轮廓面积变化过大',
        metrics: { percent: delta.areaDeltaPercent },
      })
    }

    const expected = rootDeltas[index]
    if (
      delta !== null &&
      expected !== null &&
      expected.distance >= policy.rootMotionDirectionMinimum &&
      delta.distance >= policy.rootMotionDirectionMinimum
    ) {
      const dot = delta.dx * expected.dx + -delta.dy * expected.dy
      if (dot < 0) {
        findings.push({
          code: 'root_motion_mismatch',
          severity: 'warning',
          frameIndex: index,
          message: '画面内位移方向与预期根位移矛盾',
          metrics: { dotProduct: dot },
        })
      }
    }
  })

  if (
    footDrift !== null &&
    policy.footDriftThreshold !== null &&
    footDrift > policy.footDriftThreshold &&
    actionType !== 'jump'
  ) {
    findings.push({
      code: 'foot_drift',
      severity: 'error',
      frameIndex: null,
      message: '序列脚底线漂移超过动作允许范围',
      metrics: { drift: footDrift, threshold: policy.footDriftThreshold },
    })
  }
  if (heightDrift !== null && heightThreshold !== null && heightDrift > heightThreshold) {
    findings.push({
      code: 'height_drift',
      severity: 'warning',
      frameIndex: null,
      message: '序列主体高度变化超过动作允许范围',
      metrics: { drift: heightDrift, threshold: heightThreshold },
    })
  }

  return {
    complete: results.length > 0 && unavailableFrameCount === 0,
    unavailableFrameCount,
    frames,
    findings,
    summary: {
      footDrift,
      heightDrift,
      medianStep,
      maxStep,
      movementThreshold,
      heightThreshold,
      footThreshold: policy.footDriftThreshold,
      areaThresholdPercent: policy.areaDeltaThresholdPercent,
      expectedCanvas: policy.expectedCanvas,
      maxAreaDeltaPercent,
      canvasState:
        policy.expectedCanvas === null
          ? 'not_applicable'
          : readyGeometries.every(
                (geometry) =>
                  geometry.width === policy.expectedCanvas?.width &&
                  geometry.height === policy.expectedCanvas?.height,
              )
            ? 'normal'
            : 'anomaly',
      footState:
        footDrift === null
          ? 'not_applicable'
          : policy.footDriftThreshold === null
            ? 'not_applicable'
            : footDrift <= policy.footDriftThreshold
              ? 'normal'
              : actionType === 'jump'
                ? 'attention'
                : 'anomaly',
      heightState:
        heightDrift === null
          ? 'not_applicable'
          : heightThreshold === null
            ? policy.heightAttentionThreshold !== null &&
              heightDrift > policy.heightAttentionThreshold
              ? 'attention'
              : 'normal'
            : heightDrift > heightThreshold
              ? 'anomaly'
              : 'normal',
      movementState:
        maxStep === null || movementThreshold === null
          ? 'not_applicable'
          : maxStep > movementThreshold
            ? 'anomaly'
            : 'normal',
      areaState:
        maxAreaDeltaPercent === null
          ? 'not_applicable'
          : maxAreaDeltaPercent > policy.areaDeltaThresholdPercent
            ? 'anomaly'
            : 'normal',
    },
  }
}
