/**
 * 三渲二资产 —— 母版预检与造型级 3D 模型的建造状态。
 *
 * 两件事放在同一个实体下,是因为它们是同一条链上的两道闸:母版确认闸拿预检结果
 * 决定"这张要不要拿去建 3D",建资产闸拿状态决定"这个模型放不放行进绑骨"。
 */

/** 预检**拒绝**的原因。量到就是事实,这几种母版下游根本装不下。 */
export type MasterRejectCode =
  | 'undecodable'
  | 'no_subject'
  | 'subject_too_small'
  | 'aspect_too_wide'

/** 预检**警告**的原因。近似判据,合法母版也会命中,所以只提示、不挡路。 */
export type MasterWarningCode = 'limbs_fused' | 'extra_component'

export interface MasterWarning {
  code: MasterWarningCode
  detail: string
}

/** 预检量到的形态。展示用,不参与任何判定 —— 判定后端已经做完了。 */
export interface MasterFacts {
  width: number
  height: number
  subjectRatio: number
  subjectAreaRatio: number
  /** 主体高度 70/80/88/94% 四处横切的连通段数;双足人形应有 2 段。 */
  limbSegments: number[]
  /** 够大的连通块像素数,从大到小;超过一个 = 画面里还有别的东西。 */
  components: number[]
}

export interface MasterPrecheckReport {
  /** false = 这张母版下游装不下,换一张;警告不影响本字段。 */
  accepted: boolean
  rejectCode: MasterRejectCode | null
  detail: string
  facts: MasterFacts | null
  warnings: MasterWarning[]
}

/**
 * 造型 3D 资产走到哪一步。
 *
 * `awaiting_review` 是一道**人工确认停点**,不是进度条上的一格:混元的模型生成即最终
 * (拓扑、绑点在生成那一步定死,事后改不动),不合格只能重新生成。所以要在花绑骨那
 * 10 积分之前让人看一眼。它不会自己变成 `rigging`。
 */
export type Render3DAssetState =
  | 'absent'
  | 'building'
  | 'awaiting_review'
  | 'rigging'
  | 'ready'
  | 'failed'

/** 建一次的报价。**由后端从计费实现取**,前端不抄常量——抄的那份会在调价时分叉。 */
export interface Render3DAssetCost {
  model3dCredits: number
  autorigCredits: number
  totalCredits: number
  /** 后付费 / 预付费。 */
  billing: string
  /** per_outfit_once = 每造型一次性,不是每动作一次。 */
  scope: string
}

export interface Render3DAsset {
  state: Render3DAssetState
  /** 绑骨模型 URL;非 null 即三渲二在该造型上可用。 */
  model3dUrl: string | null
  /**
   * 待审模型的下载地址。人得先真的看过它才谈得上"确认"——只躺在服务器磁盘上的话,
   * 通过按钮就退化成一个必须点的步骤,反而制造了"已经审过"的假象。
   */
  reviewModelUrl: string | null
  /** 已经烘好的动作。界面靠它禁掉已有的按钮 —— 否则用户会为同一个动作重复付费。 */
  bakedMotions: Render3DMotion[]
  /** 这条路线出得了的动作。由后端给，前端不硬编码一份（抄一份就会各自漂）。 */
  bakeableMotions: Render3DMotion[]
  error: string | null
  cost: Render3DAssetCost
}

/**
 * 一个待浏览器出帧的任务(#714)。字段与后端 `RenderPlan` 一一对应 —— 出帧参数只有
 * 一份真相源,前端不推导也不补默认值:朝向、材质、画布、帧数任何一项在两边分叉都
 * 不会报错,只会安静地渲出另一个东西。
 */
export interface BakeJob {
  taskId: number
  /** 绑骨模型地址,由后端校验过在自家对象存储上。**浏览器直接拉,不经应用机。** */
  modelUrl: string
  clip: string
  direction: string
  cameraYaw: number
  frames: number
  width: number
  height: number
  material: string
  /** 低于它判空帧。与后端同一口径,自己不要另定一个。 */
  minCoverage: number
  /** 期限(epoch 秒)。到点后端按超时收口,不必前端自己计时。 */
  deadlineAt: number
  /** 后端已收到的帧数,用于断线后接着传。 */
  received: number
}

