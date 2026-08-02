import type { ActionType } from '../character'
import type { MediaReference } from '../media'

/**
 * Generation 是业务数据，不是「调用图片生成能力」。
 * 前端只创建 generation 并订阅它的状态；真正调用模型的是后端，前端不接触那一层。
 */

/** 生成对应的三个前端可见异步步骤。 */
export type GenerationType = 'character_template' | 'first_frame' | 'complete_animation'

/** 后端单次生成任务的生命周期。 */
export type GenerationTaskStatus = 'pending' | 'running' | 'completed' | 'failed'

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
  /** 项目约束的精灵图宽度，提交生成时传给后端做尺寸校验。 */
  spriteWidth: number
  /** 项目约束的精灵图高度，提交生成时传给后端做尺寸校验。 */
  spriteHeight: number
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

/**
 * Generation.result 来自运行时边界，写回 WorkflowRun 前必须按生成类型收窄。
 *
 * 兼容后端两种返回格式：
 * - 旧版单图：`{ type, image_url: "..." }`
 * - 新版多图：`{ type, image_urls: ["...", "..."] }`
 */
export function parseCharacterTemplateGenerationResult(
  value: unknown,
): CharacterTemplateGenerationResult | null {
  if (
    !isRecord(value) ||
    (value.type !== 'character_template' && value.type !== 'character_image')
  ) {
    return null
  }

  // 优先使用 image_urls（多图），兼容 image_url（单图）
  const rawUrls: string[] = []
  if (Array.isArray(value.image_urls)) {
    for (const item of value.image_urls) {
      if (typeof item === 'string' && item.length > 0) rawUrls.push(item)
    }
  } else if (typeof value.image_url === 'string' && value.image_url.length > 0) {
    rawUrls.push(value.image_url)
  }

  // 兼容旧版 images 数组格式
  if (rawUrls.length === 0 && Array.isArray(value.images)) {
    for (const image of value.images) {
      if (isRecord(image) && typeof image.url === 'string' && image.url.length > 0) {
        rawUrls.push(image.url)
      }
    }
  }

  if (rawUrls.length === 0) return null

  const images: GeneratedImage[] = rawUrls.map((url) => ({ url }))
  return { type: 'character_template', images }
}

export interface FirstFrameGenerationResult {
  type: 'first_frame'
  image: GeneratedImage
}

export interface GeneratedAnimationFrame extends GeneratedImage {
  durationMs: number | null
}

/** 帧顺序由数组位置表达。 */
export interface CompleteAnimationGenerationResult {
  type: 'complete_animation'
  actionType: ActionType
  frames: readonly GeneratedAnimationFrame[]
}

/** 校验已经过适配层归一化的完整动画结果，供本地持久化恢复使用。 */
export function parseCompleteAnimationGenerationResult(
  value: unknown,
): CompleteAnimationGenerationResult | null {
  if (!isRecord(value) || value.type !== 'complete_animation') return null
  if (!['walk', 'idle', 'attack', 'jump', 'custom'].includes(String(value.actionType))) return null
  if (!Array.isArray(value.frames) || value.frames.length === 0) return null
  const frames: GeneratedAnimationFrame[] = []
  for (const frame of value.frames) {
    if (
      !isRecord(frame) ||
      typeof frame.url !== 'string' ||
      frame.url.length === 0 ||
      (frame.durationMs !== null && typeof frame.durationMs !== 'number')
    ) {
      return null
    }
    frames.push({ url: frame.url, durationMs: frame.durationMs as number | null })
  }
  return { type: 'complete_animation', actionType: value.actionType as ActionType, frames }
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

/**
 * 一次生成任务的完整快照。
 * 它是服务端的资源，不是一次「调用能力」——前端创建它，然后订阅或轮询它的状态。
 */
export interface Generation<TType extends GenerationType = GenerationType> {
  /** 创建接口返回的后端任务 ID。 */
  id: string
  projectId: string
  /** 与创建时的输入判别字段保持同一字面量类型。 */
  type: TType
  status: GenerationTaskStatus
  /** 完成前为 null；完成后形状由 type 决定。 */
  result: GenerationResult | null
  /** status 为 failed 时有值。 */
  error: string | null
}

/** 后端任务状态变化映射成同一份 Generation 快照。 */
export interface GenerationEvent<TType extends GenerationType = GenerationType> extends Omit<
  Generation<TType>,
  'id' | 'projectId'
> {
  /** 字段名对应后端事件中的 task_id，但语义上仍是 Generation.id。 */
  taskId: Generation['id']
}

/** Generation 对应的一组后端接口。 */
export interface GenerationApis {
  /** 创建一次生成任务。 */
  create<T extends GenerationInput>(input: T): Promise<Generation<T['type']>>
  /** 按所属项目和任务 ID 读取生成任务的最新快照。 */
  get(projectId: Generation['projectId'], id: Generation['id']): Promise<Generation>
  /**
   * 订阅任务状态。当前后端没有 SSE 时，实现可以封装轮询；调用方不感知传输方式。
   * 返回取消订阅函数。
   */
  subscribe(
    projectId: Generation['projectId'],
    id: Generation['id'],
    onEvent: (event: GenerationEvent) => void,
  ): () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
