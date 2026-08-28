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
    has_password: true,
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

  it('uploads an avatar as multipart data and maps the persisted URL', async () => {
    request.mockResolvedValue({
      ...tokenResponse.user,
      avatar_url: 'https://cdn.windup.test/avatar.png',
    })
    const apis = createUserApis({ client })
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })

    const profile = await apis.updateAvatar(file)

    const [path, options] = request.mock.calls[0]
    expect(path).toBe('/auth/profile/avatar')
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get('file')).toBe(file)
    expect(profile.avatarUrl).toBe('https://cdn.windup.test/avatar.png')
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
    await apis.setPassword({ newPassword: 'new-password-123' })
    await apis.changePassword({ oldPassword: 'password-123', newPassword: 'new-password-123' })
    await apis.resetPassword({
      email: 'reader@example.com',
      code: '123456',
      newPassword: 'reset-password-123',
    })
    await apis.sendPasswordChangeCode()
    await apis.changePasswordWithCode({
      code: '123456',
      newPassword: 'new-password-123',
    })

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
        '/auth/set-password',
        {
          method: 'POST',
          json: { new_password: 'new-password-123' },
        },
      ],
      [
        '/auth/change-password',
        {
          method: 'POST',
          json: {
            old_password: 'password-123',
            new_password: 'new-password-123',
          },
        },
      ],
      [
        '/auth/reset-password',
        {
          method: 'POST',
          json: {
            email: 'reader@example.com',
            code: '123456',
            new_password: 'reset-password-123',
          },
        },
      ],
      ['/auth/change-password/send-code', { method: 'POST' }],
      [
        '/auth/change-password/confirm',
        {
          method: 'POST',
          json: {
            code: '123456',
            new_password: 'new-password-123',
          },
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
      avatarUrl: null,
      emailVerifiedAt: '2026-08-07T01:02:03Z',
      statusCode: 37,
      hasPassword: true,
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
        avatarUrl: null,
        emailVerifiedAt: '2026-08-07T01:02:03Z',
        statusCode: 37,
        hasPassword: true,
      },
    })
    await expect(apis.me()).resolves.toEqual({
      id: '7',
      email: 'reader@example.com',
      nickname: null,
      avatarUrl: null,
      emailVerifiedAt: null,
      statusCode: 37,
      hasPassword: false,
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

  it('omits the optional invite code from public registration', async () => {
    request.mockResolvedValue(tokenResponse)
    const apis = createUserApis({ client })

    await apis.register({
      email: 'reader@example.com',
      password: 'password-123',
      code: '123456',
    })

    expect(request).toHaveBeenCalledWith('/auth/register', {
      method: 'POST',
      json: {
        email: 'reader@example.com',
        password: 'password-123',
        code: '123456',
      },
    })
    const options = request.mock.calls[0]?.[1] as { json?: object } | undefined
    expect(Object.hasOwn(options?.json ?? {}, 'invite_code')).toBe(false)
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

  it('recovers and replays protected GET requests', async () => {
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
        new Response(JSON.stringify({ code: 200, message: 'ok', data: tokenResponse.user }), {
          status: 200,
        }),
      )
    const apis = createUserApis({ baseUrl: 'https://api.windup.test', fetchFn })

    try {
      await expect(apis.me()).resolves.toMatchObject({ id: '7', email: 'reader@example.com' })
      expect(recover).toHaveBeenCalledTimes(1)
      expect(fetchFn).toHaveBeenCalledTimes(2)
    } finally {
      unregister()
    }
  })

  it.each([
    [
      'nickname-update',
      (apis: ReturnType<typeof createUserApis>) => apis.updateNickname('New Reader'),
    ],
    [
      'password-reset',
      (apis: ReturnType<typeof createUserApis>) =>
        apis.changePasswordWithCode({
          code: '123456',
          newPassword: 'new-password-123',
        }),
    ],
  ])('recovers the session but does not replay protected %s requests', async (_label, invoke) => {
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
        new Response(JSON.stringify({ code: 200, message: 'ok', data: null }), { status: 200 }),
      )
    const apis = createUserApis({ baseUrl: 'https://api.windup.test', fetchFn })

    try {
      await expect(invoke(apis)).rejects.toMatchObject({ kind: 'business', code: 401 })
      // token 已刷新，手动重试可以成功；但写请求本身不自动重放。
      expect(recover).toHaveBeenCalledTimes(1)
      expect(fetchFn).toHaveBeenCalledTimes(1)
    } finally {
      unregister()
    }
  })
})
