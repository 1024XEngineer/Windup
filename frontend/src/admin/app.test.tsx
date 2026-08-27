// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import type { AdminApis, AdminUser } from './api'
import { AdminApiError } from './api'
import { AdminAppRoutes } from './app'
import { AdminSessionProvider } from './session'

const admin: AdminUser = {
  id: 7,
  email: 'owner@windup.xin',
  permissions: ['audit.read', 'gateway.read'],
}

function renderApp(apis: AdminApis) {
  return render(
    <AdminSessionProvider apis={apis}>
      <MemoryRouter>
        <AdminAppRoutes />
      </MemoryRouter>
    </AdminSessionProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('shows a dedicated admin login and enters the console after authentication', async () => {
  const apis: AdminApis = {
    me: vi.fn(async () => {
      throw new AdminApiError('管理员未登录', 401)
    }),
    refresh: vi.fn(async () => {
      throw new AdminApiError('refresh token 无效', 401)
    }),
    login: vi.fn(async () => admin),
    logout: vi.fn(async () => undefined),
  }
  renderApp(apis)

  const email = await screen.findByRole('textbox', { name: '管理员邮箱' })
  fireEvent.change(email, { target: { value: 'owner@windup.xin' } })
  fireEvent.change(screen.getByLabelText('管理员密码'), {
    target: { value: 'strong-password-2026' },
  })
  fireEvent.click(screen.getByRole('button', { name: '进入管理台' }))

  expect(await screen.findByRole('heading', { name: '运行总览' })).toBeTruthy()
  expect(screen.getByText('owner@windup.xin')).toBeTruthy()
})

it('labels not-yet-migrated modules honestly instead of rendering mock data', async () => {
  const apis: AdminApis = {
    me: vi.fn(async () => admin),
    refresh: vi.fn(async () => admin),
    login: vi.fn(async () => admin),
    logout: vi.fn(async () => undefined),
  }
  renderApp(apis)

  expect(await screen.findByRole('heading', { name: '运行总览' })).toBeTruthy()
  expect(screen.getAllByText('待迁移').length).toBeGreaterThan(0)
  expect(screen.queryByText(/模拟|示例数据/)).toBeNull()
  expect(screen.getByRole('navigation', { name: '管理平台导航' })).toBeTruthy()
})
