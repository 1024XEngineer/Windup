/** 传输格式的通用转换与错误映射。不认识任何业务概念。 */

/** 后端统一响应，见 windup_common/result/response.py（PR #57）。成功 code = 200。 */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T | null
  timestamp?: string
}

/** 列表响应，多三个分页字段，data 恒为数组。 */
export interface ApiListResponse<T> {
  code: number
  message: string
  data: T[]
  total: number
  page: number
  page_size: number
  timestamp?: string
}

/** 分页入参，各处列表统一用这份。 */
export interface PageQuery {
  page?: number
  pageSize?: number
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** code !== 200 时抛出，用于区分业务失败与网络失败。 */
export class ApiError extends Error {
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
