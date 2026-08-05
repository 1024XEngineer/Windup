// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthTokens, User, UserApis } from '@/entities/user'
import { getApiAccessToken } from '@/shared/api'
import {
  AuthSessionProvider,
  ProtectedRoute,
  createLocalUserApis,
  resolveAuthMode,
  useAuthSession,
} from '.'
import { REFRESH_TOKEN_STORAGE_KEY } from './session-storage'

const user: User = {
  id: 7,
  email: 'ada@example.test',
  nickname: 'Ada',
  emailVerifiedAt: '2026-08-05T00:00:00Z',
  status: 'normal',
}

let session: ReturnType<typeof useAuthSession> | undefined

function SessionProbe() {
  session = useAuthSession()
  return <output aria-label="session-status">{session.state.status}</output>
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="location">{`${location.pathname}${location.search}`}</output>
}

function renderProvider(apis: UserApis, children: ReactNode = <SessionProbe />, strict = false) {
  const tree = <AuthSessionProvider apis={apis}>{children}</AuthSessionProvider>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

beforeEach(() => {
  vi.stubEnv('VITE_AUTH_MODE', 'backend')
  session = undefined
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('AuthSessionProvider', () => {
  it('rotates the stored refresh token once in StrictMode, exposes it only through memory, then loads the current user', async () => {
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'stored-refresh')
    const rotated = tokens('rotated-access', 'rotated-refresh')
    const apis = createApis({
      refresh: vi.fn(async () => rotated),
      me: vi.fn(async () => user),
    })

    renderProvider(apis, <SessionProbe />, true)

    await waitFor(() =>
      expect(screen.getByLabelText('session-status').textContent).toBe('authenticated'),
    )
    expect(apis.refresh).toHaveBeenCalledTimes(1)
    expect(apis.refresh).toHaveBeenCalledWith('stored-refresh')
    expect(apis.me).toHaveBeenCalledTimes(1)
    expect(getApiAccessToken()).toBe('rotated-access')
    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('rotated-refresh')
  })

  it('stores the rotated refresh token and keeps the access token in memory after login', async () => {
    const apis = createApis({ login: vi.fn(async () => tokens('login-access', 'login-refresh')) })
    renderProvider(apis)
    await waitFor(() => expect(session?.state.status).toBe('guest'))

    await act(async () => {
      await session?.login({ email: 'ada@example.test', password: 'password1', code: '123456' })
    })

    expect(session?.state).toEqual({ status: 'authenticated', user })
    expect(getApiAccessToken()).toBe('login-access')
    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('login-refresh')
  })

  it('unregisters its in-memory access token provider when unmounted', async () => {
    const apis = createApis({ login: vi.fn(async () => tokens('login-access', 'login-refresh')) })
    const view = renderProvider(apis)
    await waitFor(() => expect(session?.state.status).toBe('guest'))
    await act(async () => {
      await session?.login({ email: 'ada@example.test', password: 'password1', code: '123456' })
    })
    expect(getApiAccessToken()).toBe('login-access')

    view.unmount()

    expect(getApiAccessToken()).toBeUndefined()
  })

  it('falls back to a cleared guest session when startup token rotation fails', async () => {
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'revoked-refresh')
    const apis = createApis({
      refresh: vi.fn(async () => {
        throw new Error('refresh revoked')
      }),
    })

    renderProvider(apis)

    await waitFor(() => expect(session?.state).toEqual({ status: 'guest', user: null }))
    expect(getApiAccessToken()).toBeNull()
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('does not restore a stale startup session after the user logs out', async () => {
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'stored-refresh')
    const startupRefresh = deferred<AuthTokens>()
    const apis = createApis({ refresh: vi.fn(() => startupRefresh.promise) })
    renderProvider(apis)
    await waitFor(() => expect(apis.refresh).toHaveBeenCalledWith('stored-refresh'))

    await act(async () => {
      await session?.logout()
    })
    await act(async () => {
      startupRefresh.resolve(tokens('stale-access', 'stale-refresh'))
      await startupRefresh.promise
    })

    await waitFor(() => expect(session?.state).toEqual({ status: 'guest', user: null }))
    expect(getApiAccessToken()).toBeNull()
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('does not let a stale startup failure clear a newer login', async () => {
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'stored-refresh')
    const startupMe = deferred<User>()
    const apis = createApis({
      refresh: vi.fn(async () => tokens('startup-access', 'startup-refresh')),
      me: vi.fn(() => startupMe.promise),
      login: vi.fn(async () => tokens('login-access', 'login-refresh')),
    })
    renderProvider(apis)
    await waitFor(() => expect(apis.me).toHaveBeenCalledTimes(1))

    await act(async () => {
      await session?.login({ email: 'ada@example.test', password: 'password1', code: '123456' })
    })
    await act(async () => {
      startupMe.reject(new Error('stale me failure'))
      await Promise.resolve()
    })

    await waitFor(() => expect(session?.state).toEqual({ status: 'authenticated', user }))
    expect(getApiAccessToken()).toBe('login-access')
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('login-refresh')
  })

  it('clears the local session before surfacing a backend logout failure', async () => {
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'stored-refresh')
    const apis = createApis({
      refresh: vi.fn(async () => tokens('access', 'rotated-refresh')),
      me: vi.fn(async () => user),
      logout: vi.fn(async () => {
        throw new Error('backend unavailable')
      }),
    })
    renderProvider(apis)
    await waitFor(() => expect(session?.state.status).toBe('authenticated'))

    await act(async () => {
      await expect(session?.logout()).rejects.toThrow('backend unavailable')
    })

    expect(session?.state).toEqual({ status: 'guest', user: null })
    expect(getApiAccessToken()).toBeNull()
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull()
    expect(apis.logout).toHaveBeenCalledWith('rotated-refresh')
  })

  it('clears the session after a successful password change because the backend revokes refresh tokens', async () => {
    const apis = createApis({ login: vi.fn(async () => tokens('access', 'refresh')) })
    renderProvider(apis)
    await waitFor(() => expect(session?.state.status).toBe('guest'))
    await act(async () => {
      await session?.login({ email: 'ada@example.test', password: 'password1', code: '123456' })
    })

    await act(async () => {
      await session?.changePassword({ oldPassword: 'password1', newPassword: 'password2' })
    })

    expect(apis.changePassword).toHaveBeenCalledWith({
      oldPassword: 'password1',
      newPassword: 'password2',
    })
    expect(session?.state).toEqual({ status: 'guest', user: null })
    expect(getApiAccessToken()).toBeNull()
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('refreshes an expiring JWT sixty seconds before expiry and rotates the refresh token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T00:00:00Z'))
    const expiringAccess = jwtExpiringAt(Date.now() + 120_000)
    const refreshedAccess = jwtExpiringAt(Date.now() + 3_600_000)
    const apis = createApis({ login: vi.fn(async () => tokens(expiringAccess, 'refresh-1')) })
    vi.mocked(apis.refresh).mockResolvedValue(tokens(refreshedAccess, 'refresh-2'))
    renderProvider(apis)
    await act(async () => Promise.resolve())
    await act(async () => {
      await session?.login({ email: 'ada@example.test', password: 'password1', code: '123456' })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(apis.refresh).toHaveBeenCalledWith('refresh-1')
    expect(getApiAccessToken()).toBe(refreshedAccess)
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-2')
  })

  it('exposes every account action as a Promise-returning operation', async () => {
    const apis = createApis()
    renderProvider(apis)
    await waitFor(() => expect(session?.state.status).toBe('guest'))

    await expect(
      session?.sendCode({ email: 'ada@example.test', purpose: 'login' }),
    ).resolves.toBeUndefined()
    await expect(
      session?.register({ email: 'ada@example.test', password: 'password1', code: '123456' }),
    ).resolves.toEqual(tokens('access', 'refresh'))
    await expect(
      session?.loginByCode({ email: 'ada@example.test', code: '123456' }),
    ).resolves.toEqual(tokens('access', 'refresh'))
  })
})

describe('resolveAuthMode', () => {
  it('开发环境默认使用本地登录，生产环境始终使用真实后端认证', () => {
    expect(resolveAuthMode('', true)).toBe('local')
    expect(resolveAuthMode('local', true)).toBe('local')
    expect(resolveAuthMode('backend', true)).toBe('backend')
    expect(resolveAuthMode('local', false)).toBe('backend')
  })
})

describe('createLocalUserApis', () => {
  it('只保存本地用户资料，不把密码和验证码写入浏览器存储，并可恢复会话', async () => {
    const apis = createLocalUserApis()
    const authenticated = await apis.register({
      email: 'ada@example.test',
      password: 'password1',
      code: '123456',
      nickname: 'Ada',
    })

    expect(authenticated.user).toMatchObject({
      email: 'ada@example.test',
      nickname: 'Ada',
      status: 'normal',
    })
    expect(JSON.stringify(window.localStorage)).not.toContain('password1')
    expect(JSON.stringify(window.localStorage)).not.toContain('123456')

    await expect(createLocalUserApis().refresh(authenticated.refreshToken)).resolves.toMatchObject({
      user: authenticated.user,
    })
  })
})

describe('ProtectedRoute', () => {
  it.each([
    [
      '/projects/7?tab=assets#frames',
      '/?account=login&returnTo=%2Fprojects%2F7%3Ftab%3Dassets%23frames',
    ],
    ['//evil.example/path', '/?account=login'],
  ])(
    'returns a guest from %s to the public login panel with only a safe same-site returnTo',
    async (entry, expected) => {
      const apis = createApis()
      renderProvider(
        apis,
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="*"
              element={
                <ProtectedRoute>
                  <h1>Private</h1>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      )

      await waitFor(() => expect(screen.getByLabelText('location').textContent).toBe(expected))
      expect(screen.queryByRole('heading', { name: 'Private' })).toBeNull()
    },
  )
})

function tokens(accessToken: string, refreshToken: string): AuthTokens {
  return { accessToken, refreshToken, user }
}

function jwtExpiringAt(expiryTime: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expiryTime / 1000) }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  return `header.${payload}.signature`
}

function createApis(overrides: Partial<UserApis> = {}): UserApis {
  return {
    sendCode: vi.fn(async () => undefined),
    register: vi.fn(async () => tokens('access', 'refresh')),
    login: vi.fn(async () => tokens('access', 'refresh')),
    loginByCode: vi.fn(async () => tokens('access', 'refresh')),
    refresh: vi.fn(async () => tokens('access', 'refresh')),
    logout: vi.fn(async () => undefined),
    me: vi.fn(async () => user),
    changePassword: vi.fn(async () => undefined),
    ...overrides,
  }
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
