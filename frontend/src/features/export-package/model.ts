import type { ActionType } from '@/entities'

/**
 * 导出模块只读取这份模型，不直接读取 Playtest 页面状态。
 * 页面或后端适配器负责把当前角色、动作和生成记录整理成该模型。
 */
export interface ExportFrame {
  index: number
  imageUrl: string
  durationMs: number
}

/** 通用契约使用左上角为原点、y 轴向下的 0-1 归一化坐标。 */
export interface ExportAnchor {
  x: number
  y: number
}

export type ExportQualityStatus = 'passed' | 'pending' | 'failed'
export const EXPORT_STAGES = ['character', 'first-frame', 'action-assets', 'playtest'] as const
export type ExportStage = (typeof EXPORT_STAGES)[number]

export interface ExportFirstFrame {
  actionId: string
  name: string
  type: ActionType | 'crouch'
  fps: number
  imageUrl: string
}

export interface ExportPlaytest {
  initialActionId: string | null
}

export interface ExportSequence {
  direction: string
  /** 后端声明的完整帧数；不能用 frames.length 代替，否则无法发现缺帧。 */
  expectedFrameCount: number
  loop: boolean
  anchor: ExportAnchor
  /** 脚底线距离画布顶部的像素值。 */
  footY: number
  /** 生成完成可为 pending；进入 Playtest 运行包前必须是 passed。 */
  qualityStatus: ExportQualityStatus
  frames: readonly ExportFrame[]
}

export interface ExportAction {
  id: string
  name: string
  type: ActionType | 'crouch'
  fps: number
  sequences: readonly ExportSequence[]
}

export interface ExportSourceReference {
  workflowRunId: string
  generationIds: readonly string[]
}

export interface ExportPackageModel {
  stage: ExportStage
  characterId: string
  characterName: string
  characterImageUrl: string
  outfitId: string
  outfitName: string
  /** 同一导出包内所有帧必须使用相同画布尺寸。 */
  canvas: {
    width: number
    height: number
  }
  /** 生成链路引用，用于从导出物追溯到 WorkflowRun 与生成任务。 */
  /** 独立 Playtest 入口可能没有 WorkflowRun/Generation 追溯信息。 */
  source: ExportSourceReference | null
  firstFrames: readonly ExportFirstFrame[]
  actions: readonly ExportAction[]
  playtest: ExportPlaytest | null
}
