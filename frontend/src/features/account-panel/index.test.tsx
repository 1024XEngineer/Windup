// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

import { AppShell } from '@/app/layout'
import type { AuthTokens, UserApis } from '@/entities'
import { AuthSessionProvider } from '@/features/auth-session'
import { AccountPanel } from './index'

const user = {
  id: '7',
  email: 'reader@example.com',
  nickname: 'Reader',
  emailVerifiedAt: '2026-08-07T01:02:03Z',
  statusCode: 0,
}

function tokens(): AuthTokens {
  return { accessToken: 'access-token', refreshToken: 'refresh-token', user }
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
    updateNickname: vi.fn(async () => user),
    changePassword: vi.fn(async () => undefined),
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderPanel(entry = '/?account=login', apis = createApis()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthSessionProvider apis={apis}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {children}
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthSessionProvider>
  )

  return { apis, ...render(<AccountPanel />, { wrapper }) }
}

function fillCodeLogin(email = 'reader@example.com', code = '123456') {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('验证码'), { target: { value: code } })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('AccountPanel', () => {
  it('opens only for a supported account entry and focuses email', async () => {
    const hidden = renderPanel('/?account=profile')
    expect(screen.queryByRole('dialog')).toBeNull()
    hidden.unmount()

    renderPanel('/?account=login')

    expect(screen.getByRole('dialog', { name: '登录 Windup' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '欢迎回来。' })).toBeTruthy()
    expect(screen.queryByText('未注册的邮箱将在验证后自动创建账号。')).toBeNull()
    expect(screen.getByText('内测期间仅支持已有账号登录。')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: '注册' })).toBeNull()
    expect(screen.queryByRole('button', { name: '创建账号' })).toBeNull()
    expect(screen.getByRole('link', { name: 'GitHub Issues' }).getAttribute('href')).toBe(
      'https://github.com/1024XEngineer/Windup/issues',
    )
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('邮箱')))
  })

  it('opens a closed-registration URL as login and never starts signup', async () => {
    const { apis } = renderPanel('/?account=register&returnTo=%2Fworkspace')

    expect(screen.getByRole('dialog', { name: '登录 Windup' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '欢迎回来。' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '创建账号' })).toBeNull()
    expect(screen.queryByRole('button', { name: '继续' })).toBeNull()
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy()
    expect(screen.getByText(/内测期间暂不开放注册/)).toBeTruthy()
    expect(apis.register).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('邮箱')))
  })

  // 内测关闭公开注册。重新开放时取消 skip，并恢复 AccountPanel 的 register 入口。
  it.skip('opens registration as a centered, progressive form', async () => {
    renderPanel('/?account=register&returnTo=%2Fworkspace')

    const dialog = screen.getByRole('dialog', { name: '创建 Windup 账号' })
    expect(screen.getByRole('heading', { name: '欢迎来到 Windup' })).toBeTruthy()
    expect(dialog.className).toContain('max-w-[34rem]')
    expect(screen.getByText('从一个角色开始，')).toBeTruthy()
    expect(screen.queryByText('继续搭建，')).toBeNull()
    expect(screen.getByTestId('register-fields').className).toContain('auth-register-fields')
    expect(screen.queryByRole('tablist', { name: '账号操作' })).toBeNull()
    expect(screen.getByLabelText('邮箱')).toBeTruthy()
    expect(screen.queryByLabelText('密码')).toBeNull()
    expect(screen.queryByLabelText('昵称（选填）')).toBeNull()
    expect(screen.queryByLabelText('验证码')).toBeNull()
    expect(screen.getByTestId('register-fields').querySelector('[aria-live]')).toBeNull()
    expect(screen.getByRole('button', { name: '继续' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('邮箱')))
  })

  it('keeps the close control inside the dialog focus boundary', () => {
    renderPanel('/?account=login')

    const dialog = screen.getByRole('dialog', { name: '登录 Windup' })
    expect(dialog.contains(screen.getByRole('button', { name: '关闭账号面板' }))).toBe(true)
  })

  it('closes on Escape without discarding unrelated query state', async () => {
    renderPanel('/?account=login&returnTo=%2Fprojects&source=header')

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('location').textContent).toBe('/?returnTo=%2Fprojects&source=header')
  })

  it('keeps keyboard focus inside the dialog in both tab directions', () => {
    renderPanel('/?account=login')

    const dialog = screen.getByRole('dialog', { name: '登录 Windup' })
    const closeButton = screen.getByRole('button', { name: '关闭账号面板' })
    const requestAccess = screen.getByRole('link', { name: 'GitHub Issues' })

    requestAccess.focus()
    fireEvent.keyDown(requestAccess, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)

    closeButton.focus()
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(requestAccess)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('lets rotating copy leave before replacing it with the next message', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { container } = renderPanel('/?account=login')
    const copy = () => container.querySelector<HTMLElement>('[data-copy-phase]')

    expect(copy()?.dataset.copyPhase).toBe('entering')
    await act(async () => vi.advanceTimersByTimeAsync(760))
    expect(copy()?.dataset.copyPhase).toBe('resting')

    await act(async () => vi.advanceTimersByTimeAsync(3_440))
    expect(copy()?.dataset.copyPhase).toBe('exiting')
    expect(screen.getByText('继续搭建，')).toBeTruthy()

    await act(async () => vi.advanceTimersByTimeAsync(460))
    expect(copy()?.dataset.copyPhase).toBe('entering')
    expect(screen.getByText('你的角色还在这里，')).toBeTruthy()
  })

  it('sends login codes and keeps the cooldown with the receiving email', async () => {
    const { apis } = renderPanel()
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'reader@example.com' },
    })

    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    await waitFor(() =>
      expect(apis.sendCode).toHaveBeenCalledWith({
        email: 'reader@example.com',
        purpose: 'login',
      }),
    )
    expect(screen.getByRole('button', { name: '60s' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
    expect(screen.getByRole('button', { name: '发送验证码' }).hasAttribute('disabled')).toBe(false)
  })

  it('re-enables code delivery after its cooldown expires', async () => {
    vi.useFakeTimers()
    renderPanel()
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'reader@example.com' },
    })

    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    await act(async () => Promise.resolve())
    expect(screen.getByRole('button', { name: '60s' }).hasAttribute('disabled')).toBe(true)

    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(screen.getByRole('button', { name: '发送验证码' }).hasAttribute('disabled')).toBe(false)
  })

  it('reports invalid email and delivery failures without advancing', async () => {
    const apis = createApis()
    apis.sendCode.mockRejectedValueOnce(new Error('邮件服务暂时不可用'))
    renderPanel('/?account=login', apis)

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'invalid' } })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    expect((await screen.findByRole('alert')).textContent).toContain('请输入有效邮箱地址')
    expect(apis.sendCode).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'reader@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    expect((await screen.findByRole('alert')).textContent).toContain('邮件服务暂时不可用')
    expect(screen.getByRole('button', { name: '发送验证码' }).hasAttribute('disabled')).toBe(false)
  })

  it('validates a numeric six-character code before submitting', async () => {
    const { apis } = renderPanel()
    fillCodeLogin('reader@example.com', '12ab56')

    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)

    expect((await screen.findByRole('alert')).textContent).toContain('验证码需为 6 位数字')
    expect(apis.loginByCode).not.toHaveBeenCalled()
  })

  it('shows backend errors inline, preserves input, and prevents repeat submits', async () => {
    const pending = deferred<AuthTokens>()
    const apis = createApis()
    apis.loginByCode.mockReturnValue(pending.promise)
    renderPanel('/?account=login', apis)
    fillCodeLogin()
    const form = screen.getByRole('button', { name: '登录' }).closest('form')!

    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(apis.loginByCode).toHaveBeenCalledTimes(1)

    await act(async () => pending.reject(new Error('验证码已过期')))

    expect((await screen.findByRole('alert')).textContent).toContain('验证码已过期')
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('reader@example.com')
    expect((screen.getByLabelText('验证码') as HTMLInputElement).value).toBe('123456')
    expect(screen.getByRole('button', { name: '登录' }).hasAttribute('disabled')).toBe(false)
  })

  it('uses the approved conditional copy before a safe return navigation', async () => {
    vi.useFakeTimers()
    const { apis } = renderPanel('/?account=login&returnTo=%2Fprojects%3Fview%3Drecent')
    fillCodeLogin()

    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
    await act(async () => Promise.resolve())

    expect(apis.loginByCode).toHaveBeenCalledWith({
      email: 'reader@example.com',
      code: '123456',
    })
    expect(screen.getByText('登录成功，正在继续。').textContent).toContain('登录成功，正在继续。')

    await act(async () => vi.advanceTimersByTimeAsync(900))
    expect(screen.getByTestId('location').textContent).toBe('/projects?view=recent')
  })

  it('completes safe return navigation under the production StrictMode lifecycle', async () => {
    vi.useFakeTimers()
    const apis = createApis()
    render(
      <StrictMode>
        <AuthSessionProvider apis={apis}>
          <MemoryRouter initialEntries={['/?account=login&returnTo=%2Fprojects']}>
            <AccountPanel />
            <LocationProbe />
          </MemoryRouter>
        </AuthSessionProvider>
      </StrictMode>,
    )
    fillCodeLogin()

    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
    await act(async () => Promise.resolve())

    expect(screen.getByText(/登录成功/)).toBeTruthy()
    await act(async () => vi.advanceTimersByTimeAsync(900))
    expect(screen.getByTestId('location').textContent).toBe('/projects')
  })

  it('does not navigate after the panel closes while a submission is pending', async () => {
    vi.useFakeTimers()
    const pending = deferred<AuthTokens>()
    const apis = createApis()
    apis.loginByCode.mockReturnValue(pending.promise)
    renderPanel('/?account=login&returnTo=%2Fprojects', apis)
    fillCodeLogin()

    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => vi.advanceTimersByTimeAsync(520))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('location').textContent).toBe('/?returnTo=%2Fprojects')

    await act(async () => pending.resolve(tokens()))
    await act(async () => vi.advanceTimersByTimeAsync(900))

    expect(screen.getByTestId('location').textContent).toBe('/?returnTo=%2Fprojects')
  })

  it('falls back to the home page when returnTo is unsafe', async () => {
    vi.useFakeTimers()
    renderPanel('/?account=login&returnTo=%2F%2Fevil.example')
    fillCodeLogin()

    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
    await act(async () => Promise.resolve())
    await act(async () => vi.advanceTimersByTimeAsync(900))

    expect(screen.getByTestId('location').textContent).toBe('/')
  })

  it('submits password login without an email code and keeps recovery visibly unavailable', async () => {
    const { apis } = renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: '密码登录' }))
    expect(screen.queryByLabelText('验证码')).toBeNull()
    expect(screen.queryByRole('button', { name: '发送验证码' })).toBeNull()

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'reader@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password-123' } })

    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
    await waitFor(() =>
      expect(apis.login).toHaveBeenCalledWith({
        email: 'reader@example.com',
        password: 'password-123',
      }),
    )
    expect(apis.sendCode).not.toHaveBeenCalled()
  })

  it('does not expose a signup switch from the login panel', async () => {
    vi.useFakeTimers()
    renderPanel('/?account=login&returnTo=%2Fworkspace')

    expect(screen.queryByRole('button', { name: '创建账号' })).toBeNull()
    expect(screen.getByTestId('location').textContent).toBe('/?account=login&returnTo=%2Fworkspace')

    await act(async () => vi.advanceTimersByTimeAsync(520))
    expect(screen.getByRole('dialog', { name: '登录 Windup' })).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe('/?account=login&returnTo=%2Fworkspace')
  })

  it.skip('preserves registration input when showing a password and returning a step', async () => {
    renderPanel('/?account=register')
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
    fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)

    const password = await screen.findByLabelText('密码')
    expect(password.getAttribute('type')).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))
    expect(password.getAttribute('type')).toBe('text')

    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }))
    expect(((await screen.findByLabelText('邮箱')) as HTMLInputElement).value).toBe(
      'new@example.com',
    )
    expect(screen.getByTestId('auth-motion-stage').dataset.motionDirection).toBe('backward')
  })

  it.skip('switches account entry only after the current panel exits', async () => {
    vi.useFakeTimers()
    renderPanel('/?account=login&returnTo=%2Fworkspace')

    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))
    expect(screen.getByRole('dialog', { name: '登录 Windup' })).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe('/?account=login&returnTo=%2Fworkspace')

    await act(async () => vi.advanceTimersByTimeAsync(520))
    expect(screen.getByRole('dialog', { name: '创建 Windup 账号' })).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe(
      '/?account=register&returnTo=%2Fworkspace',
    )
  })

  it.skip('validates each registration step and reuses the existing register API contract', async () => {
    const { apis } = renderPanel('/?account=register&returnTo=%2Fworkspace')
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })

    fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
    expect(screen.getByRole('dialog', { name: '创建 Windup 账号' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '为账号加一道保护' })).toBeTruthy()
    expect(await screen.findByLabelText('密码')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'short' } })

    fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toContain('密码需为 8–128 位')
    expect(apis.register).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password-123' } })
    fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
    expect(screen.getByRole('dialog', { name: '创建 Windup 账号' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '留下你的称呼' })).toBeTruthy()
    expect(await screen.findByLabelText('昵称（选填）')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('昵称（选填）'), {
      target: { value: 'N'.repeat(51) },
    })

    fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toContain('昵称不能超过 50 个字符')

    fireEvent.change(screen.getByLabelText('昵称（选填）'), { target: { value: '新用户' } })
    fireEvent.submit(screen.getByRole('button', { name: '继续' }).closest('form')!)
    await waitFor(() =>
      expect(apis.sendCode).toHaveBeenCalledWith({
        email: 'new@example.com',
        purpose: 'register',
      }),
    )
    expect(screen.getByRole('dialog', { name: '创建 Windup 账号' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '确认你的邮箱' })).toBeTruthy()
    expect(await screen.findByLabelText('验证码')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.submit(screen.getByRole('button', { name: '创建账号' }).closest('form')!)
    await waitFor(() =>
      expect(apis.register).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password-123',
        code: '123456',
        nickname: '新用户',
      }),
    )
  })
})

describe('AppShell account panel host', () => {
  it('does not require an auth context while the panel is closed', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AccountPanel />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the query-driven dialog over shell content', () => {
    const apis = createApis()
    render(
      <AuthSessionProvider apis={apis}>
        <MemoryRouter initialEntries={['/?account=login']}>
          <AppShell>
            <p>当前页面</p>
          </AppShell>
        </MemoryRouter>
      </AuthSessionProvider>,
    )

    expect(screen.getByText('当前页面')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '登录 Windup' })).toBeTruthy()
  })
})
