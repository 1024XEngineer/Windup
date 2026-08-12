// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

import type { AuthTokens, UserApis } from '@/entities'
import { AuthSessionProvider } from '@/features/auth-session'
import { AppHeader } from './app-header'

const user = {
  id: '7',
  email: 'reader@example.com',
  nickname: 'Reader',
  emailVerifiedAt: '2026-08-07T01:02:03Z',
  statusCode: 0,
}

function tokens(): AuthTokens {
  return { accessToken: 'access-token', refreshToken: 'rotated-refresh-token', user }
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

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  )
}

function renderHeader(entry = '/', apis = createApis()) {
  return {
    apis,
    ...render(
      <AuthSessionProvider apis={apis}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <AppHeader />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthSessionProvider>,
    ),
  }
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('AppHeader', () => {
  it('提供 PlayTest 入口，并将工作流路由归入创作', () => {
    renderHeader('/workflow-editor/run-1')

    expect(screen.getByRole('link', { name: '返回 Windup 工作台' }).getAttribute('href')).toBe(
      '/workspace',
    )
    expect(screen.getByRole('link', { name: '项目资产' }).getAttribute('href')).toBe('/projects')
    expect(screen.getByRole('link', { name: '创作' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'PlayTest' }).getAttribute('href')).toBe('/playtest')
  })

  it('在工作台首页只高亮首页一项', () => {
    renderHeader('/workspace')

    expect(screen.getByRole('link', { name: '首页' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '项目资产' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: '创作' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: 'PlayTest' }).getAttribute('aria-current')).toBeNull()
  })

  it('在资产选择页和具体试玩台高亮 PlayTest 入口', () => {
    const { unmount } = renderHeader('/playtest')

    expect(screen.getByRole('link', { name: 'PlayTest' }).getAttribute('aria-current')).toBe('page')

    unmount()
    renderHeader('/playtest/51/outfit-default')
    expect(screen.getByRole('link', { name: 'PlayTest' }).getAttribute('aria-current')).toBe('page')
  })

  it('为访客提供可发现的登录入口并保留完整站内回跳地址', async () => {
    renderHeader('/quick-start?mode=fast#brief')

    const entry = await screen.findByRole('link', { name: '登录 / 注册' })
    expect(entry.getAttribute('href')).toBe(
      '/?account=login&returnTo=%2Fquick-start%3Fmode%3Dfast%23brief',
    )
  })

  it('显示登录用户并在登出后回到首页访客态', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    const { apis } = renderHeader('/projects')

    expect(await screen.findByText('Reader')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    expect(await screen.findByRole('link', { name: '登录 / 注册' })).toBeTruthy()
    expect(apis.logout).toHaveBeenCalledWith('rotated-refresh-token')
  })

  it('让登录用户从 Header 的账号信息进入账号中心', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    renderHeader('/account')

    const account = await screen.findByRole('link', { name: '打开账号中心' })
    expect(account.getAttribute('href')).toBe('/account')
    expect(account.getAttribute('aria-current')).toBe('page')
    expect(account.textContent).toContain('Reader')
    expect(screen.getByText('资料与登录安全')).toBeTruthy()
  })
})
