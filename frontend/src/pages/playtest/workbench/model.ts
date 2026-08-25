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

export type PlaytestModelResult =
  | { readonly ok: true; readonly model: PlaytestModel }
  | { readonly ok: false; readonly reason: 'outfit_not_found' }

const DEFAULT_FRAME_DURATION_MS = 100
const DENSE_GENERATED_LOCOMOTION = {
  walk: { frameCount: 32, frameDurationMs: 125, cycleDurationMs: 1000 },
  run: { frameCount: 32, frameDurationMs: 90, cycleDurationMs: 720 },
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
    action.type === 'walk' || action.type === 'run'
      ? DENSE_GENERATED_LOCOMOTION[action.type]
      : undefined
  // 只兼容生成器已知的坏形状：32 帧仍逐帧沿用稀疏 walk/run 时值。
  // 帧数、循环性或任一时值不完全匹配时都尊重资产合同，不能把“超过 8 帧”
  // 猜成密集采样，否则会误改用户已正确编排的 9/12/16/24/32 帧动作。
  if (
    !action.loop ||
    denseTiming === undefined ||
    ordered.length !== denseTiming.frameCount ||
    ordered.some((frame) => frame.durationMs !== denseTiming.frameDurationMs)
  ) {
    return playbackFrames
  }

  const timingScale =
    denseTiming.cycleDurationMs / (denseTiming.frameCount * denseTiming.frameDurationMs)
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
            loop: action.loop,
            sequences,
            frames: fallbackFrames,
          }
        }),
    },
  }
}
