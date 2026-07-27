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

export interface Frame {
  /** 动作内序号。一个动作几帧由后端决定，前端不写死。 */
  index: number
  imageUrl: string

  qc: FrameQcResult
  /** 人工退回。不设「通过此帧」，故是布尔量而非三态。 */
  rejected: boolean
}

export interface Action {
  id: string
  characterId: string

  name: string
  kind: ActionKind
  status: ActionStatus
  /** 播放时是否位移：跳跃有，待机、蹲下没有。由后端按动作标签给出。 */
  hasDisplacement: boolean
  frames: Frame[]
  /**
   * 生成它的工作流 id，审核台退回单帧后据此跳回编辑器定位。
   * 类型必须与 WorkflowRun.id 一致，否则这条恢复链在类型上就是断的。
   */
  sourceWorkflowId: string | null
}

/** 项目下的核心资产，带一整套动作。 */
export interface Character {
  id: string
  projectId: string
  name: string
  /** 母版图，确认后作为后续动作的一致性基准。 */
  templateImageUrl: string | null
  actions: Action[]
  createdAt: string
  updatedAt: string
}

export interface CreateCharacterInput {
  projectId: string
  name: string
  /** 交给模型生成母版。 */
  description: string

  referenceImageUrl?: string | null
}
