import { ApiError, createApiClient, getApiAccessToken } from '@/shared/api'
import type { Paged, PageQuery } from '@/shared/pagination'

/** Project 前端领域形状；字段名由本模块显式映射后端 ProjectOut。 */
export interface Project {
  id: string
  ownerId: string
  workflowId: string | null
  name: string
  perspective: CharacterPerspective
  directionalMovement: DirectionalMovement
  spriteSize: { width: number; height: number }
  gameStyle: string | null
  sampleImageUrl: string | null
  createdAt: string
  updatedAt: string
}

/** 后端创建 Project 需要的完整字段；创建流程本身不属于资产库页面。 */
export interface CreateProjectInput {
  ownerId: string
  workflowId?: string | null
  name: string
  perspective: CharacterPerspective
  directionalMovement: DirectionalMovement
  spriteSize: { width: number; height: number }
  gameStyle?: string | null
  sampleImageUrl?: string | null
}

export interface ProjectPageQuery extends PageQuery {
  /** 对应后端 user_id；后端按登录用户强制隔离前保持可选。 */
  ownerId?: string
}

/** 后端 character_perspective: 1 横版 / 2 俯视 / 3 2.5D。 */
export type CharacterPerspective = 'side' | 'top-down' | 'isometric'

/** 后端 directional_movement: 1 单向 / 2 四向 / 3 八向。 */
export type DirectionalMovement = 'single' | 'four-way' | 'eight-way'

export const CHARACTER_PERSPECTIVE: Record<CharacterPerspective, string> = {
  side: '横版视角',
  'top-down': '俯视',
  isometric: '2.5D',
}

export const DIRECTIONAL_MOVEMENT: Record<DirectionalMovement, string> = {
  single: '单向',
  'four-way': '四向',
  'eight-way': '八向',
}

/** Project 对应的一组后端接口。PR #75 未提供更新端点，因此这里不声明 update。 */
export interface ProjectApis {
  list(query?: ProjectPageQuery): Promise<Paged<Project>>
  get(id: Project['id']): Promise<Project>
  create(input: CreateProjectInput): Promise<Project>
  remove(id: Project['id']): Promise<void>
}

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

const perspectiveFromDto: Record<number, CharacterPerspective> = {
  1: 'side',
  2: 'top-down',
  3: 'isometric',
}

const perspectiveToDto: Record<CharacterPerspective, number> = {
  side: 1,
  'top-down': 2,
  isometric: 3,
}

const movementFromDto: Record<number, DirectionalMovement> = {
  1: 'single',
  2: 'four-way',
  3: 'eight-way',
}

const movementToDto: Record<DirectionalMovement, number> = {
  single: 1,
  'four-way': 2,
  'eight-way': 3,
}

function mapEnumValue<T>(value: number, values: Record<number, T>, field: string): T {
  const mapped = values[value]
  if (mapped !== undefined) return mapped
  throw new ApiError(`后端 Project.${field} 无效`, {
    kind: 'invalid-response',
    data: value,
  })
}

function toBackendId(value: string, field: string): number {
  const parsed = Number(value)
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  throw new TypeError(`${field} 必须是正整数 ID`)
}

function mapProject(dto: ProjectDto): Project {
  return {
    id: String(dto.id),
    ownerId: String(dto.user_id),
    workflowId: dto.workflow_id === null ? null : String(dto.workflow_id),
    name: dto.project_name,
    perspective: mapEnumValue(
      dto.character_perspective,
      perspectiveFromDto,
      'character_perspective',
    ),
    directionalMovement: mapEnumValue(
      dto.directional_movement,
      movementFromDto,
      'directional_movement',
    ),
    spriteSize: { width: dto.sprite_width, height: dto.sprite_height },
    gameStyle: dto.game_style,
    sampleImageUrl: dto.sprite_sample_url,
    createdAt: dto.create_at,
    updatedAt: dto.update_at,
  }
}

function getApiClient() {
  return createApiClient({ getAccessToken: getApiAccessToken })
}

export const projectApis: ProjectApis = {
  async list(query = {}) {
    const result = await getApiClient().requestList<ProjectDto>('/projects', {
      query: {
        page: query.page,
        page_size: query.pageSize,
        user_id: query.ownerId ? toBackendId(query.ownerId, 'ownerId') : undefined,
      },
    })
    return { ...result, items: result.items.map(mapProject) }
  },

  async get(id) {
    return mapProject(
      await getApiClient().request<ProjectDto>(`/projects/${encodeURIComponent(id)}`),
    )
  },

  async create(input) {
    const dto = await getApiClient().request<ProjectDto>('/projects', {
      method: 'POST',
      json: {
        user_id: toBackendId(input.ownerId, 'ownerId'),
        workflow_id:
          input.workflowId === undefined
            ? undefined
            : input.workflowId === null
              ? null
              : toBackendId(input.workflowId, 'workflowId'),
        project_name: input.name,
        character_perspective: perspectiveToDto[input.perspective],
        directional_movement: movementToDto[input.directionalMovement],
        sprite_width: input.spriteSize.width,
        sprite_height: input.spriteSize.height,
        game_style: input.gameStyle,
        sprite_sample_url: input.sampleImageUrl,
      },
    })
    return mapProject(dto)
  },

  async remove(id) {
    await getApiClient().request<null>(`/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
}
