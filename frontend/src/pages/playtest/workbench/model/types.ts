import type { ActionType, Frame } from '@/entities/character'

/**
 * Playtest 需要识别的控制动作。
 *
 * `crouch` 暂时只属于预览控制语义，不借此修改 Character 的公共数据合同。
 */
export type PlaytestActionType = ActionType | 'crouch'
/** #70 暂未定义多方向存储；正式资产进入预览时统一映射为 default。 */
export type PlaytestDirection = string

export interface PreviewFrame {
  imageUrl: string
  durationMs: number
  /** 从实体的“相对首帧位移”换算出的逐帧增量，仅供预览运动使用。 */
  rootMotion: Frame['rootMotion']
  keyFrame: boolean
}

export interface PreviewSequence {
  direction: PlaytestDirection
  frames: readonly PreviewFrame[]
}

export interface PreviewAction {
  id: string
  name: string
  type: PlaytestActionType
  fps: number
  sequences: readonly PreviewSequence[]
}

export interface PlaytestPreviewModel {
  characterId: string
  characterName: string
  outfitId: string
  outfitName: string
  characterTemplateUrl: string | null
  baseFrameCount: number
  actions: readonly PreviewAction[]
}

export type PreviewModelResult =
  | { ok: true; model: PlaytestPreviewModel }
  | { ok: false; reason: 'outfit_not_found' }
