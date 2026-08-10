// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'

import { AppRoutes } from '@/app'
import { AuthSessionProvider } from '@/features/auth-session'
import { REFRESH_TOKEN_STORAGE_KEY } from '@/features/auth-session/session-storage'
import { AuthenticatedAuthSession, createAuthenticatedTestApis } from '@/test/auth-session'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('ProjectDetailPage', () => {
  it('keeps the Project workspace around a directly opened Character', async () => {
    const backend = createProjectAssetsBackend()
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)

    const { container } = render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects/42/assets/51']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByRole('heading', { name: '点灯人 · MVP' })).toBeTruthy()
    expect(screen.getByText('横版视角')).toBeTruthy()
    expect(screen.getByText('四向')).toBeTruthy()
    expect(screen.getByText('64 × 64')).toBeTruthy()
    expect(screen.getByText('低饱和像素绘本')).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回项目中心' }).getAttribute('href')).toBe(
      '/projects',
    )
    expect((await screen.findByRole('link', { name: '角色1' })).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.getByRole('button', { name: '动作模板' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('穿戴')).toBeNull()
    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
    expect(container.querySelector('[data-route-transition="/projects/42/assets/51"]')).toBeTruthy()
  })

  it('keeps the Project workspace available when the character count request fails', async () => {
    const backend = createProjectAssetsBackend()
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.url.includes('/characters?project_id=42')) {
        return Promise.reject(new Error('characters endpoint unavailable'))
      }
      return backend.fetch(input, init)
    })

    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects/42/assets/51']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByRole('heading', { name: '点灯人 · MVP' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
  })

  it('renders the Project workspace without waiting for the character count request', async () => {
    const backend = createProjectAssetsBackend()
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.url.includes('/characters?project_id=42')) {
        return new Promise<Response>(() => undefined)
      }
      return backend.fetch(input, init)
    })

    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects/42/assets']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByRole('heading', { name: '点灯人 · MVP' })).toBeTruthy()
    expect(screen.getByText('64 × 64')).toBeTruthy()
  })

  it('shows the current account in the workspace and returns home after logout', async () => {
    const backend = createProjectAssetsBackend()
    const apis = createAuthenticatedTestApis()
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'stored-refresh-token')

    render(
      <MemoryRouter initialEntries={['/projects/42/assets']}>
        <AuthSessionProvider apis={apis}>
          <AppRoutes />
        </AuthSessionProvider>
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '点灯人 · MVP' })).toBeTruthy()
    const account = screen.getByLabelText('当前账号')
    expect(account.textContent).toContain('Reader')
    expect(account.textContent).toContain('reader@example.com')

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
  })

  it('returns home without waiting for the remote logout request', async () => {
    const backend = createProjectAssetsBackend()
    const apis = createAuthenticatedTestApis()
    const pendingLogout = new Promise<void>(() => undefined)
    apis.logout = async () => pendingLogout
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'stored-refresh-token')

    render(
      <MemoryRouter initialEntries={['/projects/42/assets']}>
        <AuthSessionProvider apis={apis}>
          <AppRoutes />
        </AuthSessionProvider>
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '点灯人 · MVP' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    expect(screen.queryByRole('dialog', { name: '登录 Windup' })).toBeNull()
  })
})

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  )
}
