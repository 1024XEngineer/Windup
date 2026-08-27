import { describe, expect, it, vi } from 'vitest'

import { AdminApiError, createAdminApis } from './api'

const adminData = {
  admin: {
    id: 7,
    email: 'owner@windup.xin',
    permissions: ['audit.read', 'gateway.read'],
  },
}

function success(data: unknown) {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('admin cookie API', () => {
  it('logs in through the dedicated admin endpoint without exposing token storage', async () => {
    const fetchFn = vi.fn(async () => success(adminData))
    const apis = createAdminApis({ baseUrl: '/admin-api', fetchFn })

    await expect(
      apis.login({ email: 'owner@windup.xin', password: 'strong-password-2026' }),
    ).resolves.toEqual(adminData.admin)

    expect(fetchFn).toHaveBeenCalledWith(
      '/admin-api/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          email: 'owner@windup.xin',
          password: 'strong-password-2026',
        }),
      }),
    )
  })

  it('sends the readable csrf cookie on refresh and logout', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(success(adminData))
      .mockResolvedValueOnce(success(null))
    const apis = createAdminApis({
      baseUrl: '/admin-api',
      fetchFn,
      readCookie: (name) => (name === 'windup_admin_csrf' ? 'csrf-value' : null),
    })

    await apis.refresh()
    await apis.logout()

    for (const call of fetchFn.mock.calls) {
      const headers = new Headers(call[1]?.headers)
      expect(call[1]?.credentials).toBe('include')
      expect(headers.get('x-csrf-token')).toBe('csrf-value')
    }
  })

  it('rejects malformed admin payloads instead of fabricating a session', async () => {
    const apis = createAdminApis({
      baseUrl: '/admin-api',
      fetchFn: async () => success({ admin: { id: null, email: null } }),
    })

    await expect(apis.me()).rejects.toBeInstanceOf(AdminApiError)
  })

  it('preserves backend business error codes for session recovery decisions', async () => {
    const apis = createAdminApis({
      baseUrl: '/admin-api',
      fetchFn: async () =>
        new Response(JSON.stringify({ code: 401, message: '管理员未登录', data: null }), {
          status: 200,
        }),
    })

    await expect(apis.me()).rejects.toMatchObject({ code: 401, message: '管理员未登录' })
  })
})
