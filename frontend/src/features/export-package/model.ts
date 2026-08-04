import type { ActionType, Frame } from '@/entities'

/** 导出功能只依赖这份只读模型，不依赖 Playtest 页面内部实现。 */
export interface ExportFrame {
  imageUrl: string
  durationMs: number
  rootMotion: Frame['rootMotion']
  keyFrame: boolean
}

export interface ExportSequence {
  direction: string
  frames: readonly ExportFrame[]
}

export interface ExportAction {
  id: string
  name: string
  type: ActionType | 'crouch'
  fps: number
  sequences: readonly ExportSequence[]
}

export interface ExportPackageModel {
  characterId: string
  characterName: string
  outfitId: string
  outfitName: string
  characterTemplateUrl: string | null
  baseFrameCount: number
  actions: readonly ExportAction[]
}
