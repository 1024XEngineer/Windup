import { describe, expect, it } from 'vitest'

import type { FrameGeometry } from './frame-geometry'
import { buildSequenceEvidence, type FrameEvidenceInput } from './sequence-evidence'

function geometry(
  overrides: Partial<
    Pick<
      FrameGeometry,
      'width' | 'height' | 'footY' | 'subjectHeight' | 'opaquePixels' | 'coverageRatio'
    >
  > & { x?: number; y?: number; fingerprint?: readonly number[]; cropped?: boolean } = {},
): FrameGeometry {
  const subjectHeight = overrides.subjectHeight ?? 20

  return {
    width: overrides.width ?? 256,
    height: overrides.height ?? 256,
    bounds: {
      left: overrides.cropped ? 0 : 100,
      top: overrides.cropped ? 0 : 100,
      right: overrides.cropped ? 9 : 109,
      bottom: overrides.cropped ? subjectHeight - 1 : 100 + subjectHeight - 1,
      width: 10,
      height: subjectHeight,
    },
    centroid: { x: overrides.x ?? 0, y: overrides.y ?? 0 },
    footY: overrides.footY ?? 100,
    subjectHeight,
    opaquePixels: overrides.opaquePixels ?? 100,
    coverageRatio: overrides.coverageRatio ?? 0.25,
    fingerprint: overrides.fingerprint,
  }
}

function ready(
  value: FrameGeometry,
  rootMotion: FrameEvidenceInput['rootMotion'] = null,
): FrameEvidenceInput {
  return { geometry: { status: 'ready', geometry: value }, rootMotion }
}