export interface BakeCompletion {
  clip: string
  sampleTimes: number[]
  /**
   * 出帧台从模型里读到的骨架事实。服务端渲那条会把它带上来，浏览器这条此前算完即丢
   * （#774）。两条路必须交回同样的东西，否则同一造型走哪条路存下来的资产不一样。
   */
  rig?: {
    bones: number
    rootBone: string | null
    boneNames: string[]
    skinnedMeshes: number
    vertices: number
    availableClips: Record<string, number>
  }
  /** 本片段的逐帧 (dx, dz)，单位「1.0 = 角色总高」，来源为根骨动画轨。 */
  rootMotion?: Array<[number, number]>
}

/**
 * 这条路线出得了的动作。与后端 `render3d_assets.ACTION_MOTIONS` 里**有对应预设**的那些
 * 同一取值域。
 *
 * `attack` / `custom` 不在其中且不该加进来：预设库里只有 thrust / kick 两支，而产品的
 * 攻击按运动拓扑分四型，拿 thrust 顶 sweep 会渲出「直刺」冒充「横挥」——
 * 帧数、时长、成色全部正常，只有看画面才发现。那两个继续走 i2v。
 */
export type Render3DMotion = 'walk' | 'idle' | 'jump'

/** 每个动作各是一次绑骨。给用户看的价签，与后端 `AUTORIG_CREDITS` 同一个数。 */
export const RENDER3D_MOTION_CREDITS = 10

/** 动作的中文名。界面上不该出现 `walk` 这种取值。 */
export const RENDER3D_MOTION_LABELS: Record<Render3DMotion, string> = {
  walk: '走路',
  idle: '待机',
  jump: '跳跃',
}

/** 角色体型。决定这条路线能不能给它绑骨；与后端 `CharacterStance` 同一取值域。 */
export type CharacterStance = 'biped' | 'quadruped' | 'serpentine'

export interface Render3DApis {
  /** 零成本母版预检。**不触发任何按次计费调用**,确认闸上可以随便调。 */
  precheckMaster(
    imageUrl: string,
    canvas?: { width: number; height: number },
  ): Promise<MasterPrecheckReport>
  getOutfitAsset(characterId: string, outfitId: string): Promise<Render3DAsset>
  /**
   * 触发图生 3D。**按次计费**,只能由用户的显式操作调用。
   *
   * ``stance`` 必填、无默认:自动绑骨只支持双足,而四足/无肢从模型几何判不出来
   * (实测归档模型的包围盒比例完全重叠)。给默认值等于把"没声明"当成"双足"。
   */
  buildOutfitAsset(
    characterId: string,
    outfitId: string,
    stance: CharacterStance,
  ): Promise<Render3DAsset>
  /** 人看过模型点头 → 继续绑骨。 */
  approveOutfitAsset(characterId: string, outfitId: string): Promise<Render3DAsset>
  /**
   * 给**已建好**的资产再烘一个动作片段。**按次计费**（一次绑骨），只能由显式操作调用。
   *
   * 一份绑骨产物只带一个动作片段（上游一次只吃一个 MotionType），所以「这个角色既会
   * 走也会跳」= 两份产物 = 绑两次骨。图生 3D 那笔不重付。
   */
  addOutfitMotion(
    characterId: string,
    outfitId: string,
    motion: Render3DMotion,
  ): Promise<Render3DAsset>
  /** 模型不合格 → 丢弃重来。 */
  discardOutfitAsset(characterId: string, outfitId: string): Promise<Render3DAsset>
  /** 取该任务的出帧参数;没有登记说明不需要浏览器出帧(或已收口)。 */
  getBakeJob(taskId: number): Promise<BakeJob | null>
  putBakeFrame(taskId: number, index: number, png: Blob): Promise<number>
  completeBake(taskId: number, completion: BakeCompletion): Promise<void>
  /** 渲不出来就早报,别等期限耗完 —— 那笔冻结的积分一直挂着。 */
  failBake(taskId: number, reason: string): Promise<void>
}
