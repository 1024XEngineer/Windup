export type ApiQueryValue = string | number | boolean | null | undefined

export type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | null
  json?: unknown
  query?: Record<string, ApiQueryValue>
}

/** 后端 ListResponse 解包后的传输结果。 */
export interface ApiListResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface ApiClient {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>
  requestList<T>(path: string, options?: ApiRequestOptions): Promise<ApiListResult<T>>
}

export interface ApiClientOptions {
  /** 默认读取 VITE_API_BASE_URL；测试或独立环境可显式覆盖。 */
  baseUrl?: string
  fetchFn?: typeof fetch
  /** 只在请求发出时读取；token 的取得、保存与刷新由调用方负责。 */
  getAccessToken?: () => string | null | undefined
}

export type ApiAccessTokenProvider = NonNullable<ApiClientOptions['getAccessToken']>

const accessTokenProviders: ApiAccessTokenProvider[] = []

/**
 * 注册登录模块持有的 token 读取函数；这里只保存读取函数，不保存、刷新或解析 token。
 * 返回值用于模块卸载或测试结束时撤销本次注册。
 */
export function registerApiAccessTokenProvider(provider: ApiAccessTokenProvider): () => void {
  accessTokenProviders.push(provider)
  return () => {
    const index = accessTokenProviders.lastIndexOf(provider)
    if (index >= 0) accessTokenProviders.splice(index, 1)
  }
}

/** 业务 API 实例统一传给 createApiClient 的惰性 token 读取边界。 */
export function getApiAccessToken(): string | null | undefined {
  return accessTokenProviders.at(-1)?.()
}

export type ApiErrorKind = 'business' | 'http' | 'invalid-response' | 'network'

/** 后端业务错误与传输错误统一进入这一种前端错误。 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly code: number | null
  readonly status: number | null
  readonly data: unknown

  constructor(
    message: string,
    options: {
      kind: ApiErrorKind
      code?: number | null
      status?: number | null
      data?: unknown
      cause?: unknown
    },
  ) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.kind = options.kind
    this.code = options.code ?? null
    this.status = options.status ?? null
    this.data = options.data ?? null
  }
}

interface ApiEnvelope {
  code: number
  message: string
  data: unknown
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readEnvelope(response: Response): Promise<ApiEnvelope> {
  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    throw new ApiError(response.ok ? '后端响应格式无效' : 'HTTP 请求失败', {
      kind: response.ok ? 'invalid-response' : 'http',
      status: response.status,
      cause,
    })
  }

  if (
    !isRecord(value) ||
    typeof value.code !== 'number' ||
    typeof value.message !== 'string' ||
    !Object.hasOwn(value, 'data')
  ) {
    throw new ApiError(response.ok ? '后端响应格式无效' : 'HTTP 请求失败', {
      kind: response.ok ? 'invalid-response' : 'http',
      status: response.status,
      data: value,
    })
  }

  return value as ApiEnvelope
}

/** 后端业务异常仍返回 HTTP 200，因此不能只依赖 Response.ok。 */
function assertSuccessfulEnvelope(response: Response, envelope: ApiEnvelope): void {
  if (!response.ok) {
    throw new ApiError('HTTP 请求失败', {
      kind: 'http',
      status: response.status,
      data: envelope.data,
    })
  }

  if (envelope.code !== 200) {
    throw new ApiError(envelope.message, {
      kind: 'business',
      code: envelope.code,
      status: response.status,
      data: envelope.data,
    })
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, ApiQueryValue> | undefined,
): string {
  const url = `${baseUrl}/${path.replace(/^\/+/, '')}`
  if (!query) return url

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) search.set(key, String(value))
  }

  const serialized = search.toString()
  if (!serialized) return url
  return `${url}${url.includes('?') ? '&' : '?'}${serialized}`
}

function buildRequestInit(
  options: ApiRequestOptions | undefined,
  accessToken: string | null | undefined,
): RequestInit | undefined {
  if (!options && !accessToken) return undefined

  const { json, query: _query, headers: inputHeaders, ...init } = options ?? {}
  const headers = new Headers(inputHeaders)
  if (accessToken && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${accessToken}`)
  }
  if (json === undefined) return { ...init, headers }

  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return { ...init, headers, body: JSON.stringify(json) }
}

export function resolveApiBaseUrl(baseUrl = import.meta.env.VITE_API_BASE_URL): string {
  const normalized = baseUrl?.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('VITE_API_BASE_URL 未配置')
  return normalized
}

/** 创建一个只负责 HTTP 传输与公共响应解包的客户端。 */
export function createApiClient({
  baseUrl,
  fetchFn = globalThis.fetch,
  getAccessToken,
}: ApiClientOptions): ApiClient {
  const normalizedBaseUrl = resolveApiBaseUrl(baseUrl)

  async function send(path: string, options: ApiRequestOptions | undefined): Promise<Response> {
    const url = buildUrl(normalizedBaseUrl, path, options?.query)
    const init = buildRequestInit(options, getAccessToken?.())
    try {
      return await fetchFn(url, init)
    } catch (cause) {
      throw new ApiError('网络请求失败', { kind: 'network', cause })
    }
  }

  return {
    async request<T>(path: string, options?: ApiRequestOptions) {
      const response = await send(path, options)
      const envelope = await readEnvelope(response)
      assertSuccessfulEnvelope(response, envelope)

      return envelope.data as T
    },
    async requestList<T>(path: string, options?: ApiRequestOptions) {
      const response = await send(path, options)
      const envelope = await readEnvelope(response)
      assertSuccessfulEnvelope(response, envelope)

      if (
        !Array.isArray(envelope.data) ||
        !Number.isInteger(envelope.total) ||
        !Number.isInteger(envelope.page) ||
        !Number.isInteger(envelope.page_size)
      ) {
        throw new ApiError('后端列表响应格式无效', {
          kind: 'invalid-response',
          status: response.status,
          data: envelope,
        })
      }

      return {
        items: envelope.data as T[],
        total: envelope.total as number,
        page: envelope.page as number,
        pageSize: envelope.page_size as number,
      }
    },
  }
}
