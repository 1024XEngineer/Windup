// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'

import type { AuthTokens, UserApis } from '@/entities'
import { AuthSessionProvider } from '@/features/auth-session'
import { REFRESH_TOKEN_STORAGE_KEY } from '@/features/auth-session/session-storage'
import {
  AuthenticatedAuthSession,
  createAuthenticatedTestApis,
  GuestAuthSession,
} from '@/test/auth-session'
import { AppRoutes } from './app'

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('AppRoutes authentication boundary', () => {
  it('keeps the public landing page available to guests', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    expect(await screen.findByRole('heading', { name: /让你的角色/ })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '宣传页导航' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: '产品导航' })).toBeNull()
  })

  it('keeps authenticated users on the public landing page until they enter the workspace', async () => {
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByRole('navigation', { name: '宣传页导航' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '进入工作台' }).getAttribute('href')).toBe('/workspace')
  })

  it('protects the workspace home and preserves it as the login return path', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter initialEntries={['/workspace']}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/?account=login&returnTo=%2Fworkspace',
      ),
    )
    expect(screen.queryByText('选择一个起点')).toBeNull()
  })

  it('renders the workspace home inside the product shell for an authenticated user', async () => {
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/workspace']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByText('选择一个起点')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '产品导航' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回 Windup 工作台' }).getAttribute('href')).toBe(
      '/workspace',
    )
  })

  it('redirects a guest before rendering a protected product page and preserves its return path', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter initialEntries={['/quick-start?draft=1#setup']}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/?account=login&returnTo=%2Fquick-start%3Fdraft%3D1%23setup',
      ),
    )
    expect(screen.queryByRole('heading', { name: /开始一条可追踪的制作流程/ })).toBeNull()
  })

  it('redirects a guest from the PlayTest entry and preserves that return path', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter initialEntries={['/playtest']}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/?account=login&returnTo=%2Fplaytest',
      ),
    )
    expect(screen.queryByRole('heading', { name: '选择可试玩资产' })).toBeNull()
  })

  it('protects direct account-center visits and returns there after login', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter initialEntries={['/account']}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/?account=login&returnTo=%2Faccount',
      ),
    )
    expect(screen.queryByRole('heading', { name: '账号中心' })).toBeNull()
  })

  it('waits for session restoration before mounting a protected page', async () => {
    let resolveRefresh!: (tokens: AuthTokens) => void
    const refresh = new Promise<AuthTokens>((resolve) => {
      resolveRefresh = resolve
    })
    const baseApis = createAuthenticatedTestApis()
    const restoringApis: UserApis = { ...baseApis, refresh: async () => refresh }
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'stored-refresh-token')

    render(
      <AuthSessionProvider apis={restoringApis}>
        <MemoryRouter initialEntries={['/quick-start']}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </AuthSessionProvider>,
    )

    expect(screen.queryByRole('heading', { name: /开始一条可追踪的制作流程/ })).toBeNull()
    expect(screen.getByTestId('location').textContent).toBe('/quick-start')

    const restoredTokens = await baseApis.refresh('stored-refresh-token')
    await act(async () => resolveRefresh(restoredTokens))

    expect(await screen.findByRole('heading', { name: /开始一条可追踪的制作流程/ })).toBeTruthy()
  })

  it('renders protected product pages for an authenticated session', async () => {
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/quick-start']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByRole('heading', { name: /开始一条可追踪的制作流程/ })).toBeTruthy()
  })

  it('tells the user when restoring the session fails instead of becoming a silent guest', async () => {
    const expiredApis: UserApis = {
      sendCode: async () => undefined,
      register: async () => Promise.reject(new Error('not used')),
      login: async () => Promise.reject(new Error('not used')),
      loginByCode: async () => Promise.reject(new Error('not used')),
      refresh: async () => Promise.reject(new Error('refresh token expired')),
      logout: async () => undefined,
      me: async () => Promise.reject(new Error('not used')),
      updateNickname: async () => Promise.reject(new Error('not used')),
      changePassword: async () => Promise.reject(new Error('not used')),
    }
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'expired-refresh-token')

    render(
      <AuthSessionProvider apis={expiredApis}>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthSessionProvider>,
    )

    expect((await screen.findByRole('alert')).textContent).toContain('登录状态已过期，请重新登录。')
    expect(screen.getByRole('link', { name: '重新登录' }).getAttribute('href')).toBe(
      '/?account=login&returnTo=%2F',
    )
  })

  it('reuses the protected return path after the expired-session panel is closed and reopened', async () => {
    const expiredApis: UserApis = {
      sendCode: async () => undefined,
      register: async () => Promise.reject(new Error('not used')),
      login: async () => Promise.reject(new Error('not used')),
      loginByCode: async () => Promise.reject(new Error('not used')),
      refresh: async () => Promise.reject(new Error('refresh token expired')),
      logout: async () => undefined,
      me: async () => Promise.reject(new Error('not used')),
      updateNickname: async () => Promise.reject(new Error('not used')),
      changePassword: async () => Promise.reject(new Error('not used')),
    }
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'expired-refresh-token')

    render(
      <AuthSessionProvider apis={expiredApis}>
        <MemoryRouter initialEntries={['/quick-start?draft=1#setup']}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </AuthSessionProvider>,
    )

    expect(await screen.findByRole('dialog', { name: '登录 Windup' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/?returnTo=%2Fquick-start%3Fdraft%3D1%23setup',
      ),
    )

    fireEvent.click(screen.getByRole('link', { name: '重新登录' }))

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/?account=login&returnTo=%2Fquick-start%3Fdraft%3D1%23setup',
      ),
    )
  })
})
