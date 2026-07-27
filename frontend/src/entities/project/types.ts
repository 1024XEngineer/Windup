/**
 * 项目：角色生成的容器，保存全局约束（视角、尺寸、画风）。
 * 字段对照后端 ProjectOut（PR #57），命名转换在 ./api.ts。
 */
export interface Project {
  id: string
  /** 后端目前要求前端显式传 user_id，无登录态前写死。 */
  ownerId: string
  /** 未开始生成时为 null。 */
  workflowId: string | null
  /** 后端限制 1–20 字符，同一用户下不可重名。 */
  name: string
  /** 游戏视角，见 CHARACTER_PERSPECTIVE。 */
  perspective: number
  /** 移动方向，见 DIRECTIONAL_MOVEMENT。 */
  directionalMovement: number
  /** 后端校验 32–2048，实际取 SPRITE_SIZES 里的档位。 */
  spriteSize: { width: number; height: number }
  /** 会进生成提示词。 */
  gameStyle: string | null
  /** 由 POST /upload/image 上传后拿到。 */
  sampleImageUrl: string | null
  createdAt: string
  updatedAt: string
}

/** 新建项目的入参。 */
export interface CreateProjectInput {
  name: string
  perspective: number
  directionalMovement: number
  spriteSize: { width: number; height: number }
  gameStyle?: string | null
  sampleImageUrl?: string | null
}

/** 游戏视角。取值与含义来自 windup_project 表注释（2026-07-27 后端接口文档）。 */
export const CHARACTER_PERSPECTIVE: Record<number, string> = {
  1: '横版视角',
  2: '俯视',
  3: '2.5D',
}

/** 移动方向，决定一个动作要生成几套朝向的帧。 */
export const DIRECTIONAL_MOVEMENT: Record<number, string> = {
  1: '单向',
  2: '四向',
  3: '八向',
}

/**
 * 精灵图尺寸档位，来自 windup_project 表注释。
 *
 * 注意：接口文档与 pydantic 校验写的是「32～2048 任意整数」，表注释列的却是这七个档。
 * 前端按档位做选择器，避免用户填出后端不打算支持的尺寸。TODO(对后端)：以哪个为准。
 */
export const SPRITE_SIZES = [32, 64, 128, 256, 512, 1024, 2048] as const
