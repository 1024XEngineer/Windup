import type { Frame } from '@/entities/character'

import type { PlaytestActionType } from '../model/types'
import type { FrameGeometry } from './frame-geometry'

const EXPECTED_CANVAS_SIZE = 256
const MAX_COVERAGE_RATIO = 0.65
const MAX_FOOT_DRIFT = 3
const MAX_HEIGHT_DRIFT = 7
const MAX_AREA_DELTA_PERCENT = 28
const MIN_COVERAGE_RATIO = 0.005
const DUPLICATE_DISTANCE = 0.02

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

function isCropped(geometry: FrameGeometry): boolean {
  return (
    geometry.bounds.left <= 1 ||
    geometry.bounds.top <= 1 ||
    geometry.bounds.right >= geometry.width - 2 ||
    geometry.bounds.bottom >= geometry.height - 2
  )
}

function heightFindingThreshold(actionType: PlaytestActionType): number | null {
  if (actionType === 'jump' || actionType === 'crouch') return null
  if (actionType === 'idle') return 7
  if (actionType === 'walk') return 12
  return 20
}

function absoluteMovementThreshold(actionType: PlaytestActionType): number {
  if (actionType === 'idle') return 6
  if (actionType === 'walk') return 24
  if (actionType === 'crouch') return 16
  if (actionType === 'jump') return 64
  return 48
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
  const deltas = results.map((result, index): AdjacentFrameDelta | null => {
    const previous = results[index - 1]
    if (index === 0 || previous?.status !== 'ready' || result.status !== 'ready') return null
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
      : Math.max(medianStep * 2.6 + 2, medianStep + (movementMad ?? 0) * 3 + 2, 6)
  const movementThreshold =
    relativeMovementThreshold === null
      ? null
      : Math.min(relativeMovementThreshold, absoluteMovementThreshold(actionType))
  const maxStep = steps.length === 0 ? null : Math.max(...steps)
  const maxAreaDeltaPercent = areaDeltas.length === 0 ? null : Math.max(...areaDeltas)
  const footDrift = spread(readyGeometries.map((geometry) => geometry.footY))
  const heightDrift = spread(readyGeometries.map((geometry) => geometry.subjectHeight))
  const unavailableFrameCount = results.length - readyGeometries.length
  const findings: QualityFinding[] = []
  const heightThreshold = heightFindingThreshold(actionType)

  const frames = results.map((result, index): FrameReviewEvidence => {
    const expectedRootDelta = rootDeltas[index] ?? null
    if (result.status === 'unavailable') {
      return {
        geometry: null,
        unavailableReason: result.reason,
        previousDelta: null,
        expectedRootDelta,
        composedPreviewDelta: null,
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
      coverageState: result.geometry.coverageRatio > MAX_COVERAGE_RATIO ? 'anomaly' : 'normal',
      movementState:
        delta === null || movementThreshold === null
          ? 'not_applicable'
          : delta.distance > movementThreshold
            ? 'anomaly'
            : 'normal',
      areaState:
        delta === null
          ? 'not_applicable'
          : delta.areaDeltaPercent > MAX_AREA_DELTA_PERCENT
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
    if (geometry.width !== EXPECTED_CANVAS_SIZE || geometry.height !== EXPECTED_CANVAS_SIZE) {
      findings.push({
        code: 'canvas_size_mismatch',
        severity: 'error',
        frameIndex: index,
        message: '画布尺寸与预期规格不一致',
        metrics: { width: geometry.width, height: geometry.height },
      })
    }
    if (isCropped(geometry)) {
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
    if (geometry.coverageRatio < MIN_COVERAGE_RATIO) {
      findings.push({
        code: 'coverage_too_low',
        severity: 'warning',
        frameIndex: index,
        message: '主体在画布中的占比过小',
        metrics: { coverageRatio: geometry.coverageRatio },
      })
    } else if (geometry.coverageRatio > MAX_COVERAGE_RATIO) {
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
    if (duplicateDistance !== null && duplicateDistance <= DUPLICATE_DISTANCE) {
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
    if (delta !== null && delta.areaDeltaPercent > MAX_AREA_DELTA_PERCENT) {
      findings.push({
        code: 'area_spike',
        severity: 'warning',
        frameIndex: index,
        message: '相邻帧主体轮廓面积变化过大',
        metrics: { percent: delta.areaDeltaPercent },
      })
    }

    const expected = rootDeltas[index]
    if (delta !== null && expected !== null && expected.distance >= 2 && delta.distance >= 2) {
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

  if (footDrift !== null && footDrift > MAX_FOOT_DRIFT && actionType !== 'jump') {
    findings.push({
      code: 'foot_drift',
      severity: 'error',
      frameIndex: null,
      message: '序列脚底线漂移超过动作允许范围',
      metrics: { drift: footDrift, threshold: MAX_FOOT_DRIFT },
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
      maxAreaDeltaPercent,
      canvasState:
        readyGeometries.length === 0
          ? 'not_applicable'
          : readyGeometries.every(
                (geometry) =>
                  geometry.width === EXPECTED_CANVAS_SIZE &&
                  geometry.height === EXPECTED_CANVAS_SIZE,
              )
            ? 'normal'
            : 'anomaly',
      footState:
        footDrift === null
          ? 'not_applicable'
          : footDrift <= MAX_FOOT_DRIFT
            ? 'normal'
            : actionType === 'jump'
              ? 'attention'
              : 'anomaly',
      heightState:
        heightDrift === null
          ? 'not_applicable'
          : heightThreshold === null
            ? heightDrift > MAX_HEIGHT_DRIFT
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
          : maxAreaDeltaPercent > MAX_AREA_DELTA_PERCENT
            ? 'anomaly'
            : 'normal',
    },
  }
}
