/** Project 前端领域骨架；字段只表达当前页面需要，不对应任何已确认后端 DTO。 */
export interface Project {
  /** 前端统一使用的 Project ID。 */
  id: string
  /** Project 所属用户 ID；认证和后端来源尚未冻结。 */
  ownerId: string
  /** 项目展示名称；最终长度和唯一性规则等待正确契约。 */
  name: string
  /** 游戏视角，见 CHARACTER_PERSPECTIVE。 */
  perspective: CharacterPerspective
  /** 移动方向，见 DIRECTIONAL_MOVEMENT。 */
  directionalMovement: DirectionalMovement
  /** 当前页面使用建议档位，后端范围尚未确认。 */
  spriteSize: {
    /** 精灵图宽度，单位为像素。 */
    width: number
    /** 精灵图高度，单位为像素。 */
    height: number
  }
  /** 项目级画风描述，作为本项目所有角色和动作生成的视觉约束。 */
  gameStyle: string | null
  /**
   * 项目级画风参考图，本项目所有角色和动作都遵循它的视觉风格。
   * 它不决定某个角色具体长什么样；角色自身参考图由 CreateCharacterInput.referenceImageUrl 表达。
   * 上传来源和后端媒体引用形式仍等待正式契约。
   */
  sampleImageUrl: string | null
  /** 项目创建时间，使用 ISO 8601 字符串。 */
  createdAt: string
  /** 项目最后更新时间，使用 ISO 8601 字符串。 */
  updatedAt: string
}

/** 新建项目的入参。 */
export interface CreateProjectInput {
  /** 项目名称；最终校验规则等待正确契约。 */
  name: string
  /** 游戏视角。 */
  perspective: CharacterPerspective
  /** 移动方向。 */
  directionalMovement: DirectionalMovement
  /** 精灵图宽高，单位为像素；当前页面从 SPRITE_SIZES 中选择。 */
  spriteSize: {
    /** 目标精灵图宽度。 */
    width: number
    /** 目标精灵图高度。 */
    height: number
  }
  /** 可选的项目级画风描述。 */
  gameStyle?: string | null
  /** 可选的项目级画风参考图；真实上传能力和媒体引用形式尚未接入。 */
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

/** 移动方向，决定一个动作要生成几套朝向的帧。 */
export const DIRECTIONAL_MOVEMENT: Record<DirectionalMovement, string> = {
  single: '单向',
  'four-way': '四向',
  'eight-way': '八向',
}

/** UI 使用的建议尺寸档位；不代表后端约束。 */
export const SPRITE_SIZES = [32, 64, 128, 256, 512, 1024, 2048] as const
