interface ApiEnvelope {
  code: number
  message: string
  data: unknown
}

/**
 * 上传请求已经到达 HTTP/业务协议边界，但服务端没有返回可供业务层使用的数据。
 * status 是 HTTP 状态码，code 是 Windup 响应体中的业务码；两者不能混为一谈，
 * 因为后端的业务异常也会以 HTTP 200 返回。
 */
export class UploadRequestError extends Error {
  readonly status: number
  readonly code: number

  constructor(status: number, code: number, message: string) {
    super(message)
    this.name = 'UploadRequestError'
    this.status = status
    this.code = code
  }
}

/**
 * 上传边界没有拿到后端地址。生产环境绝不能默默退回 127.0.0.1，
 * 因为那个地址指向访问者自己的电脑，而不是 Windup 服务。
 */
export class UploadConfigurationError extends Error {
  constructor() {
    super('媒体上传不可用：请配置 VITE_API_BASE_URL')
    this.name = 'UploadConfigurationError'
  }
}

/**
 * 发送 multipart/form-data，并解开后端统一的 { code, message, data } 响应。
 * 不手动设置 Content-Type：浏览器需要根据当前 FormData 自动补上 boundary。
 * fetch 自身抛出的网络错误和 AbortError 保持原样，调用方可据此区分取消与失败。
 */
export async function upload<T>(
  path: string,
  formData: FormData,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(joinUrl(requireApiBaseUrl(), path), {
    method: 'POST',
    body: formData,
    signal,
  })
  const body = await readResponseBody(response)

  if (!isApiEnvelope(body)) {
    throw new UploadRequestError(
      response.status,
      response.status,
      '上传响应格式错误，缺少有效的 code、message 或 data 字段',
    )
  }

  if (!response.ok || body.code !== 200) {
    throw new UploadRequestError(response.status, body.code, body.message || '上传失败')
  }

  if (body.data === null || body.data === undefined) {
    throw new UploadRequestError(response.status, body.code, '上传成功响应未返回 data')
  }

  return body.data as T
}

function requireApiBaseUrl(): string {
  const value = import.meta.env.VITE_API_BASE_URL
  if (typeof value !== 'string' || value.trim() === '') {
    throw new UploadConfigurationError()
  }
  return value
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    // 请求可能在响应头到达后、响应体读取完成前被取消。此时 json() 也会抛出
    // AbortError；必须保留原错误，调用方才能把用户取消与上传失败区分开。
    if (error instanceof DOMException && error.name === 'AbortError') throw error

    if (!response.ok) {
      throw new UploadRequestError(
        response.status,
        response.status,
        response.statusText || `上传请求失败（HTTP ${response.status}）`,
      )
    }
    throw new UploadRequestError(
      response.status,
      response.status,
      '上传响应格式错误，无法解析 JSON',
    )
  }
}

function isApiEnvelope(value: unknown): value is ApiEnvelope {
  return (
    isRecord(value) &&
    typeof value.code === 'number' &&
    Number.isFinite(value.code) &&
    typeof value.message === 'string' &&
    Object.hasOwn(value, 'data')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}
