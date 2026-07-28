/**
 * 只管传输：拼 URL、发请求、拆响应壳、切换 mock，不认识业务概念。
 * 唯一消费者是 entities，pages / features 不应直接用。
 */
import { mockRequest } from './client/mock'
import { unwrap, unwrapList } from './client/mappers'
import type { ApiListResponse, ApiResponse, Paged } from './client/mappers'
import { realRequest } from './client/real'
import type { RequestOptions } from './client/types'

/** 开发默认 Mock；生产构建永远使用真实 transport，不能回退演示数据。 */
const USE_MOCK = !import.meta.env.PROD && import.meta.env.VITE_USE_MOCK !== 'false'

const send = <R>(path: string, options: RequestOptions): Promise<R> =>
  USE_MOCK ? mockRequest<R>(path, options) : realRequest<R>(path, options)

/** 取单个对象。code !== 200 时抛 ApiError，调用方不必判断 code。 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T | null> {
  return unwrap(await send<ApiResponse<T>>(path, options))
}

/** 取列表。 */
export async function requestList<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Paged<T>> {
  return unwrapList(await send<ApiListResponse<T>>(path, options))
}

export { ApiError } from './client/mappers'
export type { ApiListResponse, ApiResponse, Paged, PageQuery } from './client/mappers'
export type { RequestOptions } from './client/types'
export { uploadFile } from './upload'
