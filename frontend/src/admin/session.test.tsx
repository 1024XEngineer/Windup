// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdminApis, AdminUser } from './api'
import { AdminApiError } from './api'
import { AdminSessionProvider, useAdminSession } from './session'

const admin: AdminUser = {
  id: 7,
  email: 'owner@windup.xin',
  permissions: ['audit.read', 'gateway.read'],
}

function createApis(overrides: Partial<AdminApis> = {}): AdminApis {
  return {
    login: vi.fn(async () => admin),
    me: vi.fn(async () => admin),
    refresh: vi.fn(async () => admin),
    logout: vi.fn(async () => undefined),
    ...overrides,
  }
}

function SessionProbe() {
  const session = useAdminSession()
  return (
    <div>
      <output data-testid="state">
        {session.state.status === 'authenticated'
          ? `${session.state.status}:${session.state.admin.email}`
          : session.state.status}
      </output>
      <button
        type="button"
        onClick={() => void session.login('owner@windup.xin', 'strong-password-2026')}
      >
        登录
      </button>
      <button type="button" onClick={() => void session.logout().catch(() => undefined)}>
        退出
      </button>
    </div>
  )
}

function renderSession(apis: AdminApis) {
  return render(
    <AdminSessionProvider apis={apis}>
      <SessionProbe />
    </AdminSessionProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AdminSessionProvider', () => {
  it('restores an existing cookie session without browser token storage', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const apis = createApis()
    renderSession(apis)

    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('authenticated:owner@windup.xin'),
    )
    expect(apis.me).toHaveBeenCalledTimes(1)
    expect(storageSpy).not.toHaveBeenCalled()
  })

  it('uses refresh rotation once when the access cookie has expired', async () => {
    const apis = createApis({
      me: vi.fn(async () => {
        throw new AdminApiError('管理员未登录', 401)
      }),
    })
    renderSession(apis)

    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('authenticated:owner@windup.xin'),
    )
    expect(apis.refresh).toHaveBeenCalledTimes(1)
  })

  it('deduplicates session restoration under React strict effects', async () => {
    const apis = createApis()
    render(
      <StrictMode>
        <AdminSessionProvider apis={apis}>
          <SessionProbe />
        </AdminSessionProvider>
      </StrictMode>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('authenticated:owner@windup.xin'),
    )
    expect(apis.me).toHaveBeenCalledTimes(1)
    expect(apis.refresh).not.toHaveBeenCalled()
  })

  it('moves between guest and authenticated states through real API methods', async () => {
    const apis = createApis({
      me: vi.fn(async () => {
        throw new AdminApiError('管理员未登录', 401)
      }),
      refresh: vi.fn(async () => {
        throw new AdminApiError('refresh token 无效', 401)
      }),
    })
    renderSession(apis)
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('guest'))

    await act(async () => screen.getByRole('button', { name: '登录' }).click())
    expect(screen.getByTestId('state').textContent).toBe('authenticated:owner@windup.xin')

    await act(async () => screen.getByRole('button', { name: '退出' }).click())
    expect(screen.getByTestId('state').textContent).toBe('guest')
    expect(apis.logout).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('退出请求返回 %s 时仍清理本地管理会话', async (code) => {
    const apis = createApis({
      logout: vi.fn(async () => {
        throw new AdminApiError('管理会话已失效', code)
      }),
    })
    renderSession(apis)
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('authenticated:owner@windup.xin'),
    )

    await act(async () => screen.getByRole('button', { name: '退出' }).click())

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('guest'))
  })
})
