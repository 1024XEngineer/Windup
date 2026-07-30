/**
 * Project 实体及创建输入。
 *
 * Project 是 Character、WorkflowRun 和生成记录的顶层归属边界。字段只保留当前
 * 产品已确认的游戏视角、方向、精灵尺寸和画风信息；后端枚举映射尚未冻结的部分
 * 会明确标注，避免把临时前端值伪装成正式 API 合同。
 */
/**
 * Project 采用的角色观察视角。
 *
 * 持久化枚举统一使用 snake_case：`side_view` 表示横版侧视，`top_down` 表示俯视，
 * `isometric` 表示等距视角。与后端枚举的最终映射尚未冻结。
 */
export type CharacterPerspective = 'side_view' | 'top_down' | 'isometric'

/**
 * Project 要求每个动作覆盖的方向模式。
 *
 * 该类型只回答“需要几个方向”，不表示某张图的实际朝向；具体朝向由
 * `SpriteDirection` 表达。四方向和八方向值使用 snake_case，与其他持久化枚举
 * 保持一致。
 */
export type DirectionMode = 'single' | 'four_way' | 'eight_way'

/**
 * 精灵图在画面中的明确朝向。
 *
 * `default` 用于不区分朝向的单方向项目；四方向使用四个正方向，八方向在此基础上
 * 增加四个斜方向。该命名不绑定键盘按键或模型供应商，适合被 BaseFrame、Action
 * 和 Playtest 共同复用。
 */
export type SpriteDirection =
  | 'default'
  | 'north'
  | 'north_east'
  | 'east'
  | 'south_east'
  | 'south'
  | 'south_west'
  | 'west'
  | 'north_west'

/** Project 是角色、动作及生成记录的归属边界。 */
export interface Project {
  /** Project 的稳定业务标识。 */
  id: string
  /** 用户可编辑的项目名称。 */
  name: string
  perspective: CharacterPerspective
  /** 单方向、四方向或八方向的资产覆盖要求。 */
  directionMode: DirectionMode
  /** 目标精灵宽高，单位为像素。 */
  spriteSize: { width: number; height: number }
  /** 项目级画风说明；未设置时为 null。 */
  gameStyle: string | null
  /** 项目级画风参考图；媒体合同冻结前保持 URL 形状。 */
  sampleImageUrl: string | null
  /** ISO 8601 时间。 */
  createdAt: string
  /** ISO 8601 时间。 */
  updatedAt: string
}

/** 创建 Project 所需的前端字段。 */
export interface CreateProjectInput {
  name: string
  perspective: CharacterPerspective
  directionMode: DirectionMode
  spriteSize: { width: number; height: number }
  gameStyle?: string | null
  sampleImageUrl?: string | null
}

/** 修改既有 Project 的可编辑字段；未提供的字段保持不变。 */
export interface UpdateProjectInput {
  name?: string
  perspective?: CharacterPerspective
  directionMode?: DirectionMode
  spriteSize?: { width: number; height: number }
  gameStyle?: string | null
  sampleImageUrl?: string | null
}
