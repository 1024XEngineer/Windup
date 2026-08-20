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
  totalCny: number
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
  error: string | null
  cost: Render3DAssetCost
}

export interface Render3DApis {
  /** 零成本母版预检。**不触发任何按次计费调用**,确认闸上可以随便调。 */
  precheckMaster(
    imageUrl: string,
    canvas?: { width: number; height: number },
  ): Promise<MasterPrecheckReport>
  getOutfitAsset(characterId: string, outfitId: string): Promise<Render3DAsset>
  /** 触发图生 3D。**按次计费**,只能由用户的显式操作调用。 */
  buildOutfitAsset(characterId: string, outfitId: string): Promise<Render3DAsset>
  /** 人看过模型点头 → 继续绑骨。 */
  approveOutfitAsset(characterId: string, outfitId: string): Promise<Render3DAsset>
  /** 模型不合格 → 丢弃重来。 */
  discardOutfitAsset(characterId: string, outfitId: string): Promise<Render3DAsset>
}
