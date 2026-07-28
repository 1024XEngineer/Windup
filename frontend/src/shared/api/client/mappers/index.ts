/** 传输格式的通用转换与错误映射。不认识任何业务概念。 */

/** 后端统一响应，见 windup_common/result/response.py（PR #57）。成功 code = 200。 */
export interface ApiResponse<T> {
  /** 业务状态码；当前约定 200 表示成功，非 200 由 unwrap 转成 ApiError。 */
  code: number
  /** 后端返回的可读结果或失败说明。 */
  message: string
  /** 成功响应的数据主体；无返回对象的成功操作可以为 null。 */
  data: T | null
  /** 后端可选的响应生成时间；格式需以后端 OpenAPI 为准。 */
  timestamp?: string
}

/** 列表响应，多三个分页字段，data 恒为数组。 */
export interface ApiListResponse<T> {
  /** 业务状态码；当前约定 200 表示成功。 */
  code: number
  /** 后端返回的可读结果或失败说明。 */
  message: string
  /** 当前页的数据项，空页返回空数组。 */
  data: T[]
  /** 满足本次查询条件的数据总条数。 */
  total: number
  /** 后端返回的当前页码；当前约定从 1 开始。 */
  page: number
  /** 后端实际采用的每页条数。 */
  page_size: number
  /** 后端可选的响应生成时间；格式需以后端 OpenAPI 为准。 */
  timestamp?: string
}

/** 分页入参，各处列表统一用这份。 */
export interface PageQuery {
  /** 请求页码，当前约定从 1 开始；省略时由具体 Entity 提供默认值。 */
  page?: number
  /** 每页条数；传输层会映射为后端的 page_size。 */
  pageSize?: number
}

/** 去除后端响应壳并转换为前端命名后的分页结果。 */
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

/** code !== 200 时抛出，用于区分业务失败与网络失败。 */
export class ApiError extends Error {
  /** 后端业务状态码；用于区分具体业务失败。 */
  readonly code: number

  constructor(message: string, code: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** 拆掉响应壳，业务失败翻成 ApiError。 */
export function unwrap<T>(payload: ApiResponse<T>): T | null {
  if (payload.code !== 200) throw new ApiError(payload.message, payload.code)
  return payload.data
}

/** 拆列表响应，顺带把 page_size 翻成前端命名。 */
export function unwrapList<T>(payload: ApiListResponse<T>): Paged<T> {
  if (payload.code !== 200) throw new ApiError(payload.message, payload.code)
  return {
    items: payload.data,
    total: payload.total,
    page: payload.page,
    pageSize: payload.page_size,
  }
}
