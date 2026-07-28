import type { Paged, PageQuery } from '@/shared/pagination'
import type { CreateProjectInput, Project } from './types'

/** Project Repository 的实现来源；生产应用组合只能使用 real。 */
export type ProjectRepositoryAdapterKind = 'real' | 'mock'

/**
 * Project 的异步存取端口。
 * 页面和用例始终依赖 Promise 形状，不关心背后是真实 HTTP 还是开发内存实现。
 */
export interface ProjectRepository {
  readonly adapterKind: ProjectRepositoryAdapterKind
  list(query?: PageQuery): Promise<Paged<Project>>
  get(id: Project['id']): Promise<Project>
  create(input: CreateProjectInput): Promise<Project>
  remove(id: Project['id']): Promise<void>
}
