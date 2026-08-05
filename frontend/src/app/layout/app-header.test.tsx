// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'

import type { AuthSessionValue } from '@/features/auth-session'
import { useAuthSession } from '@/features/auth-session'
import { AppHeader } from './app-header'

vi.mock('@/features/auth-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth-session')>()
  return { ...actual, useAuthSession: vi.fn() }
})

const mockedUseAuthSession = vi.mocked(useAuthSession)

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv('VITE_AUTH_MODE', 'backend')
  mockedUseAuthSession.mockReturnValue({
    state: { status: 'guest', user: null },
    sendCode: vi.fn(async () => undefined),
    register: vi.fn(),
    login: vi.fn(),
    loginByCode: vi.fn(),
    changePassword: vi.fn(),
    logout: vi.fn(),
  } as AuthSessionValue)
})

function LocationProbe() {
  return <output aria-label="当前路径">{useLocation().pathname}</output>
}

describe('AppHeader', () => {
  it('shows login and registration entry for guests', () => {
    render(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '登录 / 注册' }).getAttribute('href')).toBe(
      '/?account=login',
    )
  })

  it('shows the authenticated nickname as the account entry', () => {
    mockedUseAuthSession.mockReturnValue({
      ...mockedUseAuthSession(),
      state: {
        status: 'authenticated',
        user: {
          id: 7,
          email: 'ada@example.test',
          nickname: 'Ada',
          emailVerifiedAt: null,
          status: 'normal',
        },
      },
    })

    render(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Ada' }).getAttribute('href')).toBe(
      '/?account=settings',
    )
  })

  it('保留产品入口，并将工作流路由归入创作', () => {
    render(
      <MemoryRouter initialEntries={['/workflow-editor/run-1']}>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '返回 Windup 首页' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: '项目' }).getAttribute('href')).toBe('/projects')
    expect(screen.getByRole('link', { name: '创作' }).getAttribute('aria-current')).toBe('page')
  })

  it('在 Playtest 中随页面滚动，其余页面继续悬浮', () => {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/playtest/25/outfit-25-default']}>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(container.querySelector('header')?.className.split(' ')).toContain('relative')
    expect(container.querySelector('header')?.className.split(' ')).not.toContain('fixed')
    unmount()

    const projects = render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(projects.container.querySelector('header')?.className.split(' ')).toContain('fixed')
  })

  it('将 Playtest 标记为独立核验工作区', () => {
    render(
      <MemoryRouter initialEntries={['/playtest/25/outfit-25-default']}>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(screen.getByText('动作预览与质量核验')).toBeTruthy()
    expect(screen.queryByText('项目与历史记录')).toBeNull()
  })

  it('允许从 Playtest 返回上一页', () => {
    render(
      <MemoryRouter
        initialEntries={['/quick-start/run-1', '/playtest/25/outfit-25-default']}
        initialIndex={1}
      >
        <AppHeader />
        <LocationProbe />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '返回上一页' }))
    expect(screen.getByLabelText('当前路径').textContent).toBe('/quick-start/run-1')
  })
})
