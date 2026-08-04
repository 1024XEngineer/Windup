import type { Paged } from '@/shared/pagination'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

interface ApiListEnvelope<T> extends ApiEnvelope<T[]> {
  total: number
  page: number
  page_size: number
}

export class ApiError extends Error {
  /** HTTP 状态码。 */
  readonly status: number
  /** 业务码（与 HTTP 状态码分离）。 */
  readonly code: number

  constructor(status: number, code: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function executeRequest<T>(
  path: string,
  init: RequestInit | undefined,
  allowEmpty: boolean,
): Promise<ApiEnvelope<T>> {
  const url = `${BASE_URL}${path}`
  const headers = new Headers(init?.headers)

  if (
    init?.body !== undefined &&
    init.body !== null &&
    !headers.has('Content-Type') &&
    !(init.body instanceof FormData)
  ) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(url, { ...init, headers })

  if (!response.ok) {
    let code = response.status
    let message = response.statusText
    try {
      const body = (await response.json()) as Partial<ApiEnvelope<unknown>>
      if (body.code !== undefined) code = body.code
      if (body.message) message = body.message
    } catch {
      // 响应体不是 JSON，保留默认错误信息
    }
    throw new ApiError(response.status, code, message)
  }

  if (allowEmpty && response.status === 204) {
    return { code: response.status, message: '', data: undefined as T }
  }

  let envelope: ApiEnvelope<T>
  try {
    envelope = (await response.json()) as ApiEnvelope<T>
  } catch {
    throw new ApiError(response.status, response.status, '响应格式错误，无法解析 JSON')
  }
  // HTTP 200 只说明请求到达服务器，不能代替业务成功。必须先判断业务码，
  // 再处理 DELETE 等允许 data=null 的接口，否则失败信封会被误报为删除成功。
  if (!Number.isInteger(envelope.code) || envelope.code < 200 || envelope.code >= 300) {
    throw new ApiError(
      response.status,
      Number.isInteger(envelope.code) ? envelope.code : response.status,
      envelope.message || '请求失败',
    )
  }
  if (envelope.data === null || envelope.data === undefined) {
    if (allowEmpty) return envelope
    throw new ApiError(
      response.status,
      envelope.code ?? response.status,
      envelope.message || '服务端未返回数据',
    )
  }
  return envelope
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await executeRequest<T>(path, init, false)).data
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

/**
 * 读取后端 ListResponse，保留 data 之外的分页元数据。
 * 普通 get() 只返回 data，分页列表必须使用本入口，不能用当前页长度伪造 total。
 */
export async function getPage<T>(path: string): Promise<Paged<T>> {
  const envelope = (await executeRequest<T[]>(path, undefined, false)) as ApiListEnvelope<T>
  if (
    !Number.isInteger(envelope.total) ||
    envelope.total < 0 ||
    !Number.isInteger(envelope.page) ||
    envelope.page < 1 ||
    !Number.isInteger(envelope.page_size) ||
    envelope.page_size < 0
  ) {
    throw new ApiError(200, envelope.code, '分页响应缺少有效的 total、page 或 page_size')
  }
  return {
    items: envelope.data,
    total: envelope.total,
    page: envelope.page,
    pageSize: envelope.page_size,
  }
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function del(path: string): Promise<void> {
  await executeRequest<unknown>(path, { method: 'DELETE' }, true)
}

export function upload<T>(path: string, formData: FormData): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: formData,
  })
}
