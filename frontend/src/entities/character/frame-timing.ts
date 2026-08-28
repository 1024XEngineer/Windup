export interface AnimationTimingFrame {
  readonly durationMs: number | null
}

export interface AnimationTimingAction {
  readonly type: string
  readonly loop: boolean
  readonly fps: number
}

const DEFAULT_FRAME_DURATION_MS = 100
const DENSE_GENERATED_TIMING: Readonly<
  Record<
    string,
    {
      readonly frameCount: number
      readonly sourceFrameDurationsMs: readonly number[]
      readonly cycleDurationMs: number
      readonly loopOnly: boolean
    }
  >
> = {
  idle: {
    frameCount: 12,
    sourceFrameDurationsMs: [125, 450],
    cycleDurationMs: 1000,
    loopOnly: true,
  },
  walk: {
    frameCount: 32,
    sourceFrameDurationsMs: [125],
    cycleDurationMs: 1000,
    loopOnly: true,
  },
  run: {
    frameCount: 32,
    sourceFrameDurationsMs: [90],
    cycleDurationMs: 720,
    loopOnly: true,
  },
  jump: {
    frameCount: 32,
    sourceFrameDurationsMs: [110],
    cycleDurationMs: 1000,
    loopOnly: false,
  },
  attack: {
    frameCount: 32,
    sourceFrameDurationsMs: [90],
    cycleDurationMs: 1000,
    loopOnly: false,
  },
}

function authoredFrameDuration(durationMs: number | null, fps: number): number {
  if (durationMs !== null && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.max(1, durationMs)
  }
  if (Number.isFinite(fps) && fps > 0) return Math.max(1, Math.round(1000 / fps))
  return DEFAULT_FRAME_DURATION_MS
}

/** 预览、导出和引擎适配共用的唯一逐帧时长解析规则。 */
export function resolveAnimationFrameDurations(
  action: AnimationTimingAction,
  frames: readonly AnimationTimingFrame[],
): readonly number[] {
  const durations = frames.map((frame) => authoredFrameDuration(frame.durationMs, action.fps))
  const denseTiming = DENSE_GENERATED_TIMING[action.type]
  const sourceFrameDurationMs = frames[0]?.durationMs
  if (
    denseTiming === undefined ||
    (denseTiming.loopOnly && !action.loop) ||
    frames.length !== denseTiming.frameCount ||
    !denseTiming.sourceFrameDurationsMs.some(
      (sourceDurationMs) => sourceFrameDurationMs === sourceDurationMs,
    ) ||
    frames.some((frame) => frame.durationMs !== sourceFrameDurationMs)
  ) {
    return durations
  }

  const timingScale =
    denseTiming.cycleDurationMs / durations.reduce((total, duration) => total + duration, 0)
  return durations.map((duration) => duration * timingScale)
}
