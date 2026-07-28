/**
 * 项目：角色生成的容器，保存全局约束（视角、尺寸、画风）。
 * 字段对照后端 ProjectOut（PR #57），命名转换在 ./api.ts。
 */
export interface Project {
  /** 后端 Project ID；领域层统一转为字符串。 */
  id: string
  /** 后端目前要求前端显式传 user_id，无登录态前写死。 */
  ownerId: string
  /** 未开始生成时为 null。 */
  workflowId: string | null
  /** 后端限制 1–20 字符，同一用户下不可重名。 */
  name: string
  /** 游戏视角，见 CHARACTER_PERSPECTIVE。 */
  perspective: CharacterPerspective
  /** 移动方向，见 DIRECTIONAL_MOVEMENT。 */
  directionalMovement: DirectionalMovement
  /** 后端校验 32–2048，实际取 SPRITE_SIZES 里的档位。 */
  spriteSize: {
    /** 精灵图宽度，单位为像素。 */
    width: number
    /** 精灵图高度，单位为像素。 */
    height: number
  }
  /** 项目级画风描述，会作为本项目所有角色与动作生成的视觉约束。 */
  gameStyle: string | null
  /** 项目级画风参考图；不是生成结果或角色母版，URL 来自 POST /upload/image。 */
  sampleImageUrl: string | null
  /** 项目创建时间，保留后端返回的时间字符串。 */
  createdAt: string
  /** 项目最后更新时间，保留后端返回的时间字符串。 */
  updatedAt: string
}

/** 新建项目的入参。 */
export interface CreateProjectInput {
  /** 项目名称；后端当前限制 1–20 字符，同一用户下不可重名。 */
  name: string
  /** 游戏视角；传输层会映射成后端数字枚举。 */
  perspective: CharacterPerspective
  /** 移动方向；传输层会映射成后端数字枚举。 */
  directionalMovement: DirectionalMovement
  /** 精灵图宽高，单位为像素；当前页面从 SPRITE_SIZES 中选择。 */
  spriteSize: {
    /** 目标精灵图宽度。 */
    width: number
    /** 目标精灵图高度。 */
    height: number
  }
  /** 可选的项目级画风描述；不设置或明确清空时发送 null。 */
  gameStyle?: string | null
  /** 可选的项目级参考图 URL；由图片上传接口返回。 */
  sampleImageUrl?: string | null
}

/** 前端使用的游戏视角枚举；仅在 mapper 中转换为后端数字。 */
export type CharacterPerspective = 'side' | 'top-down' | 'isometric'

/** 前端使用的移动方向枚举；仅在 mapper 中转换为后端数字。 */
export type DirectionalMovement = 'single' | 'four-way' | 'eight-way'

/** 游戏视角。DTO 数字值只在 api mapper 内存在。 */
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

/**
 * 精灵图尺寸档位，来自 windup_project 表注释。
 *
 * 注意：接口文档与 pydantic 校验写的是「32～2048 任意整数」，表注释列的却是这七个档。
 * 前端按档位做选择器，避免用户填出后端不打算支持的尺寸。TODO(对后端)：以哪个为准。
 */
export const SPRITE_SIZES = [32, 64, 128, 256, 512, 1024, 2048] as const
