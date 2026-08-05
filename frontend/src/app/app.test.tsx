// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './app'

const user = {
  id: 7,
  email: 'ada@example.test',
  nickname: 'Ada',
  emailVerifiedAt: null,
  status: 'normal' as const,
}

const userApis = {
  sendCode: vi.fn(async () => undefined),
  register: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh', user })),
  login: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh', user })),
  loginByCode: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh', user })),
  refresh: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh', user })),
  logout: vi.fn(async () => undefined),
  me: vi.fn(async () => user),
  changePassword: vi.fn(async () => undefined),
}

vi.mock('@/entities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities')>()
  return { ...actual, createUserApis: vi.fn(() => userApis) }
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  vi.unstubAllEnvs()
})

function authenticate() {
  vi.stubEnv('VITE_AUTH_MODE', 'backend')
  window.localStorage.setItem('windup.auth.refresh-token', 'refresh')
}

describe('App', () => {
  it('provides the authentication session required by the home page', async () => {
    window.history.replaceState({}, '', '/')

    render(<App />)

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      '让你的角色，真正登场。',
    )
  })

  it('allows a guest to render the home page', async () => {
    render(<App />)

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      '让你的角色，真正登场。',
    )
  })

  it('redirects a guest quick-start visit to login', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'backend')
    window.history.replaceState({}, '', '/quick-start')

    render(<App />)

    await screen.findByRole('dialog', { name: '账户认证' })
    expect(window.location.search).toBe('?account=login&returnTo=%2Fquick-start')
  })

  it('keeps the new-project route ahead of the dynamic project detail route', async () => {
    window.history.replaceState({}, '', '/projects/new')
    authenticate()

    render(<App />)

    expect(await screen.findByRole('heading', { name: '新建项目' })).toBeTruthy()
  })

  it('将项目完成版本的入口路由到历史记录', async () => {
    window.history.replaceState({}, '', '/projects/project-1/history')
    authenticate()

    render(<App />)

    expect(await screen.findByRole('heading', { name: '历史记录' })).toBeTruthy()
  })

  it('keeps the asset library separate from workflow history', async () => {
    window.history.replaceState({}, '', '/projects/project-1/assets')
    authenticate()

    render(<App />)

    expect(await screen.findByText('正在读取项目…')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '历史记录' })).toBeNull()
  })

  it('provides a dedicated Playtest entry', async () => {
    window.history.replaceState({}, '', '/playtest')
    authenticate()

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Playtest' })).toBeTruthy()
  })
})
