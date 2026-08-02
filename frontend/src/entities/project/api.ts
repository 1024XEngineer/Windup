import type { CreateProjectInput, Project, ProjectApis } from '.'
import type { Paged, PageQuery } from '@/shared/pagination'

import { del, get, post } from '@/shared/api'

/* ─── 后端 DTO ─── */

interface BackendProject {
  id: number
  user_id: number
  project_name: string
  character_perspective: number
  directional_movement: number
  sprite_width: number
  sprite_height: number
  workflow_id: number | null
  game_style: string | null
  sprite_sample_url: string | null
  create_at: string
  update_at: string
}

/* ─── 映射 ─── */

const PERSPECTIVE_MAP: Record<number, Project['perspective']> = {
  1: 'side',
  2: 'top-down',
  3: 'isometric',
}

const PERSPECTIVE_REVERSE: Record<Project['perspective'], number> = {
  side: 1,
  'top-down': 2,
  isometric: 3,
}

const MOVEMENT_MAP: Record<number, Project['directionalMovement']> = {
  1: 'single',
  2: 'four-way',
  3: 'eight-way',
}

const MOVEMENT_REVERSE: Record<Project['directionalMovement'], number> = {
  single: 1,
  'four-way': 2,
  'eight-way': 3,
}

function toProject(raw: BackendProject): Project {
  return {
    id: String(raw.id),
    ownerId: String(raw.user_id),
    name: raw.project_name,
    perspective: PERSPECTIVE_MAP[raw.character_perspective] ?? 'side',
    directionalMovement: MOVEMENT_MAP[raw.directional_movement] ?? 'single',
    spriteSize: { width: raw.sprite_width, height: raw.sprite_height },
    gameStyle: raw.game_style,
    sampleImageUrl: raw.sprite_sample_url,
    createdAt: raw.create_at,
    updatedAt: raw.update_at,
  }
}

function toCreatePayload(input: CreateProjectInput) {
  return {
    user_id: 1, // TODO: 接入认证后替换为实际用户 ID
    project_name: input.name,
    character_perspective: PERSPECTIVE_REVERSE[input.perspective],
    directional_movement: MOVEMENT_REVERSE[input.directionalMovement],
    sprite_width: input.spriteSize.width,
    sprite_height: input.spriteSize.height,
    game_style: input.gameStyle ?? null,
    sprite_sample_url: input.sampleImageUrl ?? null,
  }
}

/* ─── 适配器 ─── */

export function createProjectApis(): ProjectApis {
  return {
    async list(query?: PageQuery): Promise<Paged<Project>> {
      const params = new URLSearchParams()
      if (query?.page) params.set('page', String(query.page))
      if (query?.pageSize) params.set('page_size', String(query.pageSize))
      const qs = params.toString()
      // http-client 已解包 ApiEnvelope，data 字段就是项目数组本身
      const raw = await get<BackendProject[]>(`/projects${qs ? `?${qs}` : ''}`)
      return {
        items: raw.map(toProject),
        total: raw.length,
        page: query?.page ?? 1,
        pageSize: query?.pageSize ?? raw.length,
      }
    },

    async get(id: string): Promise<Project> {
      const raw = await get<BackendProject>(`/projects/${id}`)
      return toProject(raw)
    },

    async create(input: CreateProjectInput): Promise<Project> {
      const raw = await post<BackendProject>('/projects', toCreatePayload(input))
      return toProject(raw)
    },

    async remove(id: string): Promise<void> {
      await del(`/projects/${id}`)
    },
  }
}
