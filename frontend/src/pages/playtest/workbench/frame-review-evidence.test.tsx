/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { FrameReviewEvidenceState } from './analysis/use-frame-review-evidence'
import { FrameReviewEvidencePanel } from './frame-review-evidence'

const readyState: FrameReviewEvidenceState = {
  status: 'ready',
  evidence: {
    complete: true,
    unavailableFrameCount: 0,
    findings: [],
    frames: [
      {
        geometry: {
          width: 256,
          height: 256,
          bounds: { left: 80, top: 30, right: 175, bottom: 236, width: 96, height: 207 },
          centroid: { x: 127, y: 140 },
          footY: 236,
          subjectHeight: 207,
          opaquePixels: 12_000,
          coverageRatio: 0.1831,
        },
        unavailableReason: null,
        previousDelta: null,
        expectedRootDelta: null,
        composedPreviewDelta: null,
        canvasState: 'normal',
        coverageState: 'normal',
        movementState: 'not_applicable',
        areaState: 'not_applicable',
      },
      {
        geometry: {
          width: 256,
          height: 256,
          bounds: { left: 83, top: 31, right: 174, bottom: 237, width: 92, height: 207 },
          centroid: { x: 130, y: 144 },
          footY: 237,
          subjectHeight: 207,
          opaquePixels: 9_600,
          coverageRatio: 0.1465,
        },
        unavailableReason: null,
        previousDelta: { dx: 3, dy: 4, distance: 5, areaDeltaPercent: 20 },
        expectedRootDelta: { dx: 10, dy: 6, distance: Math.sqrt(136) },
        composedPreviewDelta: { dx: 13, dy: 2, distance: Math.sqrt(173) },
        canvasState: 'normal',
        coverageState: 'normal',
        movementState: 'normal',
        areaState: 'normal',
      },
    ],
    summary: {
      footDrift: 1,
      heightDrift: 0,
      medianStep: 5,
      maxStep: 5,
      movementThreshold: 15,
      heightThreshold: 12,
      footThreshold: 3,
      areaThresholdPercent: 28,
      expectedCanvas: { width: 256, height: 256 },
      maxAreaDeltaPercent: 20,
      canvasState: 'normal',
      footState: 'normal',
      heightState: 'normal',
      movementState: 'normal',
      areaState: 'normal',
    },
  },
}

afterEach(cleanup)

