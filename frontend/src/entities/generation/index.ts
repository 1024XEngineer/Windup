import type { ActionType } from '../character'
import type { MediaReference } from '../media'
import type { Task } from '../task'

/**
 * Generation 是业务数据，不是「调用图片生成能力」。
 * 前端只创建 generation 并订阅它的状态；真正调用模型的是后端，前端不接触那一层。
 */

/** 生成对应的三个前端可见异步步骤。 */
export type GenerationType = 'character_template' | 'first_frame' | 'complete_animation'

interface GenerationInputBase {
  projectId: string
  /** 可选参考媒体；没有参考图时传空数组。 */
  referenceMedia: readonly MediaReference[]
}

/** 角色母版候选生成。 */
export interface CharacterTemplateGenerationInput extends GenerationInputBase {
  type: 'character_template'
  /** 已由手动输入或 Quick Start 整理好的角色提示词。 */
  prompt: string
}

/** 指定角色造型下的动作首帧生成；不能只绑定 Character。 */
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
  /** 已确认的生成首帧 URL。 */
  firstFrameUrl: string
  prompt: string | null
}

export type GenerationInput =
  | CharacterTemplateGenerationInput
  | FirstFrameGenerationInput
  | CompleteAnimationGenerationInput

/** 后端当前能交付给前端的最小图片结果。 */
export interface GeneratedImage {
  url: string
}

/** 结果按 type 分别定义，不共用一个 urls 数组。 */
export interface CharacterTemplateGenerationResult {
  type: 'character_template'
  images: readonly GeneratedImage[]
}

export interface FirstFrameGenerationResult {
  type: 'first_frame'
  image: GeneratedImage
}

/** 帧顺序由数组位置表达。 */
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

/** Generation 对应的一组后端接口。 */
export interface GenerationApis {
  /**
   * 创建一个 generation，返回后端任务。
   * 返回的 Task.type 与输入判别字段保持同一字面量类型；结果解析由调用方在运行时完成。
   */
  create<T extends GenerationInput>(input: T): Promise<Task<T['type']>>
}
