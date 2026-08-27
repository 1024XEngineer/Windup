import type { ActionDirection, ActionType, Character, Frame } from '@/entities'

export interface PlaytestFrame {
  readonly imageUrl: string
  readonly durationMs: number
}

export interface PlaytestPlayback {
  readonly frames: readonly PlaytestFrame[]
  readonly sourceDirection: ActionDirection
  readonly mirrorX: boolean
}

export interface PlaytestAction {
  readonly id: string
  readonly name: string
  readonly type: ActionType
  readonly locomotion?: true
  /** 一次性动作播完停在末帧；只有循环动作才回到首帧。 */
  readonly loop: boolean
  /** 每个逻辑方向解析到真实源帧和渲染镜像标记。 */
  readonly sequences?: Readonly<Partial<Record<ActionDirection, PlaytestPlayback>>>
  /** 旧调用方的侧向播放序列；只允许 legacy 顶层帧或真实 east 帧。 */
  readonly frames: readonly PlaytestFrame[]
}

export interface PlaytestModel {
  readonly characterId: string
  readonly outfitName: string
  readonly actions: readonly PlaytestAction[]
}

export function hasPlayableFrames(action: PlaytestAction): boolean {
  return (
    action.frames.length > 0 ||
    Object.values(action.sequences ?? {}).some((playback) => (playback?.frames.length ?? 0) > 0)
  )
}

/** 新资产使用显式语义；walk/run 保留为旧资产兼容入口。 */
export function isLocomotionAction(action: PlaytestAction): boolean {
  return action.locomotion === true || action.type === 'walk' || action.type === 'run'
}

export type PlaytestModelResult =
  | { readonly ok: true; readonly model: PlaytestModel }
  | { readonly ok: false; readonly reason: 'outfit_not_found' }

const DEFAULT_FRAME_DURATION_MS = 100
const DENSE_GENERATED_TIMING = {
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
} as const

function frameDuration(durationMs: number | null, fps: number): number {
  if (durationMs !== null && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.max(1, durationMs)
  }
  if (Number.isFinite(fps) && fps > 0) return Math.max(1, Math.round(1000 / fps))
  return DEFAULT_FRAME_DURATION_MS
}

/**
 * 播放顺序由 Frame.index 决定，不是数组下标。
 * 后端整棵下发资产树，数组顺序没有被契约保证；照数组播的话，顺序一变动画就乱，
 * 而且乱得不报错。排序在这里做一次，运行时之后只按数组下标推进。
 */
function orderedFrames(frames: readonly Frame[]): readonly Frame[] {
  return [...frames].sort((left, right) => left.index - right.index)
}

function playtestFrames(
  action: Character['outfits'][number]['actions'][number],
  frames: readonly Frame[],
): readonly PlaytestFrame[] {
  const ordered = orderedFrames(frames)
  const playbackFrames = ordered.map((frame) => ({
    imageUrl: frame.imageUrl,
    durationMs: frameDuration(frame.durationMs, action.fps),
  }))
  const denseTiming =
    action.type === 'idle' ||
    action.type === 'walk' ||
    action.type === 'run' ||
    action.type === 'jump' ||
    action.type === 'attack'
      ? DENSE_GENERATED_TIMING[action.type]
      : undefined
  const sourceFrameDurationMs = ordered[0]?.durationMs
  // 只兼容生成器已知的密集帧形状。默认非走动动作与 walk 共用 1 秒播放周期；
  // 帧数、循环性或任一原始时值不完全匹配时仍尊重资产合同，避免误改用户编排。
  if (
    denseTiming === undefined ||
    (denseTiming.loopOnly && !action.loop) ||
    ordered.length !== denseTiming.frameCount ||
    !denseTiming.sourceFrameDurationsMs.some(
      (sourceDurationMs) => sourceFrameDurationMs === sourceDurationMs,
    ) ||
    ordered.some((frame) => frame.durationMs !== sourceFrameDurationMs)
  ) {
    return playbackFrames
  }

  const timingScale =
    denseTiming.cycleDurationMs /
    playbackFrames.reduce((total, frame) => total + frame.durationMs, 0)
  return playbackFrames.map((frame) => ({
    ...frame,
    durationMs: frame.durationMs * timingScale,
  }))
}

function playtestSequences(
  action: Character['outfits'][number]['actions'][number],
): Partial<Record<ActionDirection, PlaytestPlayback>> {
  const sequences: Partial<Record<ActionDirection, PlaytestPlayback>> = {}

  for (const sequence of action.sequences ?? []) {
    if (sequence.sourceDirection !== null) continue
    const frames = playtestFrames(action, sequence.frames)
    if (frames.length === 0) continue
    sequences[sequence.direction] = {
      frames,
      sourceDirection: sequence.direction,
      mirrorX: false,
    }
  }

  const legacyEast = playtestFrames(action, action.frames)
  if (sequences.east === undefined && legacyEast.length > 0) {
    sequences.east = { frames: legacyEast, sourceDirection: 'east', mirrorX: false }
    sequences.west = { frames: legacyEast, sourceDirection: 'east', mirrorX: true }
  }

  for (const sequence of action.sequences ?? []) {
    if (sequence.sourceDirection === null) continue
    const source = sequences[sequence.sourceDirection]
    if (source === undefined) continue
    sequences[sequence.direction] = {
      frames: source.frames,
      sourceDirection: sequence.sourceDirection,
      mirrorX: sequence.mirrorX,
    }
  }
  return sequences
}

/** Playtest 只保留渲染和操控所需的数据；审核、生成与根位移仍属于各自原有边界。 */
export function createPlaytestModel(character: Character, outfitId: string): PlaytestModelResult {
  const outfit = character.outfits.find((candidate) => candidate.id === outfitId)
  if (outfit === undefined) return { ok: false, reason: 'outfit_not_found' }

  return {
    ok: true,
    model: {
      characterId: character.id,
      outfitName: outfit.name,
      actions: outfit.actions
        .filter(
          (action) =>
            action.frames.length > 0 ||
            action.sequences?.some((sequence) => sequence.frames.length > 0) === true,
        )
        .map((action) => {
          const sequences = playtestSequences(action)
          const fallbackFrames = sequences.east?.frames ?? []

          return {
            id: action.id,
            name: action.name,
            type: action.type,
            ...(action.locomotion ? { locomotion: action.locomotion } : {}),
            loop: action.loop,
            sequences,
            frames: fallbackFrames,
          }
        }),
    },
  }
}
