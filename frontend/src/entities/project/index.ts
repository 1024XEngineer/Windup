import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'
import type { Paged, PageQuery } from '@/shared/pagination'
import type { ProjectRepository } from './repository'
import type { Project } from './types'

/** 项目业务边界；现有 HTTP Repository 来自 PR #57，仅供开发候选联调。 */

export { createHttpProjectRepository } from './http-repository'
export type { CreateHttpProjectRepositoryOptions } from './http-repository'
export type { ProjectRepository, ProjectRepositoryAdapterKind } from './repository'
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
