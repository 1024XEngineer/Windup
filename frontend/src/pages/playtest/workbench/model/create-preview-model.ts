import type { Action, Character, Frame } from '@/entities/character'

import type {
  PlaytestPreviewModel,
  PreviewAction,
  PreviewFrame,
  PreviewModelResult,
  PreviewSequence,
} from './types'

const SAFE_DURATION_MS = 100

function getFallbackDurationMs(fps: Action['fps']): number {
  if (!Number.isFinite(fps) || fps <= 0) return SAFE_DURATION_MS

  const durationMs = Math.round(1000 / fps)
  return durationMs > 0 ? durationMs : SAFE_DURATION_MS
}

function createPreviewFrame(
  frame: Frame,
  frameIndex: number,
  keyFrameIndex: number | null,
  fallbackDurationMs: number,
  previousAbsoluteRootMotion: Frame['rootMotion'],
): PreviewFrame {
  const rootMotion =
    frame.rootMotion === null
      ? null
      : {
          dx: frame.rootMotion.dx - (previousAbsoluteRootMotion?.dx ?? 0),
          dy: frame.rootMotion.dy - (previousAbsoluteRootMotion?.dy ?? 0),
        }

  return {
    imageUrl: frame.imageUrl,
    durationMs:
      frame.durationMs !== null && frame.durationMs > 0 ? frame.durationMs : fallbackDurationMs,
    rootMotion,
    keyFrame: frameIndex === keyFrameIndex,
  }
}

function createPreviewAction(action: Action): PreviewAction {
  const fallbackDurationMs = getFallbackDurationMs(action.fps)
  let previousAbsoluteRootMotion: Frame['rootMotion'] = null
  const frames = action.frames.map((frame, frameIndex) => {
    const previewFrame = createPreviewFrame(
      frame,
      frameIndex,
      action.keyFrameIndex,
      fallbackDurationMs,
      previousAbsoluteRootMotion,
    )
    if (frame.rootMotion !== null) previousAbsoluteRootMotion = frame.rootMotion
    return previewFrame
  })
  const sequences: readonly PreviewSequence[] = [{ direction: 'default', frames }]

  return {
    id: action.id,
    name: action.name,
    // #70 用 custom 承载尚未进入内置枚举的动作；Playtest 只在本地识别下蹲控制语义。
    type:
      action.type === 'custom' && /(?:crouch|下蹲|蹲伏)/iu.test(action.name)
        ? 'crouch'
        : action.type,
    fps: action.fps,
    sequences,
  }
}

function createModel(
  character: Character,
  outfit: Character['outfits'][number],
): PlaytestPreviewModel {
  return {
    characterId: character.id,
    characterName: character.id,
    outfitId: outfit.id,
    outfitName: outfit.name,
    characterTemplateUrl: outfit.characterTemplateUrl,
    baseFrameCount: outfit.baseFrames.length,
    actions: outfit.actions.map(createPreviewAction),
  }
}

export function createPreviewModel(character: Character, outfitId: string): PreviewModelResult {
  const outfit = character.outfits.find((candidate) => candidate.id === outfitId)

  if (!outfit) return { ok: false, reason: 'outfit_not_found' }

  return { ok: true, model: createModel(character, outfit) }
}
