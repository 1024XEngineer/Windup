/**
 * 动作「如何被定义」的来源维度：preset 复用预设定义，custom 由用户自定义。
 * 它与动作做什么的 ActionType 相互独立，例如 custom + walk 和 preset + custom 都是合法组合。
 */
export type ActionKind = 'preset' | 'custom'

/**
 * 动作「做什么」的业务语义维度；custom 表示不属于当前内置语义枚举。
 * 它不表示定义来源：custom 来源仍可描述 walk，preset 来源也可承载 custom 业务语义。
 */
export type ActionType = 'walk' | 'idle' | 'attack' | 'jump' | 'custom'

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

/** 单帧相对动作首帧的根位移，单位为像素。 */
export interface FrameRootMotion {
  dx: number
  /** 正值表示向上。 */
  dy: number
}

/** 动作序列中的一张有序画面；帧序号由其在 Action.frames 中的位置决定。 */
export interface Frame {
  imageUrl: string
  /**
   * 此帧的显示时长，单位毫秒。
   * null 表示该帧没有独立时长，读取方才使用所属 Action.fps 计算等时长回退值。
   */
  durationMs: number | null
  /** null 表示不提供根位移，Playtest 与 Export 不应据此施加任何位移。 */
  rootMotion: FrameRootMotion | null
  /** 后端自动质检结论，与人工 rejected 状态相互独立。 */
  qc: FrameQcResult
  /** 人工退回。不设「通过此帧」，故是布尔量而非三态。 */
  rejected: boolean
}

/** 一张母版候选；attemptId 用于区分候选所属的生成尝试。 */
export interface CharacterTemplateCandidate {
  id: string
  imageUrl: string
  attemptId: string
}

/** 确认母版候选时同时命名造型与候选，避免两个字符串 ID 在调用处颠倒。 */
export interface ConfirmCharacterTemplateInput {
  outfitId: string
  candidateId: string
}

/** 造型的基础参考帧；方向与质检结构等待真实资产契约后再扩展。 */
export interface BaseFrame {
  readonly imageUrl: string
}

/** 某个角色造型下的一段动画动作。 */
export interface Action {
  id: string
  outfitId: Outfit['id']
  name: string
  /** 定义来源方式；与 type 正交，不用于推断动作业务语义。 */
  kind: ActionKind
  /** 动作业务语义；与 kind 的 preset/custom 来源维度相互独立。 */
  type: ActionType
  status: ActionStatus
  /**
   * 每秒播放帧数。仅当某帧 durationMs 为 null 时用于等时长回退；
   * Playtest 与 Export 不得用前端全局常量替代，也不得覆盖帧自己的 durationMs。
   */
  fps: number
  /**
   * 攻击触点、跳跃顶点等关键时刻在 frames 中的零基下标；null 表示没有明确关键帧。
   * 非 null 值必须指向当前 frames 数组内的成员。
   */
  keyFrameIndex: number | null
  /** 按播放顺序排列的帧；数组下标就是零基帧序号。 */
  frames: Frame[]
}

/** 同一角色的一套独立造型；MVP UI 只展示第一套，但数据结构不折叠该层。 */
export interface Outfit {
  id: string
  characterId: string
  name: string
  /** 母版生成阶段返回的候选；生成完成前可以为空数组。 */
  candidateCharacterTemplates: CharacterTemplateCandidate[]
  /** 用户从候选图中选定的角色母版 URL；尚未选定时为 null。 */
  characterTemplateUrl: string | null
  /** 供后续动作生成使用的只读基础帧入口。 */
  readonly baseFrames: readonly BaseFrame[]
  /** 每个 Action.outfitId 必须等于本造型 ID。 */
  actions: Action[]
}

/** 项目下的角色资产；造型拥有各自的母版和动作帧。 */
export interface Character {
  id: string
  projectId: string
  name: string
  /** 角色的全部独立造型；MVP 页面至少保留这一层，即使当前只有一个成员。 */
  outfits: Outfit[]
  createdAt: string
  updatedAt: string
}

/** 创建角色并发起母版生成所需的入参。 */
export interface CreateCharacterInput {
  projectId: string
  name: string
  /** 交给模型生成母版。 */
  description: string
  referenceImageUrl?: string | null
}

/**
 * Character 对应的一组后端接口。
 * 造型、动作和帧是 Character 内的完整树，不通过独立粒度方法写入；每次确认后整棵更新。
 */
export interface CharacterApis {
  get(id: Character['id']): Promise<Character>
  listByProject(projectId: string): Promise<Character[]>
  create(input: CreateCharacterInput): Promise<Character>
  update(character: Character): Promise<Character>
}
