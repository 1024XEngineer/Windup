import { ApiError } from '../mappers'
import type { RequestOptions } from '../types'

/** 开发时经 vite proxy 转发到 8000。 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!query) return `${BASE_URL}${path}`
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`
}

/** 发一次真实请求，返回后端原始响应体（含 code/message/data 壳）。 */
export async function realRequest<R>(path: string, options: RequestOptions): Promise<R> {
  const { method = 'GET', body, query } = options
  const response = await fetch(buildUrl(path, query), {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    throw new ApiError(`请求失败：HTTP ${response.status}`, response.status)
  }
  return (await response.json()) as R
}
