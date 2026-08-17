// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthTokens, UserApis } from '@/entities/user'
import { createApiClient, getApiAccessToken, registerApiUnauthorizedRecovery } from '@/shared/api'
import { AuthSessionProvider, type AuthSessionValue, useAuthSession } from './index'
import { REFRESH_TOKEN_STORAGE_KEY, clearRefreshToken } from './session-storage'

const user = {
  id: '7',
  email: 'reader@example.com',
  nickname: 'Reader',
  emailVerifiedAt: '2026-08-07T01:02:03Z',
  statusCode: 37,
}

function jwt(exp: number): string {
  const payload = btoa(JSON.stringify({ exp }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  return `header.${payload}.signature`
}

function tokens(refreshToken = 'refresh-token', accessToken = 'access-token'): AuthTokens {
  return { accessToken, refreshToken, user }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createApis(): UserApis & Record<keyof UserApis, ReturnType<typeof vi.fn>> {
  return {
    sendCode: vi.fn(async () => undefined),
    register: vi.fn(async () => tokens()),
    login: vi.fn(async () => tokens()),
    loginByCode: vi.fn(async () => tokens()),
    refresh: vi.fn(async () => tokens()),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => user),
    updateNickname: vi.fn(async () => user),
    changePassword: vi.fn(async () => undefined),
  }
}

let currentSession: AuthSessionValue | null = null

function SessionProbe() {
  currentSession = useAuthSession()
  return (
    <>
      <output data-testid="session">
        {currentSession.state.status}:
        {currentSession.state.status === 'guest' ? currentSession.state.reason : ''}:
        {currentSession.state.status === 'authenticated' ? currentSession.state.user.email : ''}
      </output>
      <span data-testid="session-nickname">
        {currentSession.state.status === 'authenticated' ? currentSession.state.user.nickname : ''}
      </span>
    </>
  )
}

function renderSession(apis: UserApis, wrapper?: (children: ReactNode) => ReactNode) {
  const content = (
    <AuthSessionProvider apis={apis}>
      <SessionProbe />
    </AuthSessionProvider>
  )
  return render(wrapper ? wrapper(content) : content)
}

function session(): AuthSessionValue {
  if (!currentSession) throw new Error('session is not mounted')
  return currentSession
}

async function expectState(value: string) {
  await waitFor(() =>
    expect(document.querySelector('[data-testid="session"]')?.textContent).toBe(value),
  )
}

afterEach(() => {
  cleanup()
  clearRefreshToken()
  currentSession = null
  vi.useRealTimers()
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('AuthSessionProvider', () => {
  it('boots directly to a reasonless guest when there is no refresh token', async () => {
    const apis = createApis()

    renderSession(apis)

    await expectState('guest::')
    expect(apis.refresh).not.toHaveBeenCalled()
  })

  it('deduplicates StrictMode bootstrap and restores tokens from persisted refresh state', async () => {
    const bootstrap = deferred<AuthTokens>()
    const apis = createApis()
    apis.refresh.mockReturnValue(bootstrap.promise)
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'stored-refresh-token')

    const view = renderSession(apis, (children) => <StrictMode>{children}</StrictMode>)

    await waitFor(() => expect(apis.refresh).toHaveBeenCalledTimes(1))
    expect(apis.refresh).toHaveBeenCalledWith('stored-refresh-token')
    await act(async () => bootstrap.resolve(tokens('rotated-refresh-token', 'restored-access')))

    await expectState('authenticated::reader@example.com')
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('rotated-refresh-token')
    expect(getApiAccessToken()).toBe('restored-access')

    view.unmount()
    expect(getApiAccessToken()).toBeUndefined()
  })

  it.each(['register', 'login', 'loginByCode'] as const)(
    '%s applies the complete returned session',
    async (method) => {
      const apis = createApis()
      apis[method].mockResolvedValue(tokens(`${method}-refresh`, `${method}-access`))
      renderSession(apis)
      await expectState('guest::')

      await act(async () => {
        if (method === 'register') {
          await session().register({
            email: 'reader@example.com',
            password: 'password-123',
            code: '123456',
            inviteCode: 'AB23CD45',
          })
        } else if (method === 'login') {
          await session().login({
            email: 'reader@example.com',
            password: 'password-123',
          })
        } else {
          await session().loginByCode({ email: 'reader@example.com', code: '123456' })
        }
      })

      await expectState('authenticated::reader@example.com')
      expect(getApiAccessToken()).toBe(`${method}-access`)
      expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe(`${method}-refresh`)
    },
  )

  it('clears local state before best-effort logout finishes and never restores it on failure', async () => {
    const logout = deferred<void>()
    const apis = createApis()
    apis.logout.mockReturnValue(logout.promise)
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))

    let logoutPromise!: Promise<void>
    act(() => {
      logoutPromise = session().logout()
    })
    await expectState('guest:logged-out:')
    expect(getApiAccessToken()).toBeNull()
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull()
    expect(apis.logout).toHaveBeenCalledWith('refresh-token')

    const rejectedLogout = expect(logoutPromise).rejects.toThrow('network unavailable')
    await act(async () => logout.reject(new Error('network unavailable')))
    await rejectedLogout
    await expectState('guest:logged-out:')
  })

  it('clears the session with a password-changed reason after changing the password', async () => {
    const apis = createApis()
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))

    await act(async () =>
      session().changePassword({ oldPassword: 'password-123', newPassword: 'new-password-123' }),
    )

    await expectState('guest:password-changed:')
    expect(getApiAccessToken()).toBeNull()
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('refreshes the current user from the backend and synchronizes session consumers', async () => {
    const apis = createApis()
    apis.me.mockResolvedValue({ ...user, nickname: 'Fresh Reader' })
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))

    await act(async () => session().refreshCurrentUser())

    expect(apis.me).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-testid="session-nickname"]')?.textContent).toBe(
      'Fresh Reader',
    )
  })

  it('updates the nickname and synchronizes the returned user into the session', async () => {
    const apis = createApis()
    apis.updateNickname.mockResolvedValue({ ...user, nickname: 'New Reader' })
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))

    await act(async () => session().updateNickname('New Reader'))

    expect(apis.updateNickname).toHaveBeenCalledWith('New Reader')
    expect(document.querySelector('[data-testid="session-nickname"]')?.textContent).toBe(
      'New Reader',
    )
  })

  it('does not restore profile state when a pending profile request loses to logout', async () => {
    const profile = deferred<typeof user>()
    const apis = createApis()
    apis.me.mockReturnValue(profile.promise)
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))

    let refreshPromise!: ReturnType<UserApis['me']>
    act(() => {
      refreshPromise = session().refreshCurrentUser()
    })
    const rejectedRefresh = expect(refreshPromise).rejects.toThrow('登录状态已变更')
    await act(async () => session().logout())
    await act(async () => profile.resolve({ ...user, nickname: 'Stale Reader' }))

    await rejectedRefresh
    await expectState('guest:logged-out:')
  })

  it('deduplicates concurrent 401 recovery and lets both requests replay with the rotated token', async () => {
    const refresh = deferred<AuthTokens>()
    const apis = createApis()
    apis.refresh.mockReturnValue(refresh.promise)
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))

    const authorizations: (string | null)[] = []
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      getAccessToken: getApiAccessToken,
      fetchFn: async (input, init) => {
        const authorization = new Request(input, init).headers.get('authorization')
        authorizations.push(authorization)
        const payload =
          authorization === 'Bearer renewed-access'
            ? { code: 200, message: 'success', data: { ok: true } }
            : { code: 401, message: '登录状态已过期', data: null }
        return new Response(JSON.stringify(payload), { status: 200 })
      },
    })

    const first = client.request('/first')
    const second = client.request('/second')
    await waitFor(() => expect(apis.refresh).toHaveBeenCalledTimes(1))
    await act(async () => refresh.resolve(tokens('renewed-refresh', 'renewed-access')))

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(authorizations).toEqual([
      'Bearer access-token',
      'Bearer access-token',
      'Bearer renewed-access',
      'Bearer renewed-access',
    ])
    await expectState('authenticated::reader@example.com')
  })

  it('marks the session expired when reactive recovery cannot refresh', async () => {
    const apis = createApis()
    apis.refresh.mockRejectedValue(new Error('refresh rejected'))
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(JSON.stringify({ code: 401, message: 'expired', data: null }), {
          status: 200,
        }),
    })

    await expect(client.request('/resources')).rejects.toMatchObject({ code: 401 })

    await expectState('guest:session-expired:')
  })

  it('keeps the session it just obtained when the newer cross-tab token is rejected', async () => {
    const rotation = deferred<AuthTokens>()
    const apis = createApis()
    apis.loginByCode.mockResolvedValue(tokens('original-refresh', 'original-access'))
    apis.refresh.mockImplementation(async (refreshToken: string) => {
      if (refreshToken === 'original-refresh') return rotation.promise
      throw new Error(`refresh rejected for ${refreshToken}`)
    })
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))

    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      getAccessToken: getApiAccessToken,
      fetchFn: async (input, init) => {
        const authorization = new Request(input, init).headers.get('authorization')
        const payload =
          authorization === 'Bearer rotated-access'
            ? { code: 200, message: 'success', data: { ok: true } }
            : { code: 401, message: '登录状态已过期', data: null }
        return new Response(JSON.stringify(payload), { status: 200 })
      },
    })
    const replayed = client.request('/resources')
    await waitFor(() => expect(apis.refresh).toHaveBeenCalledWith('original-refresh'))

    // 另一个标签页在本次续期途中写入了新的 refresh token，本页已登录，只吸收不重走认证。
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: REFRESH_TOKEN_STORAGE_KEY,
          newValue: 'revoked-refresh',
          oldValue: 'original-refresh',
        }),
      )
    })
    await act(async () => rotation.resolve(tokens('rotated-refresh', 'rotated-access')))

    await expect(replayed).resolves.toEqual({ ok: true })
    // 更新的 token 只试一次，且失败不该牵连本次已经换到手的这套。
    expect(apis.refresh.mock.calls.flat()).toEqual(['original-refresh', 'revoked-refresh'])
    await expectState('authenticated::reader@example.com')
    expect(getApiAccessToken()).toBe('rotated-access')
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('rotated-refresh')
  })

  it('refreshes a JWT sixty seconds before expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000_000_000)
    const exp = Date.now() / 1_000 + 120
    const apis = createApis()
    apis.refresh
      .mockResolvedValueOnce(tokens('boot-rotated', jwt(exp)))
      .mockResolvedValueOnce(tokens('scheduled-rotated', jwt(exp + 900)))
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'stored-refresh')

    renderSession(apis)
    await act(async () => Promise.resolve())
    expect(apis.refresh).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTimeAsync(60_000))

    expect(apis.refresh).toHaveBeenCalledTimes(2)
    expect(apis.refresh).toHaveBeenLastCalledWith('boot-rotated')
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('scheduled-rotated')
  })

  it('adopts cross-tab rotation without refreshing an already authenticated tab', async () => {
    const apis = createApis()
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))

    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'other-tab-refresh')
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: REFRESH_TOKEN_STORAGE_KEY,
          oldValue: 'refresh-token',
          newValue: 'other-tab-refresh',
          storageArea: window.localStorage,
        }),
      ),
    )

    expect(apis.refresh).not.toHaveBeenCalled()
    await act(async () => session().logout())
    expect(apis.logout).toHaveBeenCalledWith('other-tab-refresh')
  })

  it('refreshes a cross-tab login for a guest and clears on cross-tab logout without rewriting storage', async () => {
    const apis = createApis()
    apis.refresh.mockResolvedValue(tokens('rotated-by-this-tab', 'cross-tab-access'))
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    renderSession(apis)
    await expectState('guest::')

    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'other-tab-login')
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: REFRESH_TOKEN_STORAGE_KEY,
          newValue: 'other-tab-login',
          storageArea: window.localStorage,
        }),
      ),
    )
    await expectState('authenticated::reader@example.com')
    expect(apis.refresh).toHaveBeenCalledWith('other-tab-login')

    removeItem.mockClear()
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: REFRESH_TOKEN_STORAGE_KEY,
          oldValue: 'rotated-by-this-tab',
          newValue: null,
          storageArea: window.localStorage,
        }),
      ),
    )

    await expectState('guest::')
    expect(removeItem).not.toHaveBeenCalled()
    removeItem.mockRestore()
  })

  it('adopts a newer cross-tab token when an old-token bootstrap loses the rotation race', async () => {
    const oldRefresh = deferred<AuthTokens>()
    const apis = createApis()
    apis.refresh.mockImplementation((refreshToken: string) => {
      if (refreshToken === 'old-refresh') return oldRefresh.promise
      return Promise.resolve(tokens('winner-rotated', 'winner-access'))
    })
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'old-refresh')
    renderSession(apis)
    await waitFor(() => expect(apis.refresh).toHaveBeenCalledWith('old-refresh'))

    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'winner-refresh')
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: REFRESH_TOKEN_STORAGE_KEY,
          oldValue: 'old-refresh',
          newValue: 'winner-refresh',
          storageArea: window.localStorage,
        }),
      ),
    )
    await act(async () => oldRefresh.reject(new Error('old token revoked')))

    await expectState('authenticated::reader@example.com')
    expect(apis.refresh).toHaveBeenCalledWith('winner-refresh')
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('winner-rotated')
    expect(getApiAccessToken()).toBe('winner-access')
  })

  it('does not rotate a new local login token when an older recovery finishes late', async () => {
    const oldRefresh = deferred<AuthTokens>()
    const apis = createApis()
    apis.loginByCode
      .mockResolvedValueOnce(tokens('old-refresh', 'old-access'))
      .mockResolvedValueOnce(tokens('new-login-refresh', 'new-login-access'))
    apis.refresh.mockImplementation((refreshToken: string) => {
      if (refreshToken === 'old-refresh') return oldRefresh.promise
      return Promise.resolve(tokens('unexpected-rotation', 'unexpected-access'))
    })
    renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(JSON.stringify({ code: 401, message: 'expired', data: null }), {
          status: 200,
        }),
    })

    const request = client.request('/resources')
    const rejectedRequest = expect(request).rejects.toMatchObject({ code: 401 })
    await waitFor(() => expect(apis.refresh).toHaveBeenCalledWith('old-refresh'))
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))
    await act(async () => oldRefresh.resolve(tokens('old-rotated', 'old-rotated-access')))

    await rejectedRequest
    expect(apis.refresh.mock.calls).toEqual([['old-refresh']])
    expect(getApiAccessToken()).toBe('new-login-access')
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('new-login-refresh')
  })

  it('deduplicates the same token across an overlapping A-B-A refresh sequence', async () => {
    const refreshA = deferred<AuthTokens>()
    const refreshB = deferred<AuthTokens>()
    const apis = createApis()
    apis.refresh.mockImplementation((refreshToken: string) =>
      refreshToken === 'refresh-a' ? refreshA.promise : refreshB.promise,
    )
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-a')
    renderSession(apis)
    await waitFor(() => expect(apis.refresh).toHaveBeenCalledWith('refresh-a'))

    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-b')
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: REFRESH_TOKEN_STORAGE_KEY,
          oldValue: 'refresh-a',
          newValue: 'refresh-b',
          storageArea: window.localStorage,
        }),
      ),
    )
    await waitFor(() => expect(apis.refresh).toHaveBeenCalledWith('refresh-b'))

    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-a')
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: REFRESH_TOKEN_STORAGE_KEY,
          oldValue: 'refresh-b',
          newValue: 'refresh-a',
          storageArea: window.localStorage,
        }),
      ),
    )

    expect(apis.refresh.mock.calls.filter(([value]) => value === 'refresh-a')).toHaveLength(1)
    await act(async () => refreshA.resolve(tokens('refresh-a-rotated', 'access-a')))
    await act(async () => refreshB.resolve(tokens('refresh-b-rotated', 'access-b')))
    await expectState('authenticated::reader@example.com')
    expect(getApiAccessToken()).toBe('access-a')
  })

  it('does not write tokens when a pending unauthorized recovery finishes after unmount', async () => {
    const refresh = deferred<AuthTokens>()
    const apis = createApis()
    apis.refresh.mockReturnValue(refresh.promise)
    const view = renderSession(apis)
    await expectState('guest::')
    await act(async () => session().loginByCode({ email: 'reader@example.com', code: '123456' }))
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(JSON.stringify({ code: 401, message: 'expired', data: null }), {
          status: 200,
        }),
    })

    const request = client.request('/resources')
    const rejectedRequest = expect(request).rejects.toMatchObject({ code: 401 })
    await waitFor(() => expect(apis.refresh).toHaveBeenCalledWith('refresh-token'))
    view.unmount()
    await act(async () => refresh.resolve(tokens('late-rotated', 'late-access')))

    await rejectedRequest
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-token')
  })

  it('does not write tokens when a pending storage refresh finishes after unmount', async () => {
    const refresh = deferred<AuthTokens>()
    const apis = createApis()
    apis.refresh.mockReturnValue(refresh.promise)
    const view = renderSession(apis)
    await expectState('guest::')

    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'other-tab-refresh')
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: REFRESH_TOKEN_STORAGE_KEY,
          newValue: 'other-tab-refresh',
          storageArea: window.localStorage,
        }),
      ),
    )
    await waitFor(() => expect(apis.refresh).toHaveBeenCalledWith('other-tab-refresh'))
    view.unmount()
    await act(async () => refresh.resolve(tokens('late-rotated', 'late-access')))

    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('other-tab-refresh')
  })

  it('unregisters unauthorized recovery when the provider unmounts', async () => {
    const apis = createApis()
    const view = renderSession(apis)
    await expectState('guest::')
    view.unmount()
    const fallbackRecovery = vi.fn(async () => false)
    const unregister = registerApiUnauthorizedRecovery(fallbackRecovery)
    const client = createApiClient({
      baseUrl: 'https://api.windup.test',
      fetchFn: async () =>
        new Response(JSON.stringify({ code: 401, message: 'expired', data: null }), {
          status: 200,
        }),
    })

    await expect(client.request('/resources')).rejects.toMatchObject({ code: 401 })
    expect(fallbackRecovery).toHaveBeenCalledTimes(1)
    expect(apis.refresh).not.toHaveBeenCalled()
    unregister()
  })
})
