import type { ActionType } from '../character'
import type { MediaReference } from '../media'

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
 * character_action 两种：character_template 落在 character_image，动作首帧和完整动画
 * 都落在 character_action，只是请求帧数分别为 1 和 32。
 * 完整动画内部可含视频生成、截帧和多次图像处理，但对前端仍是一次 Generation。
 */
export type GenerationType = 'character_template' | 'first_frame' | 'complete_animation'

/**
 * 恢复任务时由 WorkflowRun 提供的已知上下文。动作阶段必须带上动作语义，
 * 这样适配器才能拒绝“请求 walk、后端却返回 attack”这类串任务结果。
 */
export type GenerationExpectation =
  | { type: 'character_template' }
  | { type: 'first_frame'; actionType: ActionType }
  | { type: 'complete_animation'; actionType: ActionType }

interface GenerationInputBase {
  projectId: string
  /** 可选参考媒体；没有参考图时传空数组。 */
  referenceMedia: readonly MediaReference[]
}

/** 角色母版候选生成；当前合同固定请求 4 个候选，不向调用方暴露可变数量。 */
export interface CharacterTemplateGenerationInput extends GenerationInputBase {
  type: 'character_template'
  /** 已由手动输入或 Quick Start 整理好的角色提示词。 */
  prompt: string
  /** 必须与 Project 的精灵尺寸一致，由上层用例明确传入。 */
  spriteWidth: number
  spriteHeight: number
}

/** 指定角色造型下的动作首帧生成；当前合同固定 1 张，且不能只绑定 Character。 */
export interface FirstFrameGenerationInput extends GenerationInputBase {
  type: 'first_frame'
  characterId: string
  outfitId: string
  actionType: ActionType
  /** 自定义动作或额外动作要求；没有时为 null。 */
  prompt: string | null
}

/**
 * 以已确认首帧为起点生成完整动画。
 * 产品合同固定生成 32 帧；适配器不再沿用后端旧默认值 16。
 */
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

/**
 * 一次生成任务的完整快照，创建、查询和断线恢复都用它。
 * 它是服务端的资源，不是一次「调用能力」——前端创建它，然后订阅或轮询它的状态。
 *
 * TType 在调用边界已知时保留精确类型；查询和订阅必须传入工作流已知的前端阶段，
 * 因为后端 task_type 比前端阶段更粗，不能只靠 DTO 猜测首帧还是完整动画。
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
 * 一条状态变更事件。后端 SSE 推送完整任务对象并使用 id；适配器校验后将 id
 * 转成 taskId，避免传输字段名泄漏到 Controller。
 */
export interface GenerationEvent<TType extends GenerationType = GenerationType> extends Omit<
  Generation<TType>,
  'id' | 'projectId'
> {
  /** 对应后端事件的 id，也对应 Generation.id。 */
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
  /**
   * 订阅 task_update，终态由传输层自动关闭；返回的函数供页面离开时主动取消。
   * 传输错误与非法 DTO 通过 onError 上报，不伪造成业务 failed 状态。
   */
  subscribe(
    projectId: Generation['projectId'],
    id: Generation['id'],
    onEvent: (event: GenerationEvent) => void,
    onError?: (error: Error) => void,
  ): () => void
}

export { createGenerationApis, GenerationApiError } from './api'
export type { GenerationApiConfig, GenerationTransport } from './api'
