/** 分页入参，各处列表统一用这份。 */
export interface PageQuery {
  /** 请求页码，当前约定从 1 开始；省略时由具体 Entity 提供默认值。 */
  page?: number
  /** 每页条数；具体传输 Adapter 负责映射后端字段名。 */
  pageSize?: number
}

/** 与具体传输协议无关的分页结果。 */
export interface Paged<T> {
  /** 当前页的数据项。 */
  items: T[]
  /** 满足查询条件的数据总条数。 */
  total: number
  /** 当前页码，当前约定从 1 开始。 */
  page: number
  /** 当前页容量。 */
  pageSize: number
}
