/**
 * Character 聚合的数据合同。
 *
 * 一个 Character 归属于 Project，并包含若干独立 Outfit；每个 Outfit 拥有自己的
 * 角色母版、基础帧与动作。这里仅表达前端确认过的业务字段，不包含生成算法或
 * 服务端 DTO 转换实现。
 */
import type { SpriteDirection } from '../project'

/**
 * Action 的定义来源。
 *
 * `action_template` 表示通过一个明确的 ActionTemplate 创建；该模板既可以是系统
 * 内置模板，也可以是 Project 模板，因此不能笼统理解为“系统预设”。`custom` 表示用户
 * 直接提供提示词。该字段描述来源，不与 ActionType 的动作类别混用。
 */
export type ActionSource = 'action_template' | 'custom'
/** 当前支持的标准动作类别；custom 承载标准集合之外的动作。 */
export type ActionType = 'walk' | 'idle' | 'attack' | 'jump' | 'custom'
/** 动作从计划、生成候选到人工确认的业务阶段。 */
export type ActionStatus = 'planned' | 'generating' | 'candidate' | 'confirmed' | 'failed'
/** 单帧自动质量检查结论。 */
export type FrameQcResult = 'pending' | 'passed' | 'failed'

/** 单帧相对动作首帧的根位移，单位为像素。 */
export interface FrameRootMotion {
  dx: number
  /** 正值表示向上。 */
  dy: number
}

/** ActionSequence.frames 的数组位置就是帧序号。 */
export interface Frame {
  /** 当前帧图像的可访问地址；媒体 ID 合同冻结后可能调整。 */
  imageUrl: string
  /** 独立显示时长，单位毫秒；null 时使用所属 Action.fps。 */
  durationMs: number | null
  rootMotion: FrameRootMotion | null
  qc: FrameQcResult
  /** 人工退回标记，与自动质检分开记录。 */
  rejected: boolean
}

/** 角色母版候选，不是动作模板。 */
export interface CharacterTemplateCandidate {
  /** 候选图自身标识，用于确认操作，不等于 Generation ID。 */
  id: string
  /** 候选角色母版图地址。 */
  imageUrl: string
  /** 产生该候选图的 Generation 业务记录。 */
  generationId: string
}

/** 母版确认后展开出的基础参考帧。 */
export interface BaseFrame {
  /** 该基础参考帧明确对应的精灵朝向。 */
  direction: SpriteDirection
  /** 当前方向的基础参考帧地址。 */
  imageUrl: string
}

/** 一个 Action 在某个明确朝向下的完整帧序列。 */
export interface ActionSequence {
  direction: SpriteDirection
  /** 关键帧在当前方向 frames 中的零基下标；没有时为 null。 */
  keyFrameIndex: number | null
  /** 数组位置即帧序号，避免重复保存容易失真的 index 字段。 */
  frames: Frame[]
}

/** 一个 Outfit 下可播放、审核和导出的动作。 */
export interface Action {
  id: string
  outfitId: string
  name: string
  /** 动作定义来自 ActionTemplate，还是用户自定义提示词。 */
  source: ActionSource
  type: ActionType
  status: ActionStatus
  /** 每秒帧数，仅作为缺少逐帧时长时的回退。 */
  fps: number
  /** 按精灵朝向组织的动画序列；每个方向最多出现一次。 */
  sequences: ActionSequence[]
}

/** 同一角色的一套独立造型。 */
export interface Outfit {
  id: string
  characterId: string
  name: string
  /** 尚未确认前可供用户选择的角色母版候选。 */
  candidateCharacterTemplates: CharacterTemplateCandidate[]
  /** 用户确认的角色母版；尚未确认时为 null。 */
  characterTemplateUrl: string | null
  baseFrames: BaseFrame[]
  /** 该造型独有的动作集合，不与其他 Outfit 混用。 */
  actions: Action[]
}

/** 角色聚合根；Project 是其归属和查询边界。 */
export interface Character {
  id: string
  projectId: string
  name: string
  outfits: Outfit[]
  createdAt: string
  updatedAt: string
}

export interface CreateCharacterInput {
  projectId: string
  name: string
  description: string
  /** 可选参考图；正式媒体引用合同冻结前使用 URL。 */
  referenceImageUrl?: string | null
}

/** 给既有 Character 的指定 Outfit 增加动作所需输入。 */
export interface AddActionInput {
  outfitId: Outfit['id']
  name: string
  type: ActionType
  /**
   * 使用 source 作为判别字段：模板来源必须提供 actionTemplateId，自定义来源必须
   * 提供 prompt，避免同时出现互相矛盾的可选字段。
   */
  definition:
    | { source: 'action_template'; actionTemplateId: string }
    | { source: 'custom'; prompt: string }
}

/** 从候选集中确认角色母版所需输入。 */
export interface ConfirmCharacterTemplateInput {
  outfitId: Outfit['id']
  /** 被确认的角色母版候选 ID，不得与动作模板或其他候选类型混淆。 */
  characterTemplateCandidateId: CharacterTemplateCandidate['id']
}
