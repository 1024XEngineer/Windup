/** 与传输协议无关的分页请求形状。 */
export interface PageQuery {
  page?: number
  pageSize?: number
}

/** 与传输协议无关的分页结果形状。 */
export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
