const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
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

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`
  const headers = new Headers(init?.headers)

  if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) {
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

  let envelope: ApiEnvelope<T>
  try {
    envelope = (await response.json()) as ApiEnvelope<T>
  } catch {
    throw new ApiError(response.status, response.status, '响应格式错误，无法解析 JSON')
  }
  if (envelope.data === null || envelope.data === undefined) {
    throw new ApiError(
      response.status,
      envelope.code ?? response.status,
      envelope.message || '服务端未返回数据',
    )
  }
  return envelope.data
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path)
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

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

export function upload<T>(path: string, formData: FormData): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: formData,
  })
}
