import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  createApiClient,
  getApiAccessToken,
  registerApiAccessTokenProvider,
} from './index'

afterEach(() => vi.unstubAllEnvs())

describe('createApiClient', () => {
  it('reads the latest registered token provider and restores the previous provider', () => {
    const unregisterFirst = registerApiAccessTokenProvider(() => 'first-token')
    const unregisterSecond = registerApiAccessTokenProvider(() => 'second-token')

    expect(getApiAccessToken()).toBe('second-token')
    unregisterSecond()
    expect(getApiAccessToken()).toBe('first-token')
    unregisterFirst()
    expect(getApiAccessToken()).toBeUndefined()
  })

  it('returns data from a successful backend response envelope', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: { id: 7 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    })

    await expect(client.request<{ id: number }>('/resources/7')).resolves.toEqual({ id: 7 })
  })

  it('rejects a backend business error even when HTTP status is 200', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            code: 400,
            message: '请求参数错误',
            data: { field: 'name' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })

    const error = await client.request('/resources').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'business',
      code: 400,
      status: 200,
      message: '请求参数错误',
      data: { field: 'name' },
    })
  })

  it('maps a successful list response to a camel-case list result', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: [{ id: 7 }, { id: 8 }],
            total: 42,
            page: 2,
            page_size: 20,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    })

    await expect(client.requestList<{ id: number }>('/resources')).resolves.toEqual({
      items: [{ id: 7 }, { id: 8 }],
      total: 42,
      page: 2,
      pageSize: 20,
    })
  })

  it('serializes query values and a JSON request body', async () => {
    let capturedRequest: Request | undefined
    const client = createApiClient({
      baseUrl: 'https://api.windup.test/',
      fetchFn: async (input, init) => {
        capturedRequest = new Request(input, init)
        return new Response(JSON.stringify({ code: 200, message: 'success', data: null }))
      },
    })

    await client.request('/resources', {
      method: 'POST',
      query: { page: 2, page_size: 20, user_id: null },
      json: { name: 'sample' },
    })

    if (!capturedRequest) throw new Error('request was not sent')
    expect(capturedRequest.url).toBe('https://api.windup.test/resources?page=2&page_size=20')
    expect(capturedRequest.headers.get('content-type')).toBe('application/json')
    await expect(capturedRequest.json()).resolves.toEqual({ name: 'sample' })
  })

  it('adds the current access token as a Bearer authorization header', async () => {
    let authorization: string | null = null
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      getAccessToken: () => 'access-token',
      fetchFn: async (input, init) => {
        authorization = new Request(input, init).headers.get('authorization')
        return new Response(JSON.stringify({ code: 200, message: 'success', data: null }))
      },
    })

    await client.request('/auth/me')

    expect(authorization).toBe('Bearer access-token')
  })

  it('wraps a rejected fetch as a network ApiError', async () => {
    const connectionError = new TypeError('Failed to fetch')
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () => Promise.reject(connectionError),
    })

    const error = await client.request('/resources').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'network',
      code: null,
      status: null,
      message: '网络请求失败',
      cause: connectionError,
    })
  })

  it('rejects a successful HTTP response that does not match the backend envelope', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(JSON.stringify({ data: { id: 7 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })

    const error = await client.request('/resources/7').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'invalid-response',
      code: null,
      status: 200,
      message: '后端响应格式无效',
    })
  })

  it('rejects a list response with invalid pagination fields', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: [{ id: 7 }],
            total: 1,
            page: 1,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })

    const error = await client.requestList('/resources').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'invalid-response',
      status: 200,
      message: '后端列表响应格式无效',
    })
  })

  it('reports a non-envelope HTTP failure as an HTTP ApiError', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () => new Response('gateway unavailable', { status: 503 }),
    })

    const error = await client.request('/resources').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'http',
      code: null,
      status: 503,
    })
  })

  it('prioritizes an HTTP failure when the response also has a non-200 business code', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            code: 500,
            message: '服务暂时不可用',
            data: { request_id: 'request-7' },
          }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
    })

    const error = await client.request('/resources').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'http',
      code: null,
      status: 503,
      message: 'HTTP 请求失败',
      data: { request_id: 'request-7' },
    })
  })

  it('does not accept a success envelope carried by a failed HTTP response', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(JSON.stringify({ code: 200, message: 'success', data: { id: 7 } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    })

    const error = await client.request('/resources/7').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'http', code: null, status: 500 })
  })

  it('uses VITE_API_BASE_URL when an explicit base URL is not provided', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test/root/')
    let requestUrl = ''
    const client = createApiClient({
      fetchFn: async (input) => {
        requestUrl = String(input)
        return new Response(JSON.stringify({ code: 200, message: 'success', data: null }))
      },
    })

    await client.request('/resources')

    expect(requestUrl).toBe('https://api.windup.test/root/resources')
  })
})
