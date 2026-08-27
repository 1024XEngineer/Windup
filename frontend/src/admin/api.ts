export interface AdminUser {
  id: number
  email: string
  permissions: string[]
}

export interface AdminApis {
  login(input: { email: string; password: string }): Promise<AdminUser>
  me(): Promise<AdminUser>
  refresh(): Promise<AdminUser>
  logout(): Promise<void>
}

export class AdminApiError extends Error {
  readonly code: number | null

  constructor(message: string, code: number | null = null, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AdminApiError'
    this.code = code
  }
}

interface AdminEnvelope {
  code: number
  message: string
  data: unknown
}

export interface CreateAdminApisOptions {
  baseUrl?: string
  fetchFn?: typeof fetch
  readCookie?: (name: string) => string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAdmin(value: unknown): AdminUser {
  if (!isRecord(value) || !isRecord(value.admin)) {
    throw new AdminApiError('管理员响应格式无效')
  }
  const admin = value.admin
  if (
    !Number.isInteger(admin.id) ||
    (admin.id as number) <= 0 ||
    typeof admin.email !== 'string' ||
    !Array.isArray(admin.permissions) ||
    !admin.permissions.every((permission) => typeof permission === 'string')
  ) {
    throw new AdminApiError('管理员响应格式无效')
  }
  return {
    id: admin.id as number,
    email: admin.email,
    permissions: [...admin.permissions],
  }
}

function defaultReadCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${encodeURIComponent(name)}=`
  const item = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix))
  return item ? decodeURIComponent(item.slice(prefix.length)) : null
}

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = (value ?? '/admin-api').trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('VITE_ADMIN_API_BASE_URL 未配置')
  return normalized
}

async function readEnvelope(response: Response): Promise<AdminEnvelope> {
  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    throw new AdminApiError('管理服务响应格式无效', response.status, { cause })
  }
  if (
    !isRecord(value) ||
    typeof value.code !== 'number' ||
    typeof value.message !== 'string' ||
    !Object.hasOwn(value, 'data')
  ) {
    throw new AdminApiError('管理服务响应格式无效', response.status)
  }
  return value as unknown as AdminEnvelope
}

export function createAdminApis({
  baseUrl = import.meta.env.VITE_ADMIN_API_BASE_URL,
  fetchFn = globalThis.fetch,
  readCookie = defaultReadCookie,
}: CreateAdminApisOptions = {}): AdminApis {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response
    try {
      response = await fetchFn(`${normalizedBaseUrl}${path}`, {
        ...init,
        credentials: 'include',
      })
    } catch (cause) {
      throw new AdminApiError('无法连接管理服务', null, { cause })
    }
    const envelope = await readEnvelope(response)
    if (!response.ok || envelope.code !== 200) {
      throw new AdminApiError(envelope.message || '管理请求失败', envelope.code)
    }
    return envelope.data
  }

  function csrfHeaders(): Headers {
    const token = readCookie('windup_admin_csrf')
    const headers = new Headers()
    if (token) headers.set('x-csrf-token', token)
    return headers
  }

  return {
    async login(input) {
      const data = await request('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      return parseAdmin(data)
    },
    async me() {
      return parseAdmin(await request('/auth/me'))
    },
    async refresh() {
      return parseAdmin(await request('/auth/refresh', { method: 'POST', headers: csrfHeaders() }))
    },
    async logout() {
      await request('/auth/logout', { method: 'POST', headers: csrfHeaders() })
    },
  }
}

export const adminApis = createAdminApis()
