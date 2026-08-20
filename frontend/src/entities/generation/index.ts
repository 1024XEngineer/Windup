import type { ActionType } from '../character'
import type { MediaReference } from '../media'
import type { ActionGenerationMethod } from '../workflow-run'

/**
 * Generation 是业务数据，不是「调用图片生成能力」。
 * 前端只创建 generation 并订阅它的状态；真正调用模型的是后端，前端不接触那一层。
 *
 * 后端只有 GenerationTask 一个实体，generation 与 task 指同一条记录；
 * `/generation/tasks/{task_id}` 里的 tasks 只是路径段，前端不为它另立实体。
 */

/**
 * 后端 GenerationTask.status，与 WorkflowNode.status 不是一回事：
 * 这里是单次生成任务的状态，那里是一个卡片的前端流程状态。
 * pending 表示已提交但尚未执行。
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * 生成对应的三个前端可见异步步骤。
 * 它是前端工作流粒度，不等于后端 task_type——后端只有 character_image 与
 * character_action 两种，character_template 和 first_frame 都落在 character_image 上。
 * 完整动画内部可含视频生成、截帧和多次图像处理，但对前端仍是一次 Generation。
 */
export type GenerationType = 'character_template' | 'first_frame' | 'complete_animation'

export type GenerationExpectation =
  | { type: 'character_template' }
  | { type: 'first_frame'; actionType: ActionType }
  | { type: 'complete_animation'; actionType: ActionType }

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
  /** 必须与 Project 的精灵尺寸一致，后端会在提交时校验。 */
  spriteWidth: number
  spriteHeight: number
}

/** 基于已确认角色母版生成动作首帧候选图。 */
export interface FirstFrameGenerationInput extends GenerationInputBase {
  type: 'first_frame'
  actionType: ActionType
  /** 动作描述；没有额外描述时由 Controller 使用动作名称。 */
  prompt: string
  /** 必须与 Project 的精灵尺寸一致，后端会在提交时校验。 */
  spriteWidth: number
  spriteHeight: number
}

/** 以已确认首帧为起点生成完整动画。 */
export interface CompleteAnimationGenerationInput extends GenerationInputBase {
  type: 'complete_animation'
  characterId: string
  outfitId: string
  /**
   * 用户选定的生成路线。必填而不是从"这个造型有没有 3D 资产"推断：后端把
   * `outfit_id` 在场与否当成三渲二的唯一判据，无条件发送等于替用户选了路线——
   * 造型一旦建过 3D 资产，点"视频裁剪"也会被静默改成三渲二。
   */
  method: ActionGenerationMethod
  actionType: ActionType
  /** 已确认的生成首帧 URL。 */
  firstFrameUrl: string
  prompt: string | null
  /**
   * 这个动作是否循环播放。`actionType: 'custom'` 时后端据此决定抽帧走单周期闭环还是裁区间。
   *
   * 省略时后端按**一次性**兜底 —— 失败代价不对称：把一次性动作误当循环会让末帧接回首帧
   * 抽搐、产物不可用；反之只是不无缝闭环、产物仍可用。所以能给就给。
   */
  loop?: boolean
}

export type GenerationInput =
  | CharacterTemplateGenerationInput
  | FirstFrameGenerationInput
  | CompleteAnimationGenerationInput

/** 后端当前能交付给前端的最小图片结果。 */
export interface GeneratedImage {
  url: string
}

/** 后端动作帧字段完整映射，不能用数组位置覆盖服务端 index。 */
export interface GeneratedFrame extends GeneratedImage {
  index: number
  durationMs: number | null
}

/** 结果按 type 分别定义，不共用一个 urls 数组。 */
export interface CharacterTemplateGenerationResult {
  type: 'character_template'
  images: readonly GeneratedImage[]
}

export interface FirstFrameGenerationResult {
  type: 'first_frame'
  /** 同一图片任务生成的三张动作首帧候选。 */
  images: readonly GeneratedImage[]
}

export interface CompleteAnimationGenerationResult {
  type: 'complete_animation'
  frames: readonly GeneratedFrame[]
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
 * 一次生成任务的完整快照，创建、查询和断线恢复都用它。
 * 它是服务端的资源，不是一次「调用能力」——前端创建它，然后订阅或轮询它的状态。
 *
 * TType 在调用边界已知时保留精确类型；按 ID 恢复时用默认值，等运行时解析后再收窄。
 * 完成不代表工作流节点已通过，节点状态由 WorkflowNode 自己判定。
 */
export interface Generation<TType extends GenerationType = GenerationType> {
  id: string
  projectId: string
  /** 与创建时的输入判别字段保持同一字面量类型。 */
  type: TType
  status: TaskStatus
  /** 完成前为 null；完成后形状由 type 决定。 */
  result: GenerationResult | null
  /** status 为 failed 时有值。 */
  error: string | null
}

/**
 * 一条状态变更事件。
 * 不含 projectId：后端事件 payload 只有 task_id、task_type、status，
 * 以及完成时的 result 和失败时的 error_message。
 */
export interface GenerationEvent<TType extends GenerationType = GenerationType> extends Omit<
  Generation<TType>,
  'id' | 'projectId'
> {
  /** 对应 Generation.id，字段名沿用后端事件里的 task_id。 */
  taskId: Generation['id']
}

/** Generation 对应的一组后端接口。服务端没有取消能力，因此这里不声明 cancel。 */
export interface GenerationApis {
  /** 创建一次生成任务。 */
  create<T extends GenerationInput>(input: T): Promise<Generation<T['type']>>
  /**
   * 按所属项目和任务 ID 读取最新快照。
   * projectId 不能从 id 推导，后端查询接口要求两者同时传入。
   */
  get(projectId: Generation['projectId'], id: Generation['id']): Promise<Generation>
  get<TType extends GenerationType>(
    projectId: Generation['projectId'],
    id: Generation['id'],
    expectation: Extract<GenerationExpectation, { type: TType }>,
  ): Promise<Generation<TType>>
  /** 订阅状态变化，返回取消订阅函数。 */
  subscribe(
    projectId: Generation['projectId'],
    id: Generation['id'],
    onEvent: (event: GenerationEvent) => void,
  ): () => void
  subscribe<TType extends GenerationType>(
    projectId: Generation['projectId'],
    id: Generation['id'],
    expectation: Extract<GenerationExpectation, { type: TType }>,
    onEvent: (event: GenerationEvent<TType>) => void,
    onError: (error: Error) => void,
  ): () => void
}

export { createGenerationApis, GenerationApiError } from './api'
export type { GenerationApiConfig, GenerationTransport } from './api'
