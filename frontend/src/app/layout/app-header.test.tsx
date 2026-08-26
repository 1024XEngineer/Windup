// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

import type { AuthTokens, CreditAccount, QuotaApis, UserApis } from '@/entities'
import { forgetActiveRun, rememberActiveRun } from '@/features/active-run'
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
    redeemCode: vi.fn(async () => ({ credited: 1000, account: creditAccount })),
    getInviteCode: vi.fn(async () => ({
      code: 'AB23CD45',
      usedCount: 0,
      expiresAt: '2026-09-16T01:02:03Z',
      createdAt: '2026-08-17T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })),
    generateInviteCode: vi.fn(async () => ({
      code: 'XY89KL23',
      usedCount: 0,
      expiresAt: '2026-09-16T01:02:03Z',
      createdAt: '2026-08-17T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })),
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

function renderAuthenticatedHeader(entry = '/') {
  window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
  return renderHeader(entry)
}

function finishBackAnimation() {
  act(() => vi.advanceTimersByTime(240))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState({ idx: 0 }, '')
})

describe('AppHeader 进行中任务入口', () => {
  it('没有进行中的任务时，创作仍是直达新建的链接', () => {
    renderHeader('/workspace')

    expect(screen.getByRole('link', { name: '创作' }).getAttribute('href')).toBe('/quick-start')
    expect(screen.queryByRole('button', { name: /创作/ })).toBeNull()
  })

  it('存在进行中的任务时，创作入口带标记并可展开', async () => {
    rememberActiveRun('7', '77')

    renderAuthenticatedHeader('/workspace')

    const entry = await screen.findByRole('button', { name: '创作，有任务进行中' })
    expect(entry.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: '创作' })).toBeNull()

    fireEvent.click(entry)
    expect(screen.getByTestId('active-run-menu').className).toContain('rounded-app-surface')
    expect(screen.getByTestId('active-run-menu').className).toContain('border-app-line-strong')
  })

  it('任务在同一标签页开始后，入口无需刷新就出现', async () => {
    renderAuthenticatedHeader('/quick-start')
    await screen.findByRole('button', { name: '打开账号菜单' })
    expect(screen.queryByRole('button', { name: /创作/ })).toBeNull()

    act(() => rememberActiveRun('7', '77'))

    expect(await screen.findByRole('button', { name: '创作，有任务进行中' })).toBeTruthy()
  })

  it('任务进行期间文字旁跟一个张望的小机器人，红点自己不动', async () => {
    renderAuthenticatedHeader('/workspace')
    await screen.findByRole('button', { name: '打开账号菜单' })
    expect(document.querySelector('[data-active-run-bot]')).toBeNull()

    act(() => rememberActiveRun('7', '77'))
    const entry = screen.getByRole('button', { name: '创作，有任务进行中' })
    const bot = entry.querySelector('[data-active-run-bot]')
    expect(bot).toBeTruthy()
    // 文字保留：这一项不该在图标和文字之间换形态。
    expect(entry.textContent).toContain('创作')
    // 只有眼睛会动；脸和红点都挂在静止的层上。
    expect(bot?.querySelector('.app-header-bot-gaze')).toBeTruthy()
    expect(bot?.querySelector('.app-header-bot-blink')).toBeTruthy()
    expect(bot?.querySelector('[data-active-run-dot]')).toBeNull()
    expect(entry.querySelector('[data-active-run-dot]')).toBeTruthy()

    act(() => forgetActiveRun('7', '77'))
    expect(document.querySelector('[data-active-run-bot]')).toBeNull()
  })

  it('任务结束后入口随即收起', async () => {
    rememberActiveRun('7', '77')
    renderAuthenticatedHeader('/quick-start')
    await screen.findByRole('button', { name: '创作，有任务进行中' })

    act(() => forgetActiveRun('7', '77'))

    expect(screen.getByRole('link', { name: '创作' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /创作/ })).toBeNull()
  })

  it('展开后可以返回那条进行中的任务', async () => {
    rememberActiveRun('7', '77')
    renderAuthenticatedHeader('/workspace')

    fireEvent.click(await screen.findByRole('button', { name: '创作，有任务进行中' }))
    fireEvent.click(screen.getByRole('link', { name: '返回进行中的任务' }))

    expect(screen.getByTestId('location').textContent).toBe('/quick-start/77')
  })

  it('展开后仍然可以开始新的创作', async () => {
    rememberActiveRun('7', '77')
    renderAuthenticatedHeader('/workspace')

    fireEvent.click(await screen.findByRole('button', { name: '创作，有任务进行中' }))
    fireEvent.click(screen.getByRole('link', { name: '开始新的创作' }))

    expect(screen.getByTestId('location').textContent).toBe('/quick-start')
  })
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
    vi.useFakeTimers()
    window.history.replaceState({ idx: 0 }, '')
    renderHeader(entry)

    const back = screen.getByRole('button', { name: '返回上一页' })
    expect(back.getAttribute('title')).toBe('返回上一页')
    expect(back.className).toContain('h-9')
    expect(back.className).toContain('w-9')

    fireEvent.click(back)
    finishBackAnimation()
    expect(screen.getByTestId('location').textContent).toBe(expected)
  })

  it('存在站内浏览历史时返回真实上一页', () => {
    vi.useFakeTimers()
    window.history.replaceState({ idx: 1 }, '')
    renderHeader('/quick-start', createApis(), '/projects')

    const back = screen.getByRole('button', { name: '返回上一页' })
    fireEvent.click(back)
    finishBackAnimation()
    expect(screen.getByTestId('location').textContent).toBe('/projects')
  })

  it('点击后立即请求返回，同时保留箭头反馈', () => {
    vi.useFakeTimers()
    window.history.replaceState({ idx: 0 }, '')
    renderHeader('/projects')

    const back = screen.getByRole('button', { name: '返回上一页' })
    fireEvent.click(back)

    expect(back.classList.contains('app-header-back-in-flight')).toBe(true)
    expect(screen.getByTestId('location').textContent).toBe('/workspace')

    act(() => vi.advanceTimersByTime(240))
    expect(back.classList.contains('app-header-back-in-flight')).toBe(false)
  })

  it('动画进行中重复点击不会推迟返回', () => {
    vi.useFakeTimers()
    window.history.replaceState({ idx: 0 }, '')
    renderHeader('/projects')

    const back = screen.getByRole('button', { name: '返回上一页' })
    fireEvent.click(back)
    act(() => vi.advanceTimersByTime(150))
    fireEvent.click(back)
    act(() => vi.advanceTimersByTime(80))

    expect(screen.getByTestId('location').textContent).toBe('/workspace')
  })

  it('减少动态效果时立即返回', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )
    window.history.replaceState({ idx: 0 }, '')
    renderHeader('/projects')

    fireEvent.click(screen.getByRole('button', { name: '返回上一页' }))

    expect(screen.getByTestId('location').textContent).toBe('/workspace')
  })

  it('动画中卸载会取消待执行的返回', () => {
    vi.useFakeTimers()
    const { unmount } = renderHeader('/projects')

    fireEvent.click(screen.getByRole('button', { name: '返回上一页' }))
    expect(vi.getTimerCount()).toBe(1)
    unmount()

    expect(vi.getTimerCount()).toBe(0)
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

  it('左侧先显示品牌，再以无边框按钮承接返回操作', () => {
    renderHeader('/projects')

    const brand = screen.getByRole('link', { name: '返回 Windup 工作台' })
    const back = screen.getByRole('button', { name: '返回上一页' })

    expect(brand.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(back.className).not.toContain('border')
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

    const entry = await screen.findByRole('link', { name: '登录 / 注册' })
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
    expect(await screen.findByRole('link', { name: '登录 / 注册' })).toBeTruthy()
    expect(apis.logout).toHaveBeenCalledWith('rotated-refresh-token')
  })

  it('登录工作台后显示一次邀请奖励提示，打开账号菜单时收起', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    renderHeader('/workspace')

    expect(await screen.findByRole('status', { name: '邀请奖励提示' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '打开账号菜单' }))

    expect(screen.queryByRole('status', { name: '邀请奖励提示' })).toBeNull()
  })

  it('邀请提示可以直达邀请奖励，并在关闭或十五秒后收起', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    renderHeader('/workspace')

    const hint = await screen.findByRole('status', { name: '邀请奖励提示' })
    expect(screen.getByText('邀请成功，双方各得 200 积分')).toBeTruthy()
    expect(screen.getByText('每日前 3 次邀请可得奖励')).toBeTruthy()
    expect(screen.getByRole('link', { name: '去看看邀请奖励' }).getAttribute('href')).toBe(
      '/account?section=invite',
    )
    const timerCall = timeoutSpy.mock.calls.find(([, delay]) => delay === 15_000)
    expect(timerCall).toBeTruthy()
    const timerCallback = timerCall?.[0]
    expect(typeof timerCallback).toBe('function')
    act(() => {
      if (typeof timerCallback === 'function') timerCallback()
    })
    expect(screen.queryByRole('status', { name: '邀请奖励提示' })).toBeNull()

    window.sessionStorage.clear()
    cleanup()
    renderHeader('/workspace')
    expect(await screen.findByRole('status', { name: '邀请奖励提示' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭邀请奖励提示' }))
    expect(hint.isConnected).toBe(false)
  })

  it('当前登录会话离开工作台后不重复显示', async () => {
    window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
    renderHeader('/workspace')
    expect(await screen.findByRole('status', { name: '邀请奖励提示' })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: '项目资产' }))
    fireEvent.click(screen.getByRole('link', { name: '首页' }))
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
    expect(await screen.findByRole('link', { name: '登录 / 注册' })).toBeTruthy()
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

    expect(screen.getByRole('button', { name: '打开账号菜单' }).className).toContain(
      'rounded-app-control',
    )
    expect(screen.getByTestId('account-menu').className).toContain('rounded-app-surface')
    expect(screen.getByTestId('account-menu').className).toContain('border-app-line-strong')

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
