import type { Action, Character, Frame } from "@/entities/character";

import type {
  PlaytestPreviewModel,
  PreviewAction,
  PreviewFrame,
  PreviewModelResult,
  PreviewSequence,
} from "./types";

const SAFE_DURATION_MS = 100;

function getFallbackDurationMs(fps: Action["fps"]): number {
  if (!Number.isFinite(fps) || fps <= 0) return SAFE_DURATION_MS;

  const durationMs = Math.round(1000 / fps);
  return durationMs > 0 ? durationMs : SAFE_DURATION_MS;
}

function createPreviewFrame(
  frame: Frame,
  frameIndex: number,
  keyFrameIndex: number | null,
  fallbackDurationMs: number,
): PreviewFrame {
  return {
    imageUrl: frame.imageUrl,
    durationMs:
      frame.durationMs !== null && frame.durationMs > 0 ? frame.durationMs : fallbackDurationMs,
    rootMotion: frame.rootMotion,
    qc: frame.qc,
    rejected: frame.rejected,
    keyFrame: frameIndex === keyFrameIndex,
  };
}

function createPreviewAction(action: Action): PreviewAction {
  const fallbackDurationMs = getFallbackDurationMs(action.fps);

  const sequences: readonly PreviewSequence[] = action.sequences.map((sequence) => ({
    direction: sequence.direction,
    frames: sequence.frames.map((frame, frameIndex) =>
      createPreviewFrame(frame, frameIndex, sequence.keyFrameIndex, fallbackDurationMs),
    ),
  }));

  return {
    id: action.id,
    name: action.name,
    type: action.type,
    status: action.status,
    fps: action.fps,
    sequences,
  };
}

function createModel(
  character: Character,
  outfit: Character["outfits"][number],
): PlaytestPreviewModel {
  return {
    characterId: character.id,
    characterName: character.name,
    outfitId: outfit.id,
    outfitName: outfit.name,
    characterTemplateUrl: outfit.characterTemplateUrl,
    baseFrameCount: outfit.baseFrames.length,
    actions: outfit.actions.map(createPreviewAction),
  };
}

export function createPreviewModel(character: Character, outfitId: string): PreviewModelResult {
  const outfit = character.outfits.find((candidate) => candidate.id === outfitId);

  if (!outfit) return { ok: false, reason: "outfit_not_found" };

  return { ok: true, model: createModel(character, outfit) };
}
