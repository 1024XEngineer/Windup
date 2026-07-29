import type { Paged, PageQuery } from '@/shared/pagination'
import type { CreateProjectInput, Project } from './types'

/**
 * Project 的异步存取端口。
 * 页面和用例始终依赖 Promise 形状，不关心背后是真实 HTTP、开发内存还是未配置实现。
 */
export interface ProjectRepository {
  list(query?: PageQuery): Promise<Paged<Project>>
  get(id: Project['id']): Promise<Project>
  create(input: CreateProjectInput): Promise<Project>
  remove(id: Project['id']): Promise<void>
}
