// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'

import type { AuthSessionValue } from '@/features/auth-session'
import { useAuthSession } from '@/features/auth-session'
import { AccountPanel } from './account-panel'

vi.mock('@/features/auth-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth-session')>()
  return { ...actual, useAuthSession: vi.fn() }
})

const mockedUseAuthSession = vi.mocked(useAuthSession)

function createSession(
  state: AuthSessionValue['state'] = { status: 'guest', user: null },
): AuthSessionValue {
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

function renderPanel(initialEntry = '/?account=login', onClose = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AccountPanel onClose={onClose} />
      <LocationProbe />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv('VITE_AUTH_MODE', 'backend')
  mockedUseAuthSession.mockReset()
  mockedUseAuthSession.mockReturnValue(createSession())
})

describe('AccountPanel', () => {
  it('本地模式预填开发账户，一次点击即可进入工作台', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'local')
    const session = createSession()
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel('/?account=login&returnTo=%2Fquick-start')

    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('local@windup.dev')
    fireEvent.click(screen.getByRole('button', { name: '进入本地工作台' }))

    await waitFor(() =>
      expect(session.loginByCode).toHaveBeenCalledWith({
        email: 'local@windup.dev',
        code: 'local',
      }),
    )
    await waitFor(() => expect(screen.getByLabelText('当前路径').textContent).toBe('/quick-start'))
  })

  it('发送登录验证码并用验证码登录后恢复安全站内目标', async () => {
    const session = createSession()
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel('/?account=login&returnTo=%2Fprojects%3Fpage%3D2')

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'ada@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))

    await waitFor(() =>
      expect(session.sendCode).toHaveBeenCalledWith({
        email: 'ada@example.test',
        purpose: 'login',
      }),
    )
    expect(
      (screen.getByRole('button', { name: '60 秒后可重发' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '使用验证码登录' }))

    await waitFor(() =>
      expect(session.loginByCode).toHaveBeenCalledWith({
        email: 'ada@example.test',
        code: '123456',
      }),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('当前路径').textContent).toBe('/projects?page=2'),
    )
  })

  it('密码登录也提交验证码，且拒绝跳转到协议相对地址', async () => {
    const session = createSession()
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel('/?account=login&returnTo=%2F%2Fevil.example')

    fireEvent.click(screen.getByRole('button', { name: '密码登录' }))
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'ada@example.test' },
    })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: '使用密码登录' }))

    await waitFor(() =>
      expect(session.login).toHaveBeenCalledWith({
        email: 'ada@example.test',
        password: 'password123',
        code: '654321',
      }),
    )
    await waitFor(() => expect(screen.getByLabelText('当前路径').textContent).toBe('/'))
  })

  it('拒绝包含反斜杠的 returnTo，避免浏览器将其规范化为外站', async () => {
    const session = createSession()
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel('/?account=login&returnTo=%2F%5Cevil.example')

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'ada@example.test' },
    })
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '使用验证码登录' }))

    await waitFor(() => expect(screen.getByLabelText('当前路径').textContent).toBe('/'))
  })

  it('密码与验证码登录按钮暴露当前选中状态', () => {
    renderPanel()

    expect(screen.getByRole('button', { name: '验证码登录' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: '密码登录' }).getAttribute('aria-pressed')).toBe(
      'false',
    )

    fireEvent.click(screen.getByRole('button', { name: '密码登录' }))
    expect(screen.getByRole('button', { name: '验证码登录' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(screen.getByRole('button', { name: '密码登录' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('非法邮箱不能绕过原生约束发送验证码', () => {
    const session = createSession()
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel()

    const emailInput = screen.getByLabelText('邮箱') as HTMLInputElement
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } })
    expect(emailInput.checkValidity()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))

    expect(session.sendCode).not.toHaveBeenCalled()
  })

  it('使用 register purpose 发码并提交可选昵称完成注册', async () => {
    const session = createSession()
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel('/?account=register')

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'new@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    await waitFor(() =>
      expect(session.sendCode).toHaveBeenCalledWith({
        email: 'new@example.test',
        purpose: 'register',
      }),
    )

    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '112233' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('昵称（可选）'), { target: { value: '  新用户  ' } })
    fireEvent.click(screen.getByRole('button', { name: '创建账户' }))

    await waitFor(() =>
      expect(session.register).toHaveBeenCalledWith({
        email: 'new@example.test',
        password: 'password123',
        code: '112233',
        nickname: '新用户',
      }),
    )
  })

  it('只读展示账户资料，不提供头像、昵称或邮箱编辑与删号入口', () => {
    const session = createSession({
      status: 'authenticated',
      user: {
        id: 7,
        email: 'ada@example.test',
        nickname: 'Ada',
        emailVerifiedAt: null,
        status: 'banned',
      },
    })
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel('/?account=settings')

    expect(screen.getByRole('heading', { name: '个人设置' })).toBeTruthy()
    expect(screen.getByText('ada@example.test')).toBeTruthy()
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByText('未验证')).toBeTruthy()
    expect(screen.getByText('已封禁')).toBeTruthy()
    expect(screen.queryByLabelText('邮箱')).toBeNull()
    expect(screen.queryByLabelText('昵称')).toBeNull()
    expect(screen.queryByText(/头像|删除账户|OAuth|第三方登录/)).toBeNull()
  })

  it('修改密码成功后提示重新登录并返回登录模式', async () => {
    const session = createSession({
      status: 'authenticated',
      user: {
        id: 7,
        email: 'ada@example.test',
        nickname: 'Ada',
        emailVerifiedAt: '2026-08-05T00:00:00Z',
        status: 'normal',
      },
    })
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel('/?account=settings')

    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    await waitFor(() =>
      expect(session.changePassword).toHaveBeenCalledWith({
        oldPassword: 'old-password',
        newPassword: 'new-password',
      }),
    )
    expect(await screen.findByText('密码已修改，请重新登录')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '登录 Windup' })).toBeTruthy()
  })

  it('退出登录，并将请求错误通过 alert 呈现', async () => {
    const session = createSession({
      status: 'authenticated',
      user: {
        id: 7,
        email: 'ada@example.test',
        nickname: 'Ada',
        emailVerifiedAt: '2026-08-05T00:00:00Z',
        status: 'normal',
      },
    })
    session.logout = vi.fn(async () => {
      throw new Error('退出服务暂不可用')
    })
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel('/?account=settings')

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    expect((await screen.findByRole('alert')).textContent).toContain('退出服务暂不可用')
  })

  it('退出登录成功后关闭面板', async () => {
    const session = createSession({
      status: 'authenticated',
      user: {
        id: 7,
        email: 'ada@example.test',
        nickname: 'Ada',
        emailVerifiedAt: '2026-08-05T00:00:00Z',
        status: 'normal',
      },
    })
    const onClose = vi.fn()
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel('/?account=settings', onClose)

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('验证码倒计时逐秒推进，并在 60 秒后恢复发码', async () => {
    vi.useFakeTimers()
    const session = createSession()
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel()
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'ada@example.test' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: '60 秒后可重发' })).toBeTruthy()

    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByRole('button', { name: '59 秒后可重发' })).toBeTruthy()
    for (let second = 0; second < 59; second += 1) {
      act(() => vi.advanceTimersByTime(1_000))
    }

    expect((screen.getByRole('button', { name: '发送验证码' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('面板卸载时清理尚未结束的倒计时', async () => {
    vi.useFakeTimers()
    const session = createSession()
    mockedUseAuthSession.mockReturnValue(session)
    const view = renderPanel()
    const timersBeforeCountdown = vi.getTimerCount()
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'ada@example.test' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
      await Promise.resolve()
    })
    expect(vi.getTimerCount()).toBeGreaterThan(timersBeforeCountdown)
    view.unmount()

    expect(vi.getTimerCount()).toBe(timersBeforeCountdown)
  })

  it('请求处理中禁用提交，避免重复提交', async () => {
    let resolveLogin: (() => void) | undefined
    const session = createSession()
    session.loginByCode = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<AuthSessionValue['loginByCode']>>>((resolve) => {
          resolveLogin = () =>
            resolve({
              accessToken: 'access',
              refreshToken: 'refresh',
              user: {
                id: 7,
                email: 'ada@example.test',
                nickname: 'Ada',
                emailVerifiedAt: null,
                status: 'normal',
              },
            })
        }),
    )
    mockedUseAuthSession.mockReturnValue(session)
    renderPanel()
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '使用验证码登录' }))

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '正在登录…' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    )
    resolveLogin?.()
  })
})
