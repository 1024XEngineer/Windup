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
  /** 认证端点关闭此项，避免 refresh 自身的 401 再次触发 refresh。 */
  recoverUnauthorized?: boolean
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

export type ApiUnauthorizedRecovery = () => Promise<boolean>

const unauthorizedRecoveryProviders: ApiUnauthorizedRecovery[] = []

/** 注册会话层提供的 401 恢复函数；请求层不直接持有认证状态。 */
export function registerApiUnauthorizedRecovery(recovery: ApiUnauthorizedRecovery): () => void {
  unauthorizedRecoveryProviders.push(recovery)
  return () => {
    const index = unauthorizedRecoveryProviders.lastIndexOf(recovery)
    if (index >= 0) unauthorizedRecoveryProviders.splice(index, 1)
  }
}

/** 流式适配器也复用同一个恢复边界。 */
export async function recoverApiUnauthorized(): Promise<boolean> {
  const recovery = unauthorizedRecoveryProviders.at(-1)
  if (!recovery) return false
  try {
    return await recovery()
  } catch {
    return false
  }
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

function isAbortError(value: unknown): value is Error {
  return value instanceof Error && value.name === 'AbortError'
}

async function readEnvelope(response: Response): Promise<ApiEnvelope> {
  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    if (isAbortError(cause)) throw cause
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
  // 始终返回 RequestInit，便于所有调用点统一检查请求；空 Headers 不会触发 CORS 预检。
  if (!options && !accessToken) return { headers: new Headers() }
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
  recoverUnauthorized = true,
}: ApiClientOptions): ApiClient {
  const normalizedBaseUrl = resolveApiBaseUrl(baseUrl)

  async function send(path: string, options: ApiRequestOptions | undefined): Promise<Response> {
    const url = buildUrl(normalizedBaseUrl, path, options?.query)
    const init = buildRequestInit(options, getAccessToken?.())
    try {
      return await fetchFn(url, init)
    } catch (cause) {
      if (isAbortError(cause)) throw cause
      throw new ApiError('网络请求失败', { kind: 'network', cause })
    }
  }

  function canReplay(options: ApiRequestOptions | undefined): boolean {
    const body = options?.body
    return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  }

  async function receiveEnvelope(
    path: string,
    options: ApiRequestOptions | undefined,
    replayed = false,
  ): Promise<{ response: Response; envelope: ApiEnvelope | null }> {
    const response = await send(path, options)
    if (response.status === 204) return { response, envelope: null }
    const envelope = await readEnvelope(response)
    if (
      !replayed &&
      recoverUnauthorized &&
      response.status === 200 &&
      envelope.code === 401 &&
      canReplay(options) &&
      (await recoverApiUnauthorized())
    ) {
      return receiveEnvelope(path, options, true)
    }
    return { response, envelope }
  }

  return {
    async request<T>(path: string, options?: ApiRequestOptions) {
      const { response, envelope } = await receiveEnvelope(path, options)
      if (!envelope) return undefined as T
      assertSuccessfulEnvelope(response, envelope)

      return envelope.data as T
    },
    async requestList<T>(path: string, options?: ApiRequestOptions) {
      const { response, envelope } = await receiveEnvelope(path, options)
      if (!envelope) {
        throw new ApiError('后端列表响应格式无效', {
          kind: 'invalid-response',
          status: response.status,
        })
      }
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

/**
 * 兼容现有实体适配器的便捷方法。它们与 createApiClient 共用同一套鉴权、
 * 错误分类和响应信封解析，不再维护第二套 HTTP 实现。
 */
function getDefaultApiClient(): ApiClient {
  return createApiClient({
    baseUrl:
      import.meta.env.VITE_API_BASE_URL ??
      (import.meta.env.DEV ? 'http://127.0.0.1:8000' : undefined),
    getAccessToken: getApiAccessToken,
  })
}

export function request<T>(path: string, init?: RequestInit): Promise<T> {
  return getDefaultApiClient().request<T>(path, init)
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function getPage<T>(path: string): Promise<ApiListResult<T>> {
  return getDefaultApiClient().requestList<T>(path)
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return getDefaultApiClient().request<T>(path, { method: 'POST', json: body })
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return getDefaultApiClient().request<T>(path, { method: 'PATCH', json: body })
}

export async function del(path: string): Promise<void> {
  await getDefaultApiClient().request<null>(path, { method: 'DELETE' })
}

export function upload<T>(path: string, formData: FormData): Promise<T> {
  return getDefaultApiClient().request<T>(path, { method: 'POST', body: formData })
}
