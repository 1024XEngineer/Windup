import type { Paged, PageQuery } from '@/shared/pagination'

/** Project 前端领域形状；字段只表达当前页面需要，不对应任何已确认后端 DTO。 */
export interface Project {
  id: string
  /** Project 所属用户 ID；认证来源尚未冻结。 */
  ownerId: string
  name: string
  /** 游戏视角，见 CHARACTER_PERSPECTIVE。 */
  perspective: CharacterPerspective
  /** 移动方向，见 DIRECTIONAL_MOVEMENT。 */
  directionalMovement: DirectionalMovement
  /** 当前页面使用建议档位，后端范围尚未确认。 */
  spriteSize: { width: number; height: number }
  /** 项目级画风描述，作为本项目所有角色和动作生成的视觉约束。 */
  gameStyle: string | null
  /**
   * 项目级画风参考图，本项目所有角色和动作都遵循它的视觉风格。
   * 它不决定某个角色具体长什么样；角色自身参考图由 CreateCharacterInput.referenceImageUrl 表达。
   */
  sampleImageUrl: string | null
  /** ISO 8601 字符串。 */
  createdAt: string
  /** ISO 8601 字符串。 */
  updatedAt: string
}

/** 新建项目的入参。 */
export interface CreateProjectInput {
  name: string
  perspective: CharacterPerspective
  directionalMovement: DirectionalMovement
  spriteSize: { width: number; height: number }
  gameStyle?: string | null
  sampleImageUrl?: string | null
}

/** 更新项目设置的入参；未提供的字段保持不变。 */
export interface UpdateProjectInput {
  name?: string
  perspective?: CharacterPerspective
  directionalMovement?: DirectionalMovement
  spriteSize?: { width: number; height: number }
  gameStyle?: string | null
  sampleImageUrl?: string | null
}

/** 前端使用的游戏视角枚举；后端映射尚未冻结。 */
export type CharacterPerspective = 'side' | 'top-down' | 'isometric'

/** 前端使用的移动方向枚举；后端映射尚未冻结。 */
export type DirectionalMovement = 'single' | 'four-way' | 'eight-way'

/** 游戏视角的页面文案。 */
export const CHARACTER_PERSPECTIVE: Record<CharacterPerspective, string> = {
  side: '横版视角',
  'top-down': '俯视',
  isometric: '2.5D',
}

/**
 * 移动方向，决定一个动作要生成几套朝向的帧。
 * 多朝向在 Action 上如何存放尚未定义，当前 Action.frames 只表达单朝向；
 * 选了四向/八向的项目，生成侧还接不上，见 Action.frames 的说明。
 */
export const DIRECTIONAL_MOVEMENT: Record<DirectionalMovement, string> = {
  single: '单向',
  'four-way': '四向',
  'eight-way': '八向',
}

/** UI 使用的建议尺寸档位；不代表后端约束。 */
export const SPRITE_SIZES = [32, 64, 128, 256, 512, 1024, 2048] as const

/** Project 对应的一组后端接口。 */
export interface ProjectApis {
  list(query?: PageQuery): Promise<Paged<Project>>
  get(id: Project['id']): Promise<Project>
  create(input: CreateProjectInput): Promise<Project>
  update(id: Project['id'], input: UpdateProjectInput): Promise<Project>
  remove(id: Project['id']): Promise<void>
}
