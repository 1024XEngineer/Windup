import type { WorkflowRun } from '../workflow-run'

/** 角色、动作、帧。后端接口尚未提供，形状按界面需要先定，待与后端对齐。 */

/** 预设动作（行走/奔跑/跳跃/待机等 6–10 个）或自定义。 */
export type ActionKind = 'preset' | 'custom'

/** 动作在生成流水线上的位置。 */
export type ActionStatus =
  /** 已加入工作流但还没开始生成 */
  | 'planned'
  /** 后端任务进行中 */
  | 'generating'
  /** 生成完成，是候选，还没被用户确认 */
  | 'candidate'
  /** 用户确认后成为正式资产 */
  | 'confirmed'
  /** 生成失败 */
  | 'failed'

/** 系统质检结论。系统通过不等于人工通过，分开记。 */
export type FrameQcResult = 'pending' | 'passed' | 'failed'

/** 动作序列中的一张有序画面；帧序号由其在 Action.frames 中的位置决定。 */
export interface Frame {
  /** 帧图片的可访问 URL；候选与正式资产 URL 的具体来源等待 Asset 契约确定。 */
  imageUrl: string

  /** 后端自动质检结论，与人工 rejected 状态相互独立。 */
  qc: FrameQcResult
  /** 人工退回。不设「通过此帧」，故是布尔量而非三态。 */
  rejected: boolean
}

/** 某个角色造型下的一段动画动作。 */
export interface Action {
  /** 动作领域 ID；由 Character/Asset 接口返回，具体格式等待 OpenAPI 确定。 */
  id: string
  /** 拥有该动作的 Outfit ID。 */
  outfitId: Outfit['id']

  /** 面向用户展示的动作名称。 */
  name: string
  /** 动作来自系统预设还是用户自定义。 */
  kind: ActionKind
  /** 动作在生成、候选确认流程中的当前状态。 */
  status: ActionStatus
  /** 每秒播放帧数（frames per second）；预览和导出不得使用前端全局常量。 */
  fps: number
  /** 按播放顺序排列的帧；数组下标就是零基帧序号。 */
  frames: Frame[]
  /**
   * 生成它的 WorkflowRun id，审核台退回单帧后据此跳回编辑器定位。
   * 类型必须与 WorkflowRun.id 一致，否则这条恢复链在类型上就是断的。
   */
  sourceWorkflowRunId: WorkflowRun['id'] | null
}

/** 同一角色的一套独立造型；MVP UI 只展示第一套，但数据结构不折叠该层。 */
export interface Outfit {
  /** 造型领域 ID；具体来源和格式等待 Character OpenAPI 确定。 */
  id: string
  /** 该造型所属的 Character ID。 */
  characterId: string
  /** 面向用户展示的造型名称。 */
  name: string
  /** 母版生成阶段返回的三张候选图 URL；生成完成前可以为空数组。 */
  candidateCharacterTemplates: string[]
  /** 用户从候选图中选定的角色母版 URL；尚未选定时为 null。 */
  characterTemplateUrl: string | null
  /** 该造型拥有的动作集合；每个 Action.outfitId 必须等于本造型 ID。 */
  actions: Action[]
}

/** 项目下的角色资产；造型拥有各自的母版和动作帧。 */
export interface Character {
  /** 后端 Character ID；具体格式等待 OpenAPI 确定。 */
  id: string
  /** 角色所属的 Project ID。 */
  projectId: string
  /** 面向用户展示的角色名称。 */
  name: string
  /** 角色的全部独立造型；MVP 页面至少保留这一层，即使当前只有一个成员。 */
  outfits: Outfit[]
  /** 角色创建时间，预期使用后端返回的 ISO 8601 字符串。 */
  createdAt: string
  /** 角色最后更新时间，预期使用后端返回的 ISO 8601 字符串。 */
  updatedAt: string
}

/** 创建角色并发起母版生成所需的前端领域入参。 */
export interface CreateCharacterInput {
  /** 新角色所属的 Project ID。 */
  projectId: string
  /** 面向用户展示的角色名称。 */
  name: string
  /** 交给模型生成母版。 */
  description: string

  /** 可选的用户参考图 URL；未提供或已明确清空时为 null/undefined。 */
  referenceImageUrl?: string | null
}