describe('FrameReviewEvidencePanel', () => {
  it('keeps analysis loading distinct from measured zero values', () => {
    // Catches the right panel presenting fabricated zero evidence before image decoding completes.
    render(
      <FrameReviewEvidencePanel
        state={{ status: 'loading', evidence: null }}
        frameIndex={0}
        actionType="walk"
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('分析中')
    expect(screen.queryByText(/0\.0 px/)).toBeNull()
  })

  it('shows measured drift, expected root increment and composed preview motion separately', () => {
    // Catches expected motion and in-image drift being merged into one misleading number.
    render(<FrameReviewEvidencePanel state={readyState} frameIndex={1} actionType="walk" />)

    expect(screen.getByRole('region', { name: '自动审核依据' })).toBeTruthy()
    expect(screen.getByText('画面内额外漂移')).toBeTruthy()
    expect(screen.getByText('x +3.0 px，y +4.0 px，距离 5.0 px')).toBeTruthy()
    expect(screen.getByText('预期根位移增量')).toBeTruthy()
    expect(screen.getByText('x +10.0 px，y +6.0 px，距离 11.7 px')).toBeTruthy()
    expect(screen.getByText('合成预览位移')).toBeTruthy()
    expect(screen.getByText('x +13.0 px，y +2.0 px，距离 13.2 px')).toBeTruthy()
    expect(screen.getByText('脚底线')).toBeTruthy()
    expect(screen.getByText('237 px')).toBeTruthy()
    expect(screen.getByText('主体高度')).toBeTruthy()
    expect(screen.getByText('207 px')).toBeTruthy()
    expect(screen.getByText('画布尺寸')).toBeTruthy()
    expect(screen.getByText('256 × 256 px')).toBeTruthy()
    expect(screen.getByText('轮廓面积变化')).toBeTruthy()
    expect(screen.getByText('20.0%')).toBeTruthy()
    expect(screen.getByText('序列基线')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('shows the inferred canvas baseline and scaled pixel thresholds', () => {
    const scaledState: FrameReviewEvidenceState = {
      status: 'ready',
      evidence: {
        ...readyState.evidence!,
        frames: readyState.evidence!.frames.map((frame) => ({
          ...frame,
          geometry: frame.geometry === null ? null : { ...frame.geometry, width: 512, height: 512 },
        })),
        summary: {
          ...readyState.evidence!.summary,
          expectedCanvas: { width: 512, height: 512 },
          footThreshold: 6,
          heightThreshold: 24,
        },
      },
    }

    render(<FrameReviewEvidencePanel state={scaledState} frameIndex={1} actionType="walk" />)

    expect(screen.getByText('512 × 512 px')).toBeTruthy()
    expect(screen.getByText('序列基线 512 × 512')).toBeTruthy()
    expect(screen.getByText('1.0 px / 阈值 6.0 px')).toBeTruthy()
    expect(screen.getByText('0.0 px / 阈值 24.0 px')).toBeTruthy()
  })

  it('does not fabricate an adjacent comparison for the first frame', () => {
    // Catches first-frame null deltas being displayed as a successful zero movement.
    render(<FrameReviewEvidencePanel state={readyState} frameIndex={0} actionType="walk" />)

    expect(screen.getAllByText('相邻对比不适用')).toHaveLength(3)
  })

  it('explains that jump foot drift requires human judgement instead of failing it', () => {
    // Catches intentional lift being shown as an ordinary foot-anchor anomaly.
    const jumpState: FrameReviewEvidenceState = {
      status: 'ready',
      evidence: {
        ...readyState.evidence!,
        summary: {
          ...readyState.evidence!.summary,
          footDrift: 42,
          footState: 'attention',
        },
      },
    }

    render(<FrameReviewEvidencePanel state={jumpState} frameIndex={1} actionType="jump" />)

    expect(screen.getByText('42.0 px / 本序列阈值 3.0 px；允许离地，需人工判断')).toBeTruthy()
  })

  it('explains action-allowed jump height variation without a false anomaly', () => {
    const jumpState: FrameReviewEvidenceState = {
      status: 'ready',
      evidence: {
        ...readyState.evidence!,
        summary: {
          ...readyState.evidence!.summary,
          heightDrift: 42,
          heightThreshold: null,
          heightState: 'attention',
        },
      },
    }

    render(<FrameReviewEvidencePanel state={jumpState} frameIndex={1} actionType="jump" />)

    expect(screen.getByText('42.0 px / 动作允许高度变化，需人工判断')).toBeTruthy()
    expect(screen.getAllByText('注意').length).toBeGreaterThan(0)
  })

  it('shows the exact unavailable reason without disabling the rest of Playtest', () => {
    // Catches cross-origin failures being converted to a normal geometry result.
    const unavailableState: FrameReviewEvidenceState = {
      status: 'ready',
      evidence: {
        ...readyState.evidence!,
        complete: false,
        unavailableFrameCount: 1,
        frames: [
          {
            geometry: null,
            unavailableReason: '图片跨域，无法计算像素',
            previousDelta: null,
            expectedRootDelta: null,
            composedPreviewDelta: null,
            canvasState: 'not_applicable',
            coverageState: 'not_applicable',
            movementState: 'not_applicable',
            areaState: 'not_applicable',
          },
        ],
      },
    }

    render(<FrameReviewEvidencePanel state={unavailableState} frameIndex={0} actionType="walk" />)

    expect(screen.getByText('无法计算：图片跨域，无法计算像素')).toBeTruthy()
    expect(screen.getByText('1 帧无法计算，序列结论不完整')).toBeTruthy()
  })

  it('renders structured findings with severity and frame location', () => {
    const findingState: FrameReviewEvidenceState = {
      status: 'ready',
      evidence: {
        ...readyState.evidence!,
        complete: false,
        unavailableFrameCount: 1,
        findings: [
          {
            code: 'subject_cropped',
            severity: 'error',
            frameIndex: 1,
            message: '主体接触画布边缘，可能发生裁切',
            metrics: { left: 0 },
          },
        ],
      },
    }

    render(<FrameReviewEvidencePanel state={findingState} frameIndex={1} actionType="walk" />)

    expect(screen.getByText('分析不完整')).toBeTruthy()
    expect(screen.getByText('主体接触画布边缘，可能发生裁切')).toBeTruthy()
    expect(screen.getByText('第 2 帧')).toBeTruthy()
    expect(screen.getByText('错误')).toBeTruthy()
  })
})
