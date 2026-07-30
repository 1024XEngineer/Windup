import type { PlaytestActionType } from '../model/types'
import type { FrameGeometry } from './frame-geometry'

export interface CanvasBaseline {
  width: number
  height: number
}

export interface LocalQualityPolicy {
  expectedCanvas: CanvasBaseline | null
  edgeMargin: { x: number; y: number }
  minimumCoverageRatio: number
  maximumCoverageRatio: number
  duplicateDistance: number
  footDriftThreshold: number | null
  heightDriftThreshold: number | null
  heightAttentionThreshold: number | null
  areaDeltaThresholdPercent: number
  movementPadding: number
  movementFloor: number
  movementCeiling: number
  rootMotionDirectionMinimum: number
}

const REFERENCE_CANVAS_SIZE = 256
const MINIMUM_COVERAGE_RATIO = 0.005
const MAXIMUM_COVERAGE_RATIO = 0.65
const DUPLICATE_DISTANCE = 0.02
const AREA_DELTA_THRESHOLD_PERCENT = 28

function scaledPixels(referencePixels: number, scale: number): number {
  return Number((referencePixels * scale).toFixed(4))
}

function inferCanvasBaseline(geometries: readonly FrameGeometry[]): CanvasBaseline | null {
  const candidates = new Map<
    string,
    { canvas: CanvasBaseline; count: number; firstIndex: number }
  >()

  geometries.forEach((geometry, index) => {
    const key = `${geometry.width}x${geometry.height}`
    const existing = candidates.get(key)
    if (existing) existing.count += 1
    else {
      candidates.set(key, {
        canvas: { width: geometry.width, height: geometry.height },
        count: 1,
        firstIndex: index,
      })
    }
  })

  const selected = [...candidates.values()].sort(
    (left, right) => right.count - left.count || left.firstIndex - right.firstIndex,
  )[0]
  return selected?.canvas ?? null
}

function heightReferencePixels(actionType: PlaytestActionType): number | null {
  if (actionType === 'jump' || actionType === 'crouch') return null
  if (actionType === 'idle') return 7
  if (actionType === 'walk') return 12
  return 20
}

function movementCeilingReferencePixels(actionType: PlaytestActionType): number {
  if (actionType === 'idle') return 6
  if (actionType === 'walk') return 24
  if (actionType === 'crouch') return 16
  if (actionType === 'jump') return 64
  return 48
}

/**
 * Keeps the existing local heuristics, but scales pixel thresholds from the sequence's dominant
 * canvas size. The 256px values are calibration references, not a required asset contract.
 */
export function deriveLocalQualityPolicy(
  geometries: readonly FrameGeometry[],
  actionType: PlaytestActionType,
): LocalQualityPolicy {
  const expectedCanvas = inferCanvasBaseline(geometries)
  if (expectedCanvas === null) {
    return {
      expectedCanvas: null,
      edgeMargin: { x: 1, y: 1 },
      minimumCoverageRatio: MINIMUM_COVERAGE_RATIO,
      maximumCoverageRatio: MAXIMUM_COVERAGE_RATIO,
      duplicateDistance: DUPLICATE_DISTANCE,
      footDriftThreshold: null,
      heightDriftThreshold: null,
      heightAttentionThreshold: null,
      areaDeltaThresholdPercent: AREA_DELTA_THRESHOLD_PERCENT,
      movementPadding: 2,
      movementFloor: 6,
      movementCeiling: movementCeilingReferencePixels(actionType),
      rootMotionDirectionMinimum: 2,
    }
  }

  const horizontalScale = expectedCanvas.width / REFERENCE_CANVAS_SIZE
  const verticalScale = expectedCanvas.height / REFERENCE_CANVAS_SIZE
  const distanceScale = Math.sqrt(horizontalScale * verticalScale)
  const heightReference = heightReferencePixels(actionType)

  return {
    expectedCanvas,
    edgeMargin: {
      x: Math.max(1, scaledPixels(2, horizontalScale)),
      y: Math.max(1, scaledPixels(2, verticalScale)),
    },
    minimumCoverageRatio: MINIMUM_COVERAGE_RATIO,
    maximumCoverageRatio: MAXIMUM_COVERAGE_RATIO,
    duplicateDistance: DUPLICATE_DISTANCE,
    footDriftThreshold: scaledPixels(3, verticalScale),
    heightDriftThreshold:
      heightReference === null ? null : scaledPixels(heightReference, verticalScale),
    heightAttentionThreshold: scaledPixels(7, verticalScale),
    areaDeltaThresholdPercent: AREA_DELTA_THRESHOLD_PERCENT,
    movementPadding: scaledPixels(2, distanceScale),
    movementFloor: scaledPixels(6, distanceScale),
    movementCeiling: scaledPixels(movementCeilingReferencePixels(actionType), distanceScale),
    rootMotionDirectionMinimum: scaledPixels(2, distanceScale),
  }
}
