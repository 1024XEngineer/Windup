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
  hasPassword: true,
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
    setPassword: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    sendPasswordChangeCode: vi.fn(async () => undefined),
    changePasswordWithCode: vi.fn(async () => undefined),
  }
}

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  )
}

function renderAccount(apis = createApis(), entry = '/account') {
  window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
  return {
    apis,
    ...render(
      <AuthSessionProvider apis={apis}>
        <MemoryRouter initialEntries={[entry]}>
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
    expect(screen.queryByLabelText('邮箱验证码')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect(screen.getByRole('heading', { name: '修改密码' })).toBeTruthy()
    const code = screen.getByLabelText('邮箱验证码')
    const newPassword = screen.getByLabelText('新密码')
    expect(code).toBeTruthy()
    expect(screen.getByText('reader@example.com')).toBeTruthy()
    expect(screen.queryByLabelText('当前密码')).toBeNull()
    expect(screen.queryByLabelText('昵称')).toBeNull()

    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.change(newPassword, { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并修改密码' }))
    expect(await screen.findByText('新密码需为 8–128 位')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '个人资料' }))
    expect(screen.getByLabelText('昵称')).toBeTruthy()
    expect(screen.queryByText('新密码需为 8–128 位')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect((screen.getByLabelText('邮箱验证码') as HTMLInputElement).value).toBe('')
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

  it('从积分账户右上角打开兑换码对话框，并在关闭后归还焦点', async () => {
    vi.spyOn(quotaApis, 'getBalance').mockResolvedValue({
      id: '11',
      userId: '7',
      balance: 90,
      frozen: 0,
      totalEarned: 100,
      totalSpent: 10,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    vi.spyOn(quotaApis, 'listTransactions').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '积分账户' }))
    const trigger = await screen.findByRole('button', { name: '填写积分兑换码' })

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '兑换积分' })
    expect(screen.getByLabelText('兑换码')).toBeTruthy()
    expect(document.activeElement).toBe(dialog)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '兑换积分' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('兑换成功后显示入账积分并刷新账户与流水', async () => {
    const initialAccount = {
      id: '11',
      userId: '7',
      balance: 90,
      frozen: 0,
      totalEarned: 100,
      totalSpent: 10,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    }
    const redeemedAccount = {
      ...initialAccount,
      balance: 1090,
      totalEarned: 1100,
      updatedAt: '2026-08-17T02:03:04Z',
    }
    const getBalance = vi
      .spyOn(quotaApis, 'getBalance')
      .mockResolvedValueOnce(initialAccount)
      .mockResolvedValue(redeemedAccount)
    const listTransactions = vi
      .spyOn(quotaApis, 'listTransactions')
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    const redeemCode = vi
      .spyOn(quotaApis, 'redeemCode')
      .mockResolvedValue({ credited: 1000, account: redeemedAccount })

    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '积分账户' }))
    fireEvent.click(await screen.findByRole('button', { name: '填写积分兑换码' }))
    fireEvent.change(screen.getByLabelText('兑换码'), {
      target: { value: '  WU-ABCD-EFGH  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认兑换' }))

    await waitFor(() => expect(redeemCode).toHaveBeenCalledWith('WU-ABCD-EFGH'))
    expect(await screen.findByText('+1,000')).toBeTruthy()
    await waitFor(() => expect(getBalance).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(listTransactions).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('1,090')).toBeTruthy()
  })

  it('兑换失败时显示后端错误并保留输入', async () => {
    vi.spyOn(quotaApis, 'getBalance').mockResolvedValue({
      id: '11',
      userId: '7',
      balance: 90,
      frozen: 0,
      totalEarned: 100,
      totalSpent: 10,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    vi.spyOn(quotaApis, 'listTransactions').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    vi.spyOn(quotaApis, 'redeemCode').mockRejectedValue(new Error('兑换码无效或已使用'))

    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '积分账户' }))
    fireEvent.click(await screen.findByRole('button', { name: '填写积分兑换码' }))
    const input = screen.getByLabelText('兑换码')
    fireEvent.change(input, { target: { value: 'WU-USED-CODE' } })
    fireEvent.click(screen.getByRole('button', { name: '确认兑换' }))

    expect((await screen.findByRole('alert')).textContent).toContain('兑换码无效或已使用')
    expect((input as HTMLInputElement).value).toBe('WU-USED-CODE')
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
      expiresAt: '2026-09-16T01:02:03Z',
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    vi.spyOn(quotaApis, 'listInviteRecords').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 5,
    })

    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '邀请奖励' }))

    expect(await screen.findByRole('heading', { name: '邀请奖励' })).toBeTruthy()
    expect(await screen.findByText('AB23CD45')).toBeTruthy()
  })

  it('通过账号中心链接直接打开邀请奖励', async () => {
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
    vi.spyOn(quotaApis, 'getInviteCode').mockResolvedValue({
      code: 'AB23CD45',
      usedCount: 2,
      expiresAt: '2026-09-16T01:02:03Z',
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    vi.spyOn(quotaApis, 'listInviteRecords').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 5,
    })

    renderAccount(createApis(), '/account?section=invite')

    expect(await screen.findByRole('heading', { name: '邀请奖励' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '邀请奖励' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('按收支、原因和本地日期筛选流水并调整分页', async () => {
    vi.spyOn(quotaApis, 'getBalance').mockResolvedValue({
      id: '11',
      userId: '7',
      balance: 90,
      frozen: 0,
      totalEarned: 100,
      totalSpent: 10,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    const listTransactions = vi
      .spyOn(quotaApis, 'listTransactions')
      .mockImplementation(async ({ page = 1, pageSize = 20 } = {}) => ({
        items: [],
        total: 80,
        page,
        pageSize,
      }))

    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '积分账户' }))
    await waitFor(() => expect(listTransactions).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('变动方向'), { target: { value: 'expense' } })
    fireEvent.change(screen.getByLabelText('变动原因'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-08-10' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-08-12' } })
    fireEvent.change(screen.getByLabelText('每页条数'), { target: { value: '50' } })
    fireEvent.submit(screen.getByRole('form', { name: '积分流水筛选' }))

    await waitFor(() =>
      expect(listTransactions).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 50,
        direction: 'expense',
        reason: 3,
        createdFrom: new Date(2026, 7, 10).toISOString(),
        createdBefore: new Date(2026, 7, 13).toISOString(),
      }),
    )
    expect(screen.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe(
      'page',
    )

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    await waitFor(() =>
      expect(listTransactions).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }),
    )
    expect((screen.getByLabelText('变动方向') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('变动原因') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('结束日期') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('每页条数') as HTMLSelectElement).value).toBe('20')

    const callsBeforeEmptyApply = listTransactions.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    await waitFor(() => expect(listTransactions).toHaveBeenCalledTimes(callsBeforeEmptyApply + 1))
    await waitFor(() =>
      expect(listTransactions).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }),
    )
  })

  it('在本地拒绝开始日期晚于结束日期的筛选', async () => {
    vi.spyOn(quotaApis, 'getBalance').mockResolvedValue({
      id: '11',
      userId: '7',
      balance: 90,
      frozen: 0,
      totalEarned: 100,
      totalSpent: 10,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    const listTransactions = vi
      .spyOn(quotaApis, 'listTransactions')
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })

    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '积分账户' }))
    await waitFor(() => expect(listTransactions).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-08-12' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-08-10' } })
    fireEvent.submit(screen.getByRole('form', { name: '积分流水筛选' }))

    expect((await screen.findByRole('alert')).textContent).toContain('开始日期不能晚于结束日期')
    expect(listTransactions).toHaveBeenCalledTimes(1)
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

  it('sends a reset code to the current account email and enforces a resend cooldown', async () => {
    const { apis } = renderAccount(createApis(), '/account?section=security')

    expect(await screen.findByRole('heading', { name: '修改密码' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))

    await waitFor(() => expect(apis.sendPasswordChangeCode).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('验证码已发送，请在 5 分钟内使用。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '60s 后重发' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('validates verification and matching passwords while preserving fields on backend error', async () => {
    const apis = createApis()
    apis.changePasswordWithCode.mockRejectedValue(new Error('验证码无效或已过期'))
    renderAccount(apis)
    fireEvent.click(await screen.findByRole('button', { name: '修改密码' }))
    const code = await screen.findByLabelText('邮箱验证码')
    const newPassword = screen.getByLabelText('新密码')
    const confirmPassword = screen.getByLabelText('确认新密码')

    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.change(newPassword, { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并修改密码' }))

    expect(await screen.findByText('新密码需为 8–128 位')).toBeTruthy()
    expect(apis.changePasswordWithCode).not.toHaveBeenCalled()

    fireEvent.change(newPassword, { target: { value: 'new-password-123' } })
    fireEvent.change(confirmPassword, { target: { value: 'different-password' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并修改密码' }))
    expect(await screen.findByText('两次输入的新密码不一致')).toBeTruthy()

    fireEvent.change(confirmPassword, { target: { value: 'new-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并修改密码' }))

    expect(await screen.findByText('验证码无效或已过期')).toBeTruthy()
    expect((code as HTMLInputElement).value).toBe('123456')
    expect((newPassword as HTMLInputElement).value).toBe('new-password-123')
    expect((confirmPassword as HTMLInputElement).value).toBe('new-password-123')
  })

  it('clears the session after an email-verified password reset and asks for login', async () => {
    renderAccount()
    fireEvent.click(await screen.findByRole('button', { name: '修改密码' }))
    fireEvent.change(await screen.findByLabelText('邮箱验证码'), {
      target: { value: '123456' },
    })
    fireEvent.change(screen.getByLabelText('新密码'), {
      target: { value: 'new-password-123' },
    })
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'new-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: '验证并修改密码' }))

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/?account=login&returnTo=%2Faccount%3Fsection%3Dsecurity',
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
