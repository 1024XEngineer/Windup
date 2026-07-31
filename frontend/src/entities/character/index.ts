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

/** 单帧相对动作首帧的根位移，单位为像素。 */
export interface FrameRootMotion {
  dx: number
  /** 正值表示向上。 */
  dy: number
}

/**
 * 动作序列中的一张有序画面；帧序号由其在 Action.frames 中的位置决定。
 *
 * 不带任何审核字段：服务端只交付生成好的帧，不返回质检结论；用户侧的审核也只是查看，
 * 没有打回。前端若要做自动质检，那是读取帧之后在本地算出来的临时结论，不属于资产数据。
 */
export interface Frame {
  imageUrl: string
  /**
   * 此帧的显示时长，单位毫秒。
   * null 表示该帧没有独立时长，读取方才使用所属 Action.fps 计算等时长回退值。
   */
  durationMs: number | null
  /** null 表示不提供根位移，Playtest 与 Export 不应据此施加任何位移。 */
  rootMotion: FrameRootMotion | null
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
  /**
   * 仅在所属 Outfit 内唯一。动作没有自己的表，整棵树存在 character 记录里，
   * 因此不存在全局唯一的动作 ID：任何按 ID 定位动作的地方都必须同时带上造型。
   */
  id: string
  outfitId: Outfit['id']
  name: string
  /** 定义来源方式；与 type 正交，不用于推断动作业务语义。 */
  kind: ActionKind
  /** 动作业务语义；与 kind 的 preset/custom 来源维度相互独立。 */
  type: ActionType
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
  /**
   * 按播放顺序排列的帧；数组下标就是零基帧序号。
   * 当前只表达单朝向。Project.directionalMovement 的四向/八向要如何落到这里
   * （本层再分组，还是一个朝向一条 Action）尚未有产品定义，不要凭猜先定结构。
   */
  frames: Frame[]
}

/** 同一角色的一套独立造型；MVP UI 只展示第一套，但数据结构不折叠该层。 */
export interface Outfit {
  /**
   * 仅在所属 Character 内唯一。造型没有自己的表，与动作一起存在 character 记录里，
   * 因此不存在全局唯一的造型 ID：任何按 ID 定位造型的地方都必须同时带上角色。
   */
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

/**
 * 项目下的角色资产；造型拥有各自的母版和动作帧。
 *
 * 这棵树只承载已导出到资产库的内容，因此其中的动作一律是已确认的，不带生成过程状态。
 * 工作流运行期间的造型、动作和帧活在 WorkflowRun 的步骤里，直到用户确认导出才整体写入。
 */
export interface Character {
  id: string
  projectId: string
  /** 角色的全部独立造型；MVP 页面至少保留这一层，即使当前只有一个成员。 */
  outfits: Outfit[]
  createdAt: string
  updatedAt: string
}

/** 创建角色并发起母版生成所需的入参。 */
export interface CreateCharacterInput {
  projectId: string
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
