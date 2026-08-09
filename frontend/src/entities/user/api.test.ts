import { describe, expect, it, vi } from 'vitest'

import { registerApiAccessTokenProvider, registerApiUnauthorizedRecovery } from '@/shared/api'
import { createUserApis } from './api'

describe('user API adapter', () => {
  it('uses the authenticated backend contract and maps user responses to the entity shape', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname
      if (path === '/auth/me') return jsonResponse(backendUser)
      if (
        ['/auth/register', '/auth/login', '/auth/login-by-code', '/auth/refresh'].includes(path)
      ) {
        return jsonResponse({ access_token: 'access', refresh_token: 'refresh', user: backendUser })
      }
      return jsonResponse(null)
    })
    const apis = createUserApis({ baseUrl: 'https://api.example.test', fetchFn: fetchMock })

    await apis.sendCode({ email: 'a@b.com', purpose: 'login' })
    await apis.register({
      email: 'a@b.com',
      password: 'password1',
      code: '123456',
      nickname: 'Ada',
    })
    await apis.login({ email: 'a@b.com', password: 'password1', code: '123456' })
    await apis.loginByCode({ email: 'a@b.com', code: '123456' })
    await apis.refresh('refresh')
    await apis.logout('refresh')
    expect(await apis.me()).toEqual({
      id: 7,
      email: 'a@b.com',
      nickname: null,
      emailVerifiedAt: null,
      status: 'normal',
    })
    await apis.changePassword({ oldPassword: 'password1', newPassword: 'password2' })

    expect(await apis.login({ email: 'a@b.com', password: 'password1', code: '123456' })).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: { id: 7, email: 'a@b.com', nickname: null, emailVerifiedAt: null, status: 'normal' },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/auth/send-code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', purpose: 'login' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'a@b.com',
          password: 'password1',
          code: '123456',
          nickname: 'Ada',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.example.test/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'password1', code: '123456' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://api.example.test/auth/login-by-code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', code: '123456' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://api.example.test/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refresh_token: 'refresh' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://api.example.test/auth/logout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refresh_token: 'refresh' }),
      }),
    )
    expect(fetchMock.mock.calls[6]?.[0]).toBe('https://api.example.test/auth/me')
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      'https://api.example.test/auth/change-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ old_password: 'password1', new_password: 'password2' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      9,
      'https://api.example.test/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'password1', code: '123456' }),
      }),
    )
  })

  it('maps a banned backend user status to the entity status', async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> => jsonResponse({ ...backendUser, status: 1 }),
    )
    const apis = createUserApis({ baseUrl: 'https://api.example.test', fetchFn: fetchMock })

    await expect(apis.me()).resolves.toMatchObject({ id: 7, status: 'banned' })
  })

  it('uses the registered session access token for authenticated requests by default', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session-access')
      return jsonResponse(backendUser)
    })
    const unregister = registerApiAccessTokenProvider(() => 'session-access')

    try {
      const apis = createUserApis({ baseUrl: 'https://api.example.test', fetchFn: fetchMock })

      await expect(apis.me()).resolves.toMatchObject({ id: 7 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      unregister()
    }
  })

  it('preserves an explicit access-token provider override', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer explicit-access')
      return jsonResponse(backendUser)
    })
    const unregister = registerApiAccessTokenProvider(() => 'session-access')

    try {
      const apis = createUserApis({
        baseUrl: 'https://api.example.test',
        fetchFn: fetchMock,
        getAccessToken: () => 'explicit-access',
      })

      await expect(apis.me()).resolves.toMatchObject({ id: 7 })
    } finally {
      unregister()
    }
  })

  it('rejects malformed user and token DTOs instead of treating them as valid authentication data', async () => {
    const invalidUser = { ...backendUser, status: 2 }
    const invalidTokens = { refresh_token: 'refresh', user: backendUser }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(invalidUser))
      .mockResolvedValueOnce(jsonResponse(invalidTokens))
    const apis = createUserApis({ baseUrl: 'https://api.example.test', fetchFn: fetchMock })

    await expect(apis.me()).rejects.toMatchObject({ kind: 'invalid-response', data: invalidUser })
    await expect(
      apis.login({ email: 'a@b.com', password: 'password1', code: '123456' }),
    ).rejects.toMatchObject({
      kind: 'invalid-response',
      data: invalidTokens,
    })
  })

  it('does not recursively invoke session recovery when an auth endpoint returns 401', async () => {
    const recover = vi.fn(async () => true)
    const unregister = registerApiUnauthorizedRecovery(recover)
    const apis = createUserApis({
      baseUrl: 'https://api.example.test',
      fetchFn: async () =>
        new Response(JSON.stringify({ code: 401, message: 'refresh expired', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    try {
      await expect(apis.refresh('expired-refresh')).rejects.toMatchObject({
        kind: 'business',
        code: 401,
      })
    } finally {
      unregister()
    }
    expect(recover).not.toHaveBeenCalled()
  })
})

const backendUser = {
  id: 7,
  email: 'a@b.com',
  nickname: null,
  email_verified_at: null,
  status: 0,
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
