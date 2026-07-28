/** 只管真实 HTTP 传输：拼 URL、发请求、拆响应壳，不认识业务概念。 */
import { unwrap, unwrapList } from './client/mappers'
import type { ApiListResponse, ApiResponse } from './client/mappers'
import { realRequest } from './client/real'
import type { RequestOptions } from './client/types'
import type { Paged } from '@/shared/pagination'

/** 取单个对象。code !== 200 时抛 ApiError，调用方不必判断 code。 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T | null> {
  return unwrap(await realRequest<ApiResponse<T>>(path, options))
}

/** 取列表。 */
export async function requestList<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Paged<T>> {
  return unwrapList(await realRequest<ApiListResponse<T>>(path, options))
}

export { ApiError } from './client/mappers'
export type { ApiListResponse, ApiResponse } from './client/mappers'
export type { RequestOptions } from './client/types'
export { uploadFile } from './upload'
