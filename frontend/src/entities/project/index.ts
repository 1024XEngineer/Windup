import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'
import type { Paged, PageQuery } from '@/shared/api'
import { fetchProject, fetchProjects } from './api'
import type { Project } from './types'

/** 项目。后端 GET/POST /projects、GET/DELETE /projects/{id} 已实现（PR #57）。 */

export { createProject, deleteProject, fetchProject, fetchProjects, uploadImage } from './api'
export { CHARACTER_PERSPECTIVE, DIRECTIONAL_MOVEMENT, SPRITE_SIZES } from './types'
export type {
  CharacterPerspective,
  CreateProjectInput,
  DirectionalMovement,
  Project,
} from './types'

/** 订阅项目列表。 */
export function useProjects(query: PageQuery = {}): AsyncState<Paged<Project>> {
  return useAsync(() => fetchProjects(query), [query.page, query.pageSize])
}

/** 订阅单个项目。 */
export function useProject(id: string): AsyncState<Project> {
  return useAsync(() => fetchProject(id), [id])
}
