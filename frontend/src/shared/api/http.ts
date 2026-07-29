function apiUrl(path: string): string {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
  if (configuredBaseUrl.length === 0) return path

  let baseUrl: URL
  try {
    baseUrl = new URL(configuredBaseUrl)
  } catch {
    throw new Error('VITE_API_BASE_URL 配置无效：必须是安全的 HTTP(S) 绝对地址')
  }

  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.href.includes('?') ||
    baseUrl.href.includes('#')
  ) {
    throw new Error('VITE_API_BASE_URL 配置无效：必须是安全的 HTTP(S) 绝对地址')
  }

  return `${baseUrl.href.replace(/\/+$/, '')}${path}`
}

export class HttpRequestError extends Error {
  readonly status: number
  readonly responseBody: unknown

  constructor(status: number, responseBody: unknown) {
    super(`HTTP ${status}`)
    this.name = 'HttpRequestError'
    this.status = status
    this.responseBody = responseBody
  }
}

function parseResponseBody(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export async function postMultipart(path: string, body: FormData): Promise<unknown> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    body,
    redirect: 'error',
  })
  const responseBody = parseResponseBody(await response.text())

  if (!response.ok) throw new HttpRequestError(response.status, responseBody)
  return responseBody
}
