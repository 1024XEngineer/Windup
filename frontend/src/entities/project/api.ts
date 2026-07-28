import { request, requestList } from '@/shared/api'
import type { Paged, PageQuery } from '@/shared/pagination'
import type {
  CharacterPerspective,
  CreateProjectInput,
  DirectionalMovement,
  Project,
} from './types'

/** 后端原始形状，只在本文件出现；出了这里全项目只认 Project。 */
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

/** TODO(对后端)：user_id 应由后端从 token 推出，不该前端传。暂时写死。 */
const CURRENT_USER_ID = 1

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

/** GET /projects */
export async function fetchProjects(query: PageQuery = {}): Promise<Paged<Project>> {
  const paged = await requestList<ProjectDto>('/projects', {
    query: {
      page: query.page ?? 1,
      page_size: query.pageSize ?? 20,
      user_id: CURRENT_USER_ID,
    },
  })
  return { ...paged, items: paged.items.map(toProject) }
}

/** GET /projects/{id}，不存在时抛 ApiError(404)。 */
export async function fetchProject(id: string): Promise<Project> {
  const dto = await request<ProjectDto>(`/projects/${id}`)
  if (!dto) throw new Error(`项目 ${id} 返回为空`)
  return toProject(dto)
}

/** POST /projects，重名时抛 ApiError(400)。 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const dto = await request<ProjectDto>('/projects', {
    method: 'POST',
    body: {
      user_id: CURRENT_USER_ID,
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
}

/** DELETE /projects/{id} */
export async function deleteProject(id: string): Promise<void> {
  await request<null>(`/projects/${id}`, { method: 'DELETE' })
}
