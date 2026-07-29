import type { ActionType, MediaReference } from '@/entities'

/** 生成能力对应的三个前端可见异步步骤。 */
export type GenerationType = 'character_template' | 'first_frame' | 'complete_animation'

interface GenerationInputBase {
  /** 本次生成归属的 Project ID；来源由上层 Repository 决定。 */
  projectId: string
  /** 可选参考媒体；不透明引用由上传 Adapter 产生，没有参考图时传空数组。 */
  referenceMedia: readonly MediaReference[]
}

/** 角色立绘或母版候选生成。 */
export interface CharacterTemplateGenerationInput extends GenerationInputBase {
  type: 'character_template'
  /** 已由手动输入或 Quick Start Agent 整理好的角色提示词。 */
  prompt: string
}

/** 指定角色造型下的动作生成；不能只绑定 Character。 */
export interface FirstFrameGenerationInput extends GenerationInputBase {
  type: 'first_frame'
  characterId: string
  outfitId: string
  actionType: ActionType
  /** 自定义动作或额外动作要求；没有时为 null。 */
  prompt: string | null
}

/** 以已确认首帧为起点生成完整动画。 */
export interface CompleteAnimationGenerationInput extends GenerationInputBase {
  type: 'complete_animation'
  characterId: string
  outfitId: string
  actionType: ActionType
  /** 已确认的生成首帧 URL；它不是上传 Adapter 创建的 MediaReference。 */
  firstFrameUrl: string
  /** 自定义动作或额外动作要求；没有时为 null。 */
  prompt: string | null
}

export type GenerationInput =
  | CharacterTemplateGenerationInput
  | FirstFrameGenerationInput
  | CompleteAnimationGenerationInput

/** 后端当前能交付给前端的最小图片结果。 */
export interface GeneratedImage {
  /** 可供预览或后续资产登记使用的图片 URL。 */
  url: string
}

/** 角色图片生成结果；与动作帧结果分开定义。 */
export interface CharacterTemplateGenerationResult {
  type: 'character_template'
  images: readonly GeneratedImage[]
}

/** 动作首帧生成结果。 */
export interface FirstFrameGenerationResult {
  type: 'first_frame'
  image: GeneratedImage
}

/** 完整动画生成结果；帧顺序由数组位置表达。 */
export interface CompleteAnimationGenerationResult {
  type: 'complete_animation'
  frames: readonly GeneratedImage[]
}

export type GenerationResult =
  | CharacterTemplateGenerationResult
  | FirstFrameGenerationResult
  | CompleteAnimationGenerationResult

export type GenerationResultFor<T extends GenerationInput> =
  T extends CharacterTemplateGenerationInput
    ? CharacterTemplateGenerationResult
    : T extends FirstFrameGenerationInput
      ? FirstFrameGenerationResult
      : CompleteAnimationGenerationResult
