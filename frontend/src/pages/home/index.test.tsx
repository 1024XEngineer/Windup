// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'

import type { AuthSessionValue } from '@/features/auth-session'
import { useAuthSession } from '@/features/auth-session'
import { HomePage } from './index'

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
  mockedUseAuthSession.mockReset()
  mockedUseAuthSession.mockReturnValue(createSession({ status: 'guest', user: null }))
})

function createSession(state: AuthSessionValue['state']): AuthSessionValue {
  const user = {
    id: 7,
    email: 'ada@example.test',
    nickname: 'Ada',
    emailVerifiedAt: '2026-08-05T00:00:00Z',
    status: 'normal' as const,
  }
  const tokens = { accessToken: 'access', refreshToken: 'refresh', user }
  return {
    state,
    sendCode: vi.fn(async () => undefined),
    register: vi.fn(async () => tokens),
    login: vi.fn(async () => tokens),
    loginByCode: vi.fn(async () => tokens),
    changePassword: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="当前路径">{location.pathname + location.search}</output>
}

function renderHome(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <HomePage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  it('提供快速开始、新建项目和项目历史两个明确入口', () => {
    renderHome()

    expect(screen.getByRole('heading', { name: /真正登场/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /快速开始/ }).getAttribute('href')).toBe('/quick-start')
    expect(screen.getByRole('link', { name: /新建项目/ }).getAttribute('href')).toBe(
      '/workflow-editor',
    )
    expect(screen.getByRole('link', { name: '查看项目历史' }).getAttribute('href')).toBe(
      '/projects',
    )
  })

  it('游客从账户入口打开登录面板，关闭后移除账户与返回目标参数', () => {
    renderHome('/?account=login&returnTo=%2Fprojects')

    expect(screen.getByRole('heading', { name: '登录 Windup' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭账户面板' }))

    expect(screen.queryByRole('heading', { name: '登录 Windup' })).toBeNull()
    expect(screen.getByLabelText('当前路径').textContent).toBe('/')

    fireEvent.click(screen.getByRole('button', { name: '登录 / 注册' }))
    expect(screen.getByRole('heading', { name: '登录 Windup' })).toBeTruthy()
  })

  it('登录用户显示昵称并打开个人设置，昵称为空时使用邮箱前缀', () => {
    mockedUseAuthSession.mockReturnValue(
      createSession({
        status: 'authenticated',
        user: {
          id: 7,
          email: 'ada@example.test',
          nickname: null,
          emailVerifiedAt: null,
          status: 'normal',
        },
      }),
    )
    renderHome()

    fireEvent.click(screen.getByRole('button', { name: 'ada' }))
    expect(screen.getByRole('heading', { name: '个人设置' })).toBeTruthy()
  })

  it('登录用户优先显示非空昵称', () => {
    mockedUseAuthSession.mockReturnValue(
      createSession({
        status: 'authenticated',
        user: {
          id: 7,
          email: 'ada@example.test',
          nickname: 'Ada Lovelace',
          emailVerifiedAt: null,
          status: 'normal',
        },
      }),
    )
    renderHome()

    expect(screen.getByRole('button', { name: 'Ada Lovelace' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ada' })).toBeNull()
  })

  it('打开面板后循环焦点，Escape 关闭并恢复入口焦点', () => {
    renderHome()
    const accountTrigger = screen.getByRole('button', { name: '登录 / 注册' })
    accountTrigger.focus()

    fireEvent.click(accountTrigger)

    const dialog = screen.getByRole('dialog', { name: '账户认证' })
    const closeButton = within(dialog).getByRole('button', { name: '关闭账户面板' })
    const dialogButtons = within(dialog).getAllByRole('button')
    const lastButton = dialogButtons.at(-1)!
    expect(document.activeElement).toBe(closeButton)

    lastButton.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)

    closeButton.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(lastButton)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(accountTrigger)
  })

  it('不在 AppShell 的 main 页面容器内再创建 main landmark', () => {
    renderHome()

    expect(screen.queryByRole('main')).toBeNull()
  })
})
