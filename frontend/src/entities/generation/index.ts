import type { ActionType } from '../character'
import type { MediaReference } from '../media'

/**
 * Generation 是业务数据，不是「调用图片生成能力」。
 * 前端只创建 generation 并订阅它的状态；真正调用模型的是后端，前端不接触那一层。
 */

/** 生成任务类型——对齐后端 GenerationType。 */
export type GenerationType = 'character_image' | 'character_action'

/** 完整动作默认生成帧数；首帧生成仍固定为 1 帧。 */
export const CHARACTER_ACTION_FRAME_COUNT = 32

/** 后端单次生成任务的生命周期。 */
export type GenerationTaskStatus = 'pending' | 'running' | 'completed' | 'failed'

interface GenerationInputBase {
  projectId: string
  /** 可选参考媒体；没有参考图时传空数组。 */
  referenceMedia: readonly MediaReference[]
}

/** 角色参考图生成。 */
export interface CharacterImageGenerationInput extends GenerationInputBase {
  type: 'character_image'
  /** 已由手动输入或 Quick Start 整理好的角色提示词。 */
  prompt: string
  /** 项目约束的精灵图宽度，提交生成时传给后端做尺寸校验。 */
  spriteWidth: number
  /** 项目约束的精灵图高度，提交生成时传给后端做尺寸校验。 */
  spriteHeight: number
}

/** 角色动作帧序列生成；首帧和完整动画由 numFrames 区分。 */
export interface CharacterActionGenerationInput extends GenerationInputBase {
  type: 'character_action'
  characterId: string
  outfitId: string
  actionType: ActionType
  /** 自定义动作或额外动作要求；没有时为 null。 */
  prompt: string | null
  /** 生成帧数：1 为首帧，32 为完整动画。 */
  numFrames: number
  /** 完整动画时传入已确认的首帧 URL；首帧生成时为 null。 */
  firstFrameUrl: string | null
}

export type GenerationInput = CharacterImageGenerationInput | CharacterActionGenerationInput

/** 角色参考图生成结果——对齐后端 CharacterImageOutput。 */
export interface CharacterImageOutput {
  type: 'character_image'
  imageUrls: readonly string[]
}

/** 动作帧——对齐后端 CharacterActionFrame。 */
export interface CharacterActionFrame {
  index: number
  imageUrl: string
  durationMs: number | null
}

/** 角色动作生成结果——对齐后端 CharacterActionOutput。 */
export interface CharacterActionOutput {
  type: 'character_action'
  actionType: ActionType
  frames: readonly CharacterActionFrame[]
}

export type GenerationResult = CharacterImageOutput | CharacterActionOutput

export type GenerationResultFor<T extends GenerationInput> = T extends CharacterImageGenerationInput
  ? CharacterImageOutput
  : CharacterActionOutput

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
  /** 兼容后端事件中的 task_id/id，并统一映射为前端 Generation.id。 */
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
    onError?: (error: Error) => void,
  ): () => void
}
