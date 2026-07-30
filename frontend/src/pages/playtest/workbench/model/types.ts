import type { ActionStatus, ActionType, Character, Frame } from "@/entities/character";

/**
 * Playtest 需要识别的控制动作。
 *
 * `crouch` 暂时只属于预览控制语义，不借此修改 Character 的公共数据合同。
 */
export type PlaytestActionType = ActionType | "crouch";
export type PlaytestDirection =
  Character["outfits"][number]["actions"][number]["sequences"][number]["direction"];

export interface PreviewFrame {
  imageUrl: string;
  durationMs: number;
  rootMotion: Frame["rootMotion"];
  qc: Frame["qc"];
  rejected: boolean;
  keyFrame: boolean;
}

export interface PreviewSequence {
  direction: PlaytestDirection;
  frames: readonly PreviewFrame[];
}

export interface PreviewAction {
  id: string;
  name: string;
  type: PlaytestActionType;
  status: ActionStatus;
  fps: number;
  sequences: readonly PreviewSequence[];
}

export interface PlaytestPreviewModel {
  characterId: string;
  characterName: string;
  outfitId: string;
  outfitName: string;
  characterTemplateUrl: string | null;
  baseFrameCount: number;
  actions: readonly PreviewAction[];
}

export type PreviewModelResult =
  | { ok: true; model: PlaytestPreviewModel }
  | { ok: false; reason: "outfit_not_found" };
