import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerApiUnauthorizedRecovery, type ApiClient } from '@/shared/api'

import { createUserApis } from './api'

const tokenResponse = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  token_type: 'bearer',
  expires_in: 900,
  user: {
    id: 7,
    email: 'reader@example.com',
    nickname: 'Reader',
    email_verified_at: '2026-08-07T01:02:03Z',
    status: 37,
    last_login_at: '2026-08-07T01:02:03Z',
    create_at: '2026-08-01T01:02:03Z',
    update_at: '2026-08-07T01:02:03Z',
  },
}

describe('createUserApis', () => {
  let request: ReturnType<typeof vi.fn>
  let client: ApiClient

  beforeEach(() => {
    request = vi.fn()
    client = {
      request: request as unknown as ApiClient['request'],
      requestList: vi.fn() as unknown as ApiClient['requestList'],
    }
  })

  it('maps every authentication command to its exact backend path and request body', async () => {
    request
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tokenResponse.user)
      .mockResolvedValueOnce(null)

    const apis = createUserApis({ client })

    await apis.sendCode({ email: 'reader@example.com', purpose: 'reset_password' })
    await apis.register({
      email: 'reader@example.com',
      password: 'password-123',
      code: '123456',
      nickname: 'Reader',
      inviteCode: 'AB23CD45',
    })
    await apis.login({
      email: 'reader@example.com',
      password: 'password-123',
    })
    await apis.loginByCode({ email: 'reader@example.com', code: '123456' })
    await apis.refresh('refresh-token')
    await apis.logout('refresh-token')
    await apis.updateNickname('New Reader')
    await apis.changePassword({ oldPassword: 'password-123', newPassword: 'new-password-123' })

    expect(request.mock.calls).toEqual([
      [
        '/auth/send-code',
        {
          method: 'POST',
          json: { email: 'reader@example.com', purpose: 'reset_password' },
        },
      ],
      [
        '/auth/register',
        {
          method: 'POST',
          json: {
            email: 'reader@example.com',
            password: 'password-123',
            code: '123456',
            invite_code: 'AB23CD45',
            nickname: 'Reader',
          },
        },
      ],
      [
        '/auth/login',
        {
          method: 'POST',
          json: {
            email: 'reader@example.com',
            password: 'password-123',
          },
        },
      ],
      [
        '/auth/login-by-code',
        {
          method: 'POST',
          json: { email: 'reader@example.com', code: '123456' },
        },
      ],
      ['/auth/refresh', { method: 'POST', json: { refresh_token: 'refresh-token' } }],
      ['/auth/logout', { method: 'POST', json: { refresh_token: 'refresh-token' } }],
      ['/auth/profile', { method: 'PATCH', json: { nickname: 'New Reader' } }],
      [
        '/auth/change-password',
        {
          method: 'POST',
          json: { old_password: 'password-123', new_password: 'new-password-123' },
        },
      ],
    ])
  })

  it('maps the updated profile response back to the user model', async () => {
    request.mockResolvedValue({
      ...tokenResponse.user,
      nickname: 'New Reader',
    })
    const apis = createUserApis({ client })

    await expect(apis.updateNickname('New Reader')).resolves.toEqual({
      id: '7',
      email: 'reader@example.com',
      nickname: 'New Reader',
      emailVerifiedAt: '2026-08-07T01:02:03Z',
      statusCode: 37,
    })
  })

  it('maps token and current-user payloads while preserving an unknown numeric status', async () => {
    request.mockResolvedValueOnce(tokenResponse).mockResolvedValueOnce({
      id: 7,
      email: 'reader@example.com',
      nickname: null,
      email_verified_at: null,
      status: 37,
    })

    const apis = createUserApis({ client })

    await expect(
      apis.loginByCode({ email: 'reader@example.com', code: '123456' }),
    ).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: '7',
        email: 'reader@example.com',
        nickname: 'Reader',
        emailVerifiedAt: '2026-08-07T01:02:03Z',
        statusCode: 37,
      },
    })
    await expect(apis.me()).resolves.toEqual({
      id: '7',
      email: 'reader@example.com',
      nickname: null,
      emailVerifiedAt: null,
      statusCode: 37,
    })
    expect(request).toHaveBeenLastCalledWith('/auth/me')
  })

  it.each([
    ['missing id', { ...tokenResponse, user: { ...tokenResponse.user, id: null } }],
    ['missing email', { ...tokenResponse, user: { ...tokenResponse.user, email: null } }],
  ])('rejects a successful token response with %s', async (_label, response) => {
    request.mockResolvedValue(response)
    const apis = createUserApis({ client })

    await expect(apis.refresh('refresh-token')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it('omits an empty optional nickname', async () => {
    request.mockResolvedValue(tokenResponse)
    const apis = createUserApis({ client })

    await apis.register({
      email: 'reader@example.com',
      password: 'password-123',
      code: '123456',
      nickname: '',
      inviteCode: 'AB23CD45',
    })

    expect(request).toHaveBeenCalledWith('/auth/register', {
      method: 'POST',
      json: {
        email: 'reader@example.com',
        password: 'password-123',
        code: '123456',
        invite_code: 'AB23CD45',
      },
    })
  })

  it('disables global unauthorized recovery for authentication requests', async () => {
    const recover = vi.fn(async () => true)
    const unregister = registerApiUnauthorizedRecovery(recover)
    const apis = createUserApis({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(JSON.stringify({ code: 401, message: 'refresh rejected', data: null }), {
          status: 200,
        }),
    })

    await expect(apis.refresh('expired-refresh-token')).rejects.toMatchObject({ code: 401 })
    expect(recover).not.toHaveBeenCalled()
    unregister()
  })

  it.each([
    ['current-user', (apis: ReturnType<typeof createUserApis>) => apis.me(), tokenResponse.user],
    [
      'nickname-update',
      (apis: ReturnType<typeof createUserApis>) => apis.updateNickname('New Reader'),
      tokenResponse.user,
    ],
    [
      'password-change',
      (apis: ReturnType<typeof createUserApis>) =>
        apis.changePassword({
          oldPassword: 'password-123',
          newPassword: 'new-password-123',
        }),
      null,
    ],
  ])('recovers and replays protected %s requests', async (_label, invoke, data) => {
    const recover = vi.fn(async () => true)
    const unregister = registerApiUnauthorizedRecovery(recover)
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 401, message: 'access token expired', data: null }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, message: 'ok', data }), { status: 200 }),
      )
    const apis = createUserApis({ baseUrl: 'https://api.windup.test', fetchFn })

    try {
      await invoke(apis)
      expect(recover).toHaveBeenCalledTimes(1)
      expect(fetchFn).toHaveBeenCalledTimes(2)
    } finally {
      unregister()
    }
  })
})
