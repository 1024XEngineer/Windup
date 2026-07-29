import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'
import type { Paged, PageQuery } from '@/shared/pagination'
import type { ProjectRepository } from './repository'
import type { Project } from './types'

/** Project 当前只保留前端领域形状与异步 Repository Port，真实 API 契约已撤回。 */

export type { ProjectRepository } from './repository'
export { CHARACTER_PERSPECTIVE, DIRECTIONAL_MOVEMENT, SPRITE_SIZES } from './types'
export type {
  CharacterPerspective,
  CreateProjectInput,
  DirectionalMovement,
  Project,
} from './types'

/** 订阅项目列表。 */
export function useProjects(
  repository: ProjectRepository,
  query: PageQuery = {},
): AsyncState<Paged<Project>> {
  return useAsync(() => repository.list(query), [repository, query.page, query.pageSize])
}

/** 订阅单个项目。 */
export function useProject(repository: ProjectRepository, id: Project['id']): AsyncState<Project> {
  return useAsync(() => repository.get(id), [repository, id])
}
