import { ApiError, request, requestList, uploadFile } from '@/shared/api'
import type { Paged, PageQuery } from '@/shared/api'
import type { CreateProjectInput, Project } from './types'

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024

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

/** 后端形状 → 业务对象。 */
function toProject(dto: ProjectDto): Project {
  return {
    id: String(dto.id),
    ownerId: String(dto.user_id),
    workflowId: dto.workflow_id === null ? null : String(dto.workflow_id),
    name: dto.project_name,
    perspective: dto.character_perspective,
    directionalMovement: dto.directional_movement,
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
      character_perspective: input.perspective,
      directional_movement: input.directionalMovement,
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

/**
 * POST /upload/image —— 上传参考图，返回可直接填进 sampleImageUrl 的 URL。
 *
 * 走 multipart 而不是 JSON，所以不经 shared/api 的 request()：那条通道只处理
 * JSON 请求体。不要手动设 Content-Type，浏览器会自动补 multipart boundary。
 * 后端白名单为 jpeg/png/webp/gif；前端先做同一检查，最终仍以后端校验为准。
 */
export async function uploadImage(file: File): Promise<string> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new ApiError('仅支持 jpg/png/webp/gif 图片', 400)
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new ApiError(`文件超过大小上限(${MAX_IMAGE_UPLOAD_BYTES} 字节)`, 400)
  }

  const payload = await uploadFile<{ url: string }>('/upload/image', file)
  return payload.url
}
