// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import type { AuthSessionValue } from '@/features/auth-session'
import { useAuthSession } from '@/features/auth-session'
import { HomePage } from '@/pages/home'
import { AppShell } from './index'

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
  const user = {
    id: 7,
    email: 'ada@example.test',
    nickname: 'Ada',
    emailVerifiedAt: null,
    status: 'normal' as const,
  }
  const tokens = { accessToken: 'access', refreshToken: 'refresh', user }
  mockedUseAuthSession.mockReset()
  mockedUseAuthSession.mockReturnValue({
    state: { status: 'guest', user: null },
    sendCode: vi.fn(async () => undefined),
    register: vi.fn(async () => tokens),
    login: vi.fn(async () => tokens),
    loginByCode: vi.fn(async () => tokens),
    changePassword: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  } satisfies AuthSessionValue)
})

describe('AppShell', () => {
  it.each([
    ['/', '首页'],
    ['/workflow-editor/run-1', 'Workflow Editor'],
  ])('为%s 使用全宽页面容器', (pathname) => {
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <AppShell>
          <div>页面内容</div>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('main').className).toContain('w-full')
    expect(screen.getByRole('main').className).not.toContain('max-w-5xl')
  })

  it.each(['/playtest', '/playtest/demo', '/playtest/character-1/outfit-1'])(
    '在独立 Playtest 工作台 %s 中保留返回入口与产品导航',
    (pathname) => {
      render(
        <MemoryRouter initialEntries={[pathname]}>
          <AppShell>
            <main aria-label="Playtest">Playtest 工作台</main>
          </AppShell>
        </MemoryRouter>,
      )

      expect(screen.getByRole('banner')).toBeTruthy()
      expect(screen.getByRole('button', { name: '返回上一页' })).toBeTruthy()
      expect(screen.getByRole('link', { name: '首页' }).getAttribute('href')).toBe('/')
      expect(screen.getByRole('link', { name: '项目' }).getAttribute('href')).toBe('/projects')
      expect(screen.getByRole('link', { name: '预览台' }).getAttribute('aria-current')).toBe('page')
      expect(screen.getByRole('link', { name: '创作' }).getAttribute('href')).toBe('/quick-start')
      expect(screen.getAllByRole('main')).toHaveLength(1)
    },
  )

  it('首页账户面板将 Header 与页面统一隔离，同时让 portal dialog 留在背景之外', () => {
    render(
      <MemoryRouter initialEntries={['/?account=login']}>
        <AppShell>
          <HomePage />
        </AppShell>
      </MemoryRouter>,
    )

    const dialog = screen.getByRole('dialog', { name: '账户认证' })
    const header = screen
      .getByRole('link', { name: '返回 Windup 首页', hidden: true })
      .closest('header')!
    const background = header.parentElement!
    const homeHeading = screen.getByRole('heading', { name: /真正登场/, hidden: true })

    expect(background.contains(homeHeading)).toBe(true)
    expect(background.getAttribute('inert')).toBe('')
    expect(background.getAttribute('aria-hidden')).toBe('true')
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(dialog.closest('[inert]')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: '关闭账户面板' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    const restoredHeader = screen.getByRole('link', { name: '返回 Windup 首页' }).closest('header')!
    const restoredBackground = restoredHeader.parentElement!
    expect(restoredBackground.getAttribute('inert')).toBeNull()
    expect(restoredBackground.getAttribute('aria-hidden')).toBeNull()
  })
})
