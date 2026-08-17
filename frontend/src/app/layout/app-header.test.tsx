// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

import type { AuthTokens, CreditAccount, QuotaApis, UserApis } from '@/entities'
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

const creditAccount: CreditAccount = {
  id: '11',
  userId: '7',
  balance: 90,
  frozen: 10,
  totalEarned: 150,
  totalSpent: 50,
  createdAt: '2026-08-12T01:02:03Z',
  updatedAt: '2026-08-17T01:02:03Z',
}

function createQuotaMock(): QuotaApis & {
  [K in keyof QuotaApis]: ReturnType<typeof vi.fn>
} {
  return {
    getBalance: vi.fn(async () => creditAccount),
    listTransactions: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    getInviteCode: vi.fn(async () => ({
      code: 'AB23CD45',
      usedCount: 0,
      createdAt: '2026-08-17T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })),
    generateInviteCode: vi.fn(async () => ({
      code: 'XY89KL23',
      usedCount: 0,
      createdAt: '2026-08-17T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })),
    redeemInviteCode: vi.fn(async () => undefined),
  }
}

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  )
}

function renderHeader(
  entry = '/',
  apis = createApis(),
  previousEntry?: string,
  quota = createQuotaMock(),
) {
  return {
    apis,
    quota,
    ...render(
      <AuthSessionProvider apis={apis}>
        <MemoryRouter
          initialEntries={previousEntry ? [previousEntry, entry] : [entry]}
          initialIndex={previousEntry ? 1 : 0}
        >
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <AppHeader quotaApis={quota} />
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
  window.sessionStorage.clear()
  window.history.replaceState({ idx: 0 }, '')
})

describe('AppHeader', () => {
  it.each([
    ['/quick-start/run-42', '/quick-start'],
    ['/playtest/7/outfit-8', '/playtest'],
    ['/projects/new', '/projects'],
    ['/workflow-editor/run-42', '/workspace'],
    ['/workspace', '/'],
    ['/account', '/workspace'],
  ])('直接打开 %s 时按页面层级返回 %s', (entry, expected) => {
    window.history.replaceState({ idx: 0 }, '')
    renderHeader(entry)

    const back = screen.getByRole('button', { name: '返回上一页' })
    expect(back.getAttribute('title')).toBe('返回上一页')
    expect(back.className).toContain('h-9')
    expect(back.className).toContain('w-9')

    fireEvent.click(back)
    expect(screen.getByTestId('location').textContent).toBe(expected)
  })

  it('存在站内浏览历史时返回真实上一页', () => {
    window.history.replaceState({ idx: 1 }, '')
    renderHeader('/quick-start', createApis(), '/projects')

    fireEvent.click(screen.getByRole('button', { name: '返回上一页' }))
    expect(screen.getByTestId('location').textContent).toBe('/projects')
  })

  it('提供预览台入口，并将工作流路由归入创作', () => {
    renderHeader('/workflow-editor/run-1')

    expect(screen.getByRole('banner').getAttribute('data-surface')).toBe('frosted-bar')
    expect(screen.getByRole('banner').getAttribute('data-motion')).toBeNull()
    expect(screen.getByRole('link', { name: '返回 Windup 工作台' }).getAttribute('href')).toBe(
      '/workspace',
    )
    expect(screen.getByRole('link', { name: '项目资产' }).getAttribute('href')).toBe('/projects')
    expect(screen.getByRole('link', { name: '创作' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '预览台' }).getAttribute('href')).toBe('/playtest')
  })

  it('在工作台首页只高亮首页一项', () => {
    renderHeader('/workspace')

    expect(screen.getByRole('link', { name: '首页' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '项目资产' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: '创作' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: '预览台' }).getAttribute('aria-current')).toBeNull()
  })

  it('切换页面后继续播放与品牌一致的文字波浪', () => {
    renderHeader('/workspace')

    const projects = screen.getByRole('link', { name: '项目资产' })
    fireEvent.click(projects)

    expect(projects.classList.contains('app-header-text-wave')).toBe(true)
    expect(
      screen
        .getByRole('link', { name: '返回 Windup 工作台' })
        .classList.contains('app-header-text-wave'),
    ).toBe(false)
    expect(screen.getByTestId('location').textContent).toBe('/projects')
  })

  it('品牌与首页分别播放文字波浪', () => {
    renderHeader('/projects')

    const brand = screen.getByRole('link', { name: '返回 Windup 工作台' })
    const home = screen.getByRole('link', { name: '首页' })
    fireEvent.click(brand)

    expect(brand.classList.contains('app-header-text-wave')).toBe(true)
    expect(home.classList.contains('app-header-text-wave')).toBe(false)
  })

  it('连续激活同一入口会重新开始文字波浪', () => {
    renderHeader('/workspace')

    const projects = screen.getByRole('link', { name: '项目资产' })
    fireEvent.click(projects)
    const firstGlyph = projects.querySelector('.app-header-wave-glyph')

    fireEvent.click(projects)
    const replayedGlyph = projects.querySelector('.app-header-wave-glyph')

    expect(replayedGlyph).not.toBe(firstGlyph)
    expect(projects.classList.contains('app-header-text-wave')).toBe(true)
  })

  it('在资产选择页和具体预览台高亮预览台入口', () => {
    const { unmount } = renderHeader('/playtest')

    expect(screen.getByRole('link', { name: '预览台' }).getAttribute('aria-current')).toBe('page')

    unmount()
    renderHeader('/playtest/51/outfit-default')
    expect(screen.getByRole('link', { name: '预览台' }).getAttribute('aria-current')).toBe('page')
  })

  it('为访客提供可发现的登录入口并保留完整站内回跳地址', async () => {
    renderHeader('/quick-start?mode=fast#brief')

    const entry = await screen.findByRole('link', { name: '登录' })
    expect(entry.getAttribute('href')).toBe(
      '/?account=login&returnTo=%2Fquick-start%3Fmode%3Dfast%23brief',
    )
  })

  it('显示登录用户并在登出后回到首页访客态', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    const { apis } = renderHeader('/projects')

    const accountMenu = await screen.findByRole('button', { name: '打开账号菜单' })
    expect(accountMenu.textContent).toContain('Reader')
    fireEvent.click(accountMenu)
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    expect(await screen.findByRole('link', { name: '登录' })).toBeTruthy()
    expect(apis.logout).toHaveBeenCalledWith('rotated-refresh-token')
  })

  it('登录工作台后显示一次邀请奖励提示，打开账号菜单时收起', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    renderHeader('/workspace')

    expect(await screen.findByRole('status', { name: '邀请奖励提示' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '打开账号菜单' }))

    expect(screen.queryByRole('status', { name: '邀请奖励提示' })).toBeNull()
  })

  it('远端退出失败时仍清除本地会话并返回首页', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    const apis = createApis()
    apis.logout.mockRejectedValue(new Error('退出请求失败'))
    renderHeader('/projects', apis)

    fireEvent.click(await screen.findByRole('button', { name: '打开账号菜单' }))
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    expect(await screen.findByRole('link', { name: '登录' })).toBeTruthy()
  })

  it('没有昵称时使用邮箱展示账号身份', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    const apis = createApis()
    apis.refresh.mockResolvedValue({
      ...tokens(),
      user: { ...user, nickname: '' },
    })
    renderHeader('/workspace', apis)

    const accountMenu = await screen.findByRole('button', { name: '打开账号菜单' })
    expect(accountMenu.textContent).toContain('reader@example.com')
    expect(accountMenu.textContent).toContain('r')
  })

  it('让登录用户从 Header 的账号信息进入账号中心', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    renderHeader('/account')

    const accountMenu = await screen.findByRole('button', { name: '打开账号菜单' })
    const menuSurface = screen.getByTestId('account-menu')
    expect(menuSurface.getAttribute('data-state')).toBe('closed')
    expect(menuSurface.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('link', { name: '打开账号中心' })).toBeNull()

    fireEvent.click(accountMenu)
    expect(menuSurface.getAttribute('data-state')).toBe('open')
    expect(menuSurface.getAttribute('data-motion')).toBe('scale-fade')
    expect(menuSurface.getAttribute('aria-hidden')).toBeNull()
    const account = screen.getByRole('link', { name: '打开账号中心' })
    expect(account.getAttribute('href')).toBe('/account')
    expect(account.getAttribute('aria-current')).toBe('page')
    expect(accountMenu.textContent).toContain('Reader')
    expect(screen.queryByText('资料与登录安全')).toBeNull()

    fireEvent.click(account)
    expect(menuSurface.getAttribute('data-state')).toBe('closing')
    expect(screen.getByTestId('location').textContent).toBe('/account')
    fireEvent.animationEnd(menuSurface)
    await waitFor(() => expect(menuSurface.getAttribute('data-state')).toBe('closed'))

    fireEvent.click(accountMenu)

    fireEvent.click(accountMenu)
    expect(menuSurface.getAttribute('data-state')).toBe('closing')
    expect(menuSurface.getAttribute('aria-hidden')).toBe('true')
    expect(menuSurface.classList.contains('app-header-account-menu-out')).toBe(true)
    expect(menuSurface.classList.contains('invisible')).toBe(false)
    expect(screen.queryByRole('link', { name: '打开账号中心' })).toBeNull()

    await waitFor(() => expect(menuSurface.getAttribute('data-state')).toBe('closed'))
    expect(menuSurface.classList.contains('invisible')).toBe(true)
  })

  it('打开账号菜单时查询并展示最新可用积分', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    let resolveBalance: (account: CreditAccount) => void = () => undefined
    const quota = createQuotaMock()
    quota.getBalance.mockReturnValue(
      new Promise<CreditAccount>((resolve) => {
        resolveBalance = resolve
      }),
    )
    renderHeader('/workspace', createApis(), undefined, quota)

    fireEvent.click(await screen.findByRole('button', { name: '打开账号菜单' }))

    await waitFor(() => expect(quota.getBalance).toHaveBeenCalledTimes(1))
    expect(screen.getByText('可用积分')).toBeTruthy()
    expect(screen.getByText('查询中…')).toBeTruthy()

    resolveBalance(creditAccount)
    expect(await screen.findByText('90')).toBeTruthy()
    expect(screen.getByText('积分')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '打开账号菜单' }))
    expect(screen.getByText('90')).toBeTruthy()
  })

  it('积分查询失败时保留账号菜单的其他操作', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    const quota = createQuotaMock()
    quota.getBalance.mockRejectedValue(new Error('积分接口不可用'))
    renderHeader('/workspace', createApis(), undefined, quota)

    fireEvent.click(await screen.findByRole('button', { name: '打开账号菜单' }))

    expect(await screen.findByText('积分暂不可用')).toBeTruthy()
    expect(screen.getByRole('link', { name: '打开账号中心' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy()
  })

  it('使用贴顶毛玻璃栏承载品牌、产品导航与账号入口', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    renderHeader('/workspace')

    const header = screen.getByRole('banner')
    const navigation = screen.getByRole('navigation', { name: '产品导航' })
    expect(header.getAttribute('data-layout')).toBe('unified')
    expect(header.getAttribute('data-surface')).toBe('frosted-bar')
    expect(header.className).toContain('inset-x-0')
    expect(header.className).toContain('top-0')
    expect(header.className).toContain('bg-transparent')
    expect(header.className).toContain('backdrop-blur-xl')
    expect(header.className).not.toContain('bg-[#f3f2ec]')
    expect(header.className).not.toContain('rounded-[10px]')
    expect(header.className).not.toContain('-translate-x-1/2')
    expect(navigation.className).not.toContain('hidden')
    expect(await screen.findByRole('button', { name: '打开账号菜单' })).toBeTruthy()
    expect(screen.queryByText('角色资产工作台')).toBeNull()

    const animatedEntries = [
      screen.getByRole('link', { name: '返回 Windup 工作台' }),
      screen.getByRole('link', { name: '首页' }),
      screen.getByRole('link', { name: '项目资产' }),
      screen.getByRole('link', { name: '创作' }),
      screen.getByRole('link', { name: '预览台' }),
    ]
    for (const entry of animatedEntries) {
      expect(entry.getAttribute('data-motion')).toBe('text-wave')
    }

    expect(
      screen.getByRole('link', { name: '项目资产' }).querySelectorAll('.app-header-wave-glyph'),
    ).toHaveLength('项目资产项目'.length)
  })
})
