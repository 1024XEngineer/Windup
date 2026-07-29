import type { Paged, PageQuery } from '@/shared/pagination'
import type { CreateProjectInput, Project } from './types'

/** 当前可装配的 Project Repository 来源；正式 HTTP 契约尚未接入。 */
export type ProjectRepositoryAdapterKind = 'mock' | 'candidate' | 'unavailable'

/**
 * Project 的异步存取端口。
 * 页面和用例始终依赖 Promise 形状，不在业务代码里选择具体实现。
 */
export interface ProjectRepository {
  readonly adapterKind: ProjectRepositoryAdapterKind
  list(query?: PageQuery): Promise<Paged<Project>>
  get(id: Project['id']): Promise<Project>
  create(input: CreateProjectInput): Promise<Project>
  remove(id: Project['id']): Promise<void>
}
