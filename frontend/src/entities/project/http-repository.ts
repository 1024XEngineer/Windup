import { request, requestList } from '@/shared/api'
import type { ProjectRepository } from './repository'
import type {
  CharacterPerspective,
  CreateProjectInput,
  DirectionalMovement,
  Project,
} from './types'

/** 后端原始形状，只在 HTTP Repository 出现；出了这里全项目只认 Project。 */
interface ProjectDto {
  id: number
  user_id: number
  workflow_id: number | null
  project_name: string
  character_perspective: number
  directional_movement: number
  sprite_width: number
  sprite_height: number
  game_style: string | null
  sprite_sample_url: string | null
  create_at: string
  update_at: string
}

export interface CreateHttpProjectRepositoryOptions {
  /** TODO(对后端)：登录接入后应由 token 推出，不再由前端请求参数提供。 */
  currentUserId: number
}

const PERSPECTIVE_FROM_DTO: Record<number, CharacterPerspective> = {
  1: 'side',
  2: 'top-down',
  3: 'isometric',
}
const PERSPECTIVE_TO_DTO: Record<CharacterPerspective, number> = {
  side: 1,
  'top-down': 2,
  isometric: 3,
}
const MOVEMENT_FROM_DTO: Record<number, DirectionalMovement> = {
  1: 'single',
  2: 'four-way',
  3: 'eight-way',
}
const MOVEMENT_TO_DTO: Record<DirectionalMovement, number> = {
  single: 1,
  'four-way': 2,
  'eight-way': 3,
}

/** 后端形状 → 业务对象。 */
function toProject(dto: ProjectDto): Project {
  const perspective = PERSPECTIVE_FROM_DTO[dto.character_perspective]
  const directionalMovement = MOVEMENT_FROM_DTO[dto.directional_movement]
  if (!perspective || !directionalMovement) {
    throw new Error(`项目 ${dto.id} 返回了未知的视角或移动方向`)
  }
  return {
    id: String(dto.id),
    ownerId: String(dto.user_id),
    workflowId: dto.workflow_id === null ? null : String(dto.workflow_id),
    name: dto.project_name,
    perspective,
    directionalMovement,
    spriteSize: { width: dto.sprite_width, height: dto.sprite_height },
    gameStyle: dto.game_style,
    sampleImageUrl: dto.sprite_sample_url,
    createdAt: dto.create_at,
    updatedAt: dto.update_at,
  }
}

/**
 * PR #57 候选 Project HTTP Adapter。
 *
 * PR #64 延续了 Project 模型与响应壳，但尚未提供 HTTP 路由或 OpenAPI；
 * 因此本实现只供开发环境显式联调，不得进入生产组合。
 */
export function createHttpProjectRepository({
  currentUserId,
}: CreateHttpProjectRepositoryOptions): ProjectRepository {
  return {
    adapterKind: 'candidate',

    async list(query = {}) {
      const paged = await requestList<ProjectDto>('/projects', {
        query: {
          page: query.page ?? 1,
          page_size: query.pageSize ?? 20,
          user_id: currentUserId,
        },
      })
      return { ...paged, items: paged.items.map(toProject) }
    },

    async get(id) {
      const dto = await request<ProjectDto>(`/projects/${id}`)
      if (!dto) throw new Error(`项目 ${id} 返回为空`)
      return toProject(dto)
    },

    async create(input: CreateProjectInput) {
      const dto = await request<ProjectDto>('/projects', {
        method: 'POST',
        body: {
          user_id: currentUserId,
          workflow_id: null,
          project_name: input.name,
          character_perspective: PERSPECTIVE_TO_DTO[input.perspective],
          directional_movement: MOVEMENT_TO_DTO[input.directionalMovement],
          sprite_width: input.spriteSize.width,
          sprite_height: input.spriteSize.height,
          game_style: input.gameStyle ?? null,
          sprite_sample_url: input.sampleImageUrl ?? null,
        },
      })
      if (!dto) throw new Error('创建项目未返回数据')
      return toProject(dto)
    },

    async remove(id) {
      await request<null>(`/projects/${id}`, { method: 'DELETE' })
    },
  }
}