describe('buildSequenceEvidence', () => {
  it('returns structured findings for incomplete, cropped and duplicate frames', () => {
    const fingerprint = Array.from({ length: 64 }, (_, index) => index / 64)
    const evidence = buildSequenceEvidence(
      [
        ready(geometry({ cropped: true, fingerprint })),
        ready(geometry({ fingerprint })),
        { geometry: { status: 'unavailable', reason: '图片没有可见主体' }, rootMotion: null },
      ],
      'walk',
    )

    expect(evidence.complete).toBe(false)
    expect(evidence.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['subject_cropped', 'duplicate_frame', 'blank_subject']),
    )
    expect(evidence.findings.find((finding) => finding.code === 'duplicate_frame')).toMatchObject({
      frameIndex: 1,
      severity: 'warning',
    })
  })

  it('uses action-aware findings for foot and height changes', () => {
    const frames = [
      ready(geometry({ footY: 100, subjectHeight: 30 })),
      ready(geometry({ footY: 112, subjectHeight: 15 })),
    ]

    expect(buildSequenceEvidence(frames, 'idle').findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['foot_drift', 'height_drift']),
    )
    expect(
      buildSequenceEvidence(frames, 'jump').findings.map((finding) => finding.code),
    ).not.toContain('foot_drift')
    expect(
      buildSequenceEvidence(frames, 'crouch').findings.map((finding) => finding.code),
    ).not.toContain('height_drift')
  })

  it('flags motion outliers and root-motion direction contradictions', () => {
    const evidence = buildSequenceEvidence(
      [
        ready(geometry({ x: 0 })),
        ready(geometry({ x: 1 }), { dx: 1, dy: 0 }),
        ready(geometry({ x: 2 }), { dx: 1, dy: 0 }),
        ready(geometry({ x: -18 }), { dx: 5, dy: 0 }),
      ],
      'walk',
    )

    expect(evidence.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['motion_spike', 'root_motion_mismatch']),
    )
  })

  it('calculates a selected frame delta and the hand-derived sequence baseline', () => {
    // Catches image-derived offsets being calculated from bounds or against the first frame instead of the previous frame.
    const evidence = buildSequenceEvidence(
      [ready(geometry()), ready(geometry({ x: 3, y: 4, opaquePixels: 80 }))],
      'walk',
    )

    expect(evidence.frames[0]?.previousDelta).toBeNull()
    expect(evidence.frames[1]?.previousDelta).toEqual({
      dx: 3,
      dy: 4,
      distance: 5,
      areaDeltaPercent: 20,
    })
    expect(evidence.summary).toMatchObject({
      medianStep: 5,
      maxStep: 5,
      movementThreshold: 15,
      maxAreaDeltaPercent: 20,
      movementState: 'normal',
      areaState: 'normal',
    })
  })

  it('infers a consistent canvas baseline instead of requiring 256 pixels', () => {
    const evidence = buildSequenceEvidence(
      [
        ready(geometry({ width: 512, height: 512, footY: 200, subjectHeight: 40 })),
        ready(geometry({ width: 512, height: 512, footY: 205, subjectHeight: 60 })),
      ],
      'walk',
    )

    expect(evidence.findings.map((finding) => finding.code)).not.toContain('canvas_size_mismatch')
    expect(evidence.summary).toMatchObject({
      expectedCanvas: { width: 512, height: 512 },
      footThreshold: 6,
      heightThreshold: 24,
      footState: 'normal',
      heightState: 'normal',
    })
  })

  it('flags only frames that disagree with the locally inferred canvas baseline', () => {
    const evidence = buildSequenceEvidence(
      [
        ready(geometry({ width: 512, height: 512 })),
        ready(geometry({ width: 512, height: 512 })),
        ready(geometry({ width: 256, height: 256 })),
      ],
      'idle',
    )

    expect(
      evidence.findings
        .filter((finding) => finding.code === 'canvas_size_mismatch')
        .map((finding) => finding.frameIndex),
    ).toEqual([2])
    expect(evidence.summary.expectedCanvas).toEqual({ width: 512, height: 512 })
    expect(evidence.frames[2]?.previousDelta).toBeNull()
    expect(evidence.findings.map((finding) => finding.code)).not.toContain('motion_spike')
  })

  it('excludes non-baseline canvas frames from sequence-level measurements', () => {
    const evidence = buildSequenceEvidence(
      [
        ready(geometry({ width: 512, height: 512, footY: 200, subjectHeight: 40 })),
        ready(geometry({ width: 512, height: 512, footY: 205, subjectHeight: 42 })),
        ready(geometry({ width: 512, height: 512, footY: 202, subjectHeight: 41 })),
        ready(geometry({ width: 256, height: 256, footY: 100, subjectHeight: 10 })),
        ready(geometry({ width: 256, height: 256, footY: 120, subjectHeight: 20 })),
      ],
      'walk',
    )

    expect(evidence.summary).toMatchObject({
      expectedCanvas: { width: 512, height: 512 },
      footDrift: 5,
      heightDrift: 2,
    })
    expect(evidence.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['canvas_size_mismatch']),
    )
    expect(evidence.findings.map((finding) => finding.code)).not.toContain('foot_drift')
  })

  it('scales the local motion floor with the inferred canvas size', () => {
    const evidence = buildSequenceEvidence(
      [
        ready(geometry({ width: 512, height: 512, x: 0 })),
        ready(geometry({ width: 512, height: 512, x: 2 })),
        ready(geometry({ width: 512, height: 512, x: 4 })),
        ready(geometry({ width: 512, height: 512, x: 14 })),
      ],
      'walk',
    )

    expect(evidence.summary).toMatchObject({
      maxStep: 10,
      movementThreshold: 12,
      movementState: 'normal',
    })
    expect(evidence.findings.map((finding) => finding.code)).not.toContain('motion_spike')
  })

  it('does not compare across an unreadable middle frame', () => {
    // Catches filtered valid frames becoming false neighbours and producing a misleading offset.
    const evidence = buildSequenceEvidence(
      [
        ready(geometry()),
        { geometry: { status: 'unavailable', reason: '图片加载失败' }, rootMotion: null },
        ready(geometry({ x: 20, y: 20 })),
      ],
      'walk',
    )

    expect(evidence.complete).toBe(false)
    expect(evidence.unavailableFrameCount).toBe(1)
    expect(evidence.frames.map((frame) => frame.previousDelta)).toEqual([null, null, null])
    expect(evidence.summary.medianStep).toBeNull()
    expect(evidence.summary.movementState).toBe('not_applicable')
  })

  it('marks excessive coverage, foot drift and height drift with action-aware states', () => {
    // Catches jump lift being rejected as foot drift or foreground/background problems being hidden.
    const frames = [
      ready(geometry({ footY: 100, subjectHeight: 20, coverageRatio: 0.66 })),
      ready(geometry({ footY: 104, subjectHeight: 28 })),
    ]

    const walk = buildSequenceEvidence(frames, 'walk')
    const jump = buildSequenceEvidence(frames, 'jump')

    expect(walk.frames[0]?.coverageState).toBe('anomaly')
    expect(walk.summary).toMatchObject({
      footDrift: 4,
      heightDrift: 8,
      footState: 'anomaly',
      heightThreshold: 12,
      heightState: 'normal',
    })
    expect(jump.summary.footState).toBe('attention')
  })

  it('flags a single movement spike against the sequence median', () => {
    // Catches a sudden position jump being normalized away by the animation's ordinary movement.
    const evidence = buildSequenceEvidence(
      [
        ready(geometry({ x: 0 })),
        ready(geometry({ x: 1 })),
        ready(geometry({ x: 2 })),
        ready(geometry({ x: 22 })),
      ],
      'walk',
    )

    expect(evidence.summary).toMatchObject({
      medianStep: 1,
      maxStep: 20,
      movementThreshold: 6,
      movementState: 'anomaly',
    })
    expect(evidence.frames.map((frame) => frame.movementState)).toEqual([
      'not_applicable',
      'normal',
      'normal',
      'anomaly',
    ])
  })

  it('keeps an action-aware absolute movement ceiling when every step is large', () => {
    // Catches an entire drifting sequence normalizing its own 100px jumps through the median.
    const evidence = buildSequenceEvidence(
      [ready(geometry({ x: 0 })), ready(geometry({ x: 100 })), ready(geometry({ x: 200 }))],
      'walk',
    )

    expect(evidence.summary.movementThreshold).toBeLessThan(100)
    expect(evidence.summary.movementState).toBe('anomaly')
    expect(evidence.findings.map((finding) => finding.code)).toContain('motion_spike')
  })

  it('marks jump and crouch height variation as action-allowed attention', () => {
    const frames = [ready(geometry({ subjectHeight: 20 })), ready(geometry({ subjectHeight: 60 }))]

    for (const actionType of ['jump', 'crouch'] as const) {
      const evidence = buildSequenceEvidence(frames, actionType)
      expect(evidence.summary.heightThreshold).toBeNull()
      expect(evidence.summary.heightState).toBe('attention')
      expect(evidence.findings.map((finding) => finding.code)).not.toContain('height_drift')
    }
  })

  it('flags adjacent outline area changes over 28 percent', () => {
    // Catches a character silhouette abruptly shrinking without a visible review warning.
    const evidence = buildSequenceEvidence(
      [ready(geometry({ opaquePixels: 100 })), ready(geometry({ opaquePixels: 70 }))],
      'attack',
    )

    expect(evidence.summary).toMatchObject({
      maxAreaDeltaPercent: 30,
      areaState: 'anomaly',
    })
    expect(evidence.frames[1]?.areaState).toBe('anomaly')
  })

  it('marks adjacency-only checks not applicable for one frame', () => {
    // Catches the first frame displaying fabricated zero deltas as a successful comparison.
    const evidence = buildSequenceEvidence([ready(geometry())], 'idle')

    expect(evidence.frames[0]).toMatchObject({
      previousDelta: null,
      movementState: 'not_applicable',
      areaState: 'not_applicable',
    })
    expect(evidence.summary).toMatchObject({
      footDrift: null,
      heightDrift: null,
      medianStep: null,
      movementThreshold: null,
      movementState: 'not_applicable',
      areaState: 'not_applicable',
    })
  })

  it('combines measured image drift with adjacent root-motion increments using an upward y axis', () => {
    // Catches root motion being subtracted twice or image-space positive-down y being added as positive-up.
    const evidence = buildSequenceEvidence(
      [ready(geometry({ x: 0, y: 10 }), null), ready(geometry({ x: 3, y: 14 }), { dx: 10, dy: 6 })],
      'walk',
    )

    expect(evidence.frames[0]).toMatchObject({
      expectedRootDelta: null,
      composedPreviewDelta: null,
    })
    expect(evidence.frames[1]?.expectedRootDelta).toMatchObject({ dx: 10, dy: 6 })
    expect(evidence.frames[1]?.expectedRootDelta?.distance).toBeCloseTo(Math.sqrt(136))
    expect(evidence.frames[1]?.composedPreviewDelta).toMatchObject({ dx: 13, dy: 2 })
    expect(evidence.frames[1]?.composedPreviewDelta?.distance).toBeCloseTo(Math.sqrt(173))
    expect(evidence.frames[1]?.movementState).toBe('normal')
  })

  it('treats each frame root motion as an increment instead of subtracting the previous frame', () => {
    // Catches repeated per-frame dx values collapsing to zero and leaving a walking sprite in place.
    const evidence = buildSequenceEvidence(
      [
        ready(geometry({ x: 0, y: 10 }), null),
        ready(geometry({ x: 1, y: 11 }), { dx: 2, dy: 1 }),
        ready(geometry({ x: 3, y: 12 }), { dx: 3, dy: 2 }),
      ],
      'walk',
    )

    expect(evidence.frames[2]?.expectedRootDelta).toMatchObject({ dx: 3, dy: 2 })
    expect(evidence.frames[2]?.composedPreviewDelta).toMatchObject({ dx: 5, dy: 1 })
  })
})
