import type { CreateProjectInput, Project, ProjectApis, ProjectPageQuery } from '.'
import type { Paged } from '@/shared/pagination'

import { del, get, getPage, post } from '@/shared/api'

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

const MOVEMENT_MAP: Record<number, Project['directionalMovement']> = {
  1: 'single',
  2: 'four-way',
  3: 'eight-way',
}

function toProject(raw: BackendProject): Project {
  return {
    id: String(raw.id),
    ownerId: String(raw.user_id),
    workflowId: raw.workflow_id === null ? null : String(raw.workflow_id),
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

function toPositiveId(value: string | undefined, fallback: number, field: string): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${field} 必须是正整数 ID`)
  }
  return parsed
}

function toCreatePayload(input: CreateProjectInput) {
  return {
    user_id: toPositiveId(input.ownerId, 1, 'ownerId'),
    workflow_id:
      input.workflowId === undefined || input.workflowId === null
        ? (input.workflowId ?? null)
        : toPositiveId(input.workflowId, 1, 'workflowId'),
    project_name: input.name,
    character_perspective: { side: 1, 'top-down': 2, isometric: 3 }[input.perspective],
    directional_movement: { single: 1, 'four-way': 2, 'eight-way': 3 }[input.directionalMovement],
    sprite_width: input.spriteSize.width,
    sprite_height: input.spriteSize.height,
    game_style: input.gameStyle ?? null,
    sprite_sample_url: input.sampleImageUrl ?? null,
  }
}

/* ─── 适配器 ─── */

export function createProjectApis(): ProjectApis {
  return {
    async list(query?: ProjectPageQuery): Promise<Paged<Project>> {
      const params = new URLSearchParams()
      if (query?.page) params.set('page', String(query.page))
      if (query?.pageSize) params.set('page_size', String(query.pageSize))
      if (query?.ownerId) params.set('user_id', String(toPositiveId(query.ownerId, 1, 'ownerId')))
      const qs = params.toString()
      const result = await getPage<BackendProject>(`/projects${qs ? `?${qs}` : ''}`)
      return { ...result, items: result.items.map(toProject) }
    },

    async get(id: string): Promise<Project> {
      const raw = await get<BackendProject>(`/projects/${encodeURIComponent(id)}`)
      return toProject(raw)
    },

    async create(input: CreateProjectInput): Promise<Project> {
      return toProject(await post<BackendProject>('/projects', toCreatePayload(input)))
    },

    async remove(id: string): Promise<void> {
      await del(`/projects/${encodeURIComponent(id)}`)
    },
  }
}
