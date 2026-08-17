// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'

import { quotaApis } from '@/entities'
import type { AuthTokens, User, UserApis } from '@/entities'
import { AuthSessionProvider } from '@/features/auth-session'
import { AppRoutes } from '@/app/app'

const user: User = {
  id: '7',
  email: 'reader@example.com',
  nickname: 'Reader',
  emailVerifiedAt: '2026-08-07T01:02:03Z',
  statusCode: 0,
}

function tokens(): AuthTokens {
  return { accessToken: 'access-token', refreshToken: 'rotated-refresh-token', user }
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
    updateNickname: vi.fn(async (nickname: string) => ({ ...user, nickname })),
    changePassword: vi.fn(async () => undefined),
  }
}

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  )
}

function renderAccount(apis = createApis()) {
  window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
  return {
    apis,
    ...render(
      <AuthSessionProvider apis={apis}>
        <MemoryRouter initialEntries={['/account']}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </AuthSessionProvider>,
    ),
  }
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('AccountPage', () => {
  it('loads a fresh profile on entry and renders account facts', async () => {
    const apis = createApis()
    apis.me.mockResolvedValue({
      ...user,
      nickname: 'Fresh Reader',
      emailVerifiedAt: '2026-08-09T08:30:00Z',
    })

    renderAccount(apis)

    expect(await screen.findByRole('heading', { name: '账号中心' })).toBeTruthy()
    await waitFor(() => expect(apis.me).toHaveBeenCalledTimes(1))
    expect(screen.getByDisplayValue('Fresh Reader')).toBeTruthy()
    expect(screen.getByText('reader@example.com')).toBeTruthy()
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-08-09T08:30:00Z')
    expect(screen.getByRole('button', { name: '打开账号菜单' }).textContent).toContain(
      'Fresh Reader',
    )
  })

  it('falls back to the email name for an unverified profile without a nickname', async () => {
    const apis = createApis()
    apis.me.mockResolvedValue({
      ...user,
      nickname: null,
      emailVerifiedAt: null,
    })

    renderAccount(apis)

    expect(await screen.findByText('reader', { selector: 'p' })).toBeTruthy()
    expect(screen.getByText('未验证')).toBeTruthy()
    expect(screen.getByText('尚未验证')).toBeTruthy()
  })

  it('uses focused settings navigation instead of showing every form at once', async () => {
    const { container } = renderAccount()

    expect(await screen.findByRole('heading', { name: '账号中心' })).toBeTruthy()
    const page = container.querySelector('[data-account-page]')
    expect(page?.className).toContain('bg-app-canvas')
    const shell = container.querySelector('[data-account-shell]')
    expect(shell?.className).toContain('max-w-[1560px]')
    expect(screen.getByRole('heading', { name: '账号中心' }).className).toContain(
      'text-[clamp(2.15rem,4.5vw,4rem)]',
    )
    expect(container.querySelector('[data-account-layout="settings"]')).toBeTruthy()
    const pixelMark = screen.getByTestId('account-pixel-mark')
    expect(pixelMark.getAttribute('alt')).toBe('')
    expect(pixelMark.getAttribute('aria-hidden')).toBe('true')
    const badgeButton = screen.getByRole('button', { name: '摇一摇工牌' })
    fireEvent.click(badgeButton)
    expect(badgeButton.className).toContain('account-badge-shake')
    expect(screen.getByRole('navigation', { name: '账号设置' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '个人资料' })).toBeTruthy()
    expect(screen.queryByLabelText('当前密码')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录安全' }))
    expect(screen.getByRole('heading', { name: '登录安全' })).toBeTruthy()
    const oldPassword = screen.getByLabelText('当前密码')
    const newPassword = screen.getByLabelText('新密码')
    expect(oldPassword).toBeTruthy()
    expect(screen.queryByLabelText('昵称')).toBeNull()

    fireEvent.change(oldPassword, { target: { value: 'old-password' } })
    fireEvent.change(newPassword, { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect(await screen.findByText('新密码需为 8–128 位')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '个人资料' }))
    expect(screen.getByLabelText('昵称')).toBeTruthy()
    expect(screen.queryByText('新密码需为 8–128 位')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录安全' }))
    expect((screen.getByLabelText('当前密码') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('新密码') as HTMLInputElement).value).toBe('')
  })

  it('在账号中心展示积分汇总、流水与未知原因码', async () => {
    vi.spyOn(quotaApis, 'getBalance').mockResolvedValue({
      id: '11',
      userId: '7',
      balance: 90,
      frozen: 10,
      totalEarned: 150,
      totalSpent: 50,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    vi.spyOn(quotaApis, 'listTransactions').mockResolvedValue({
      items: [
        {
          id: '21',
          userId: '7',
          delta: -12,
          reason: 99,
          billingMode: 0,
          refId: 'generation-42',
          balanceAfter: 78,
          createdAt: '2026-08-17T02:03:04Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '积分账户' }))

    expect(await screen.findByRole('heading', { name: '积分账户' })).toBeTruthy()
    expect(await screen.findByText('90')).toBeTruthy()
    expect(screen.getByText('积分变动（原因码 99）')).toBeTruthy()
    expect(screen.getByText('-12')).toBeTruthy()
  })

  it('在账号中心直接管理邀请奖励', async () => {
    vi.spyOn(quotaApis, 'getBalance').mockResolvedValue({
      id: '11',
      userId: '7',
      balance: 90,
      frozen: 10,
      totalEarned: 150,
      totalSpent: 50,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    vi.spyOn(quotaApis, 'listTransactions').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    vi.spyOn(quotaApis, 'getInviteCode').mockResolvedValue({
      code: 'AB23CD45',
      usedCount: 2,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })

    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '邀请奖励' }))

    expect(await screen.findByRole('heading', { name: '邀请奖励' })).toBeTruthy()
    expect(await screen.findByText('AB23CD45')).toBeTruthy()
  })

  it('reports a profile refresh failure without claiming the data is synchronized', async () => {
    const apis = createApis()
    apis.me.mockRejectedValue(new Error('资料读取失败'))

    renderAccount(apis)

    expect(await screen.findByText('资料读取失败')).toBeTruthy()
    expect(screen.getByText('资料同步失败')).toBeTruthy()
    expect(screen.queryByText('资料已同步')).toBeNull()
  })

  it('updates the nickname and synchronizes the Header immediately', async () => {
    const { apis } = renderAccount()
    expect(await screen.findByText('资料已同步')).toBeTruthy()
    const nickname = screen.getByLabelText('昵称')

    fireEvent.change(nickname, { target: { value: 'New Reader' } })
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }))

    await waitFor(() => expect(apis.updateNickname).toHaveBeenCalledWith('New Reader'))
    expect(await screen.findByText('昵称已更新。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开账号菜单' }).textContent).toContain('New Reader')
  })

  it('preserves the edited nickname when the backend rejects it', async () => {
    const apis = createApis()
    apis.updateNickname.mockRejectedValue(new Error('昵称已存在'))
    renderAccount(apis)
    expect(await screen.findByText('资料已同步')).toBeTruthy()
    const nickname = screen.getByDisplayValue('Reader')

    fireEvent.change(nickname, { target: { value: 'Taken Name' } })
    fireEvent.click(screen.getByRole('button', { name: '保存昵称' }))

    expect(await screen.findByText('昵称已存在')).toBeTruthy()
    expect((nickname as HTMLInputElement).value).toBe('Taken Name')
  })

  it('validates the new password locally and preserves both fields on backend error', async () => {
    const apis = createApis()
    apis.changePassword.mockRejectedValue(new Error('当前密码错误'))
    renderAccount(apis)
    fireEvent.click(await screen.findByRole('button', { name: '登录安全' }))
    const oldPassword = await screen.findByLabelText('当前密码')
    const newPassword = screen.getByLabelText('新密码')

    fireEvent.change(oldPassword, { target: { value: 'old-password' } })
    fireEvent.change(newPassword, { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    expect(await screen.findByText('新密码需为 8–128 位')).toBeTruthy()
    expect(apis.changePassword).not.toHaveBeenCalled()

    fireEvent.change(newPassword, { target: { value: 'new-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    expect(await screen.findByText('当前密码错误')).toBeTruthy()
    expect((oldPassword as HTMLInputElement).value).toBe('old-password')
    expect((newPassword as HTMLInputElement).value).toBe('new-password-123')
  })

  it('clears the session after changing the password and asks for login before returning', async () => {
    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '登录安全' }))
    fireEvent.change(await screen.findByLabelText('当前密码'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(screen.getByLabelText('新密码'), {
      target: { value: 'new-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/?account=login&returnTo=%2Faccount',
      ),
    )
    expect(await screen.findByRole('dialog', { name: '登录 Windup' })).toBeTruthy()
    expect(screen.getByText('密码修改成功，请重新登录')).toBeTruthy()
  })

  it('returns home immediately on logout without waiting for the remote request', async () => {
    const logout = deferred<void>()
    const apis = createApis()
    apis.logout.mockReturnValue(logout.promise)
    renderAccount(apis)

    fireEvent.click(await screen.findByRole('button', { name: '退出当前账号' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    expect(apis.logout).toHaveBeenCalledWith('rotated-refresh-token')
  })
})
