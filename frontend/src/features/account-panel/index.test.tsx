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
  vi.useRealTimers()
})

describe('AccountPanel', () => {
  it('opens only for the exact account=login query and focuses the email field', async () => {
    const hidden = renderPanel('/?account=register')
    expect(screen.queryByRole('dialog')).toBeNull()
    hidden.unmount()

    renderPanel('/?account=login')

    expect(screen.getByRole('dialog', { name: '登录 Windup' })).toBeTruthy()
    expect(screen.getByText('未注册的邮箱将在验证后自动创建账号。')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('邮箱')))
  })

  it('closes on Escape without discarding unrelated query state', async () => {
    renderPanel('/?account=login&returnTo=%2Fprojects&source=header')

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('location').textContent).toBe('/?returnTo=%2Fprojects&source=header')
  })

  it('sends login codes and keeps the cooldown with the receiving email across modes', async () => {
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
    expect(screen.getByRole('button', { name: '60 秒后重发' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('tab', { name: '注册' }))
    expect(screen.getByRole('button', { name: '60 秒后重发' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
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
    expect(
      screen.getByText('登录成功。如果这是你首次使用该邮箱，我们已为你创建账号。').textContent,
    ).toContain('登录成功。如果这是你首次使用该邮箱，我们已为你创建账号。')

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
    expect(screen.getByText('忘记密码')).toBeTruthy()
    expect(screen.getByText('暂未开放')).toBeTruthy()
    expect(screen.queryByLabelText('验证码')).toBeNull()
    expect(screen.queryByRole('button', { name: '发送验证码' })).toBeNull()
    expect(screen.getByText('用邮箱和密码直接登录。')).toBeTruthy()

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

  it('validates registration fields and sends register-purpose codes', async () => {
    const { apis } = renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: '注册' }))
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('昵称（选填）'), {
      target: { value: 'N'.repeat(51) },
    })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } })

    fireEvent.submit(screen.getByRole('button', { name: '创建账号' }).closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toContain('密码需为 8–128 位')
    expect(apis.register).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password-123' } })
    fireEvent.submit(screen.getByRole('button', { name: '创建账号' }).closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toContain('昵称不能超过 50 个字符')

    fireEvent.change(screen.getByLabelText('昵称（选填）'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    await waitFor(() =>
      expect(apis.sendCode).toHaveBeenCalledWith({
        email: 'new@example.com',
        purpose: 'register',
      }),
    )
    fireEvent.submit(screen.getByRole('button', { name: '创建账号' }).closest('form')!)
    await waitFor(() =>
      expect(apis.register).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password-123',
        code: '123456',
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
