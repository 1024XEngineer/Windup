// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const characterApisFactory = vi.hoisted(() =>
  vi.fn(() => ({
    get: vi.fn(() => new Promise<never>(() => undefined)),
    listByProject: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  })),
)
const projectApisFactory = vi.hoisted(() =>
  vi.fn(() => ({
    get: vi.fn(() => new Promise<never>(() => undefined)),
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
    create: vi.fn(),
  })),
)
const userApisFactory = vi.hoisted(() => vi.fn())
const mediaApisFactory = vi.hoisted(() =>
  vi.fn(() => ({
    upload: vi.fn(),
  })),
)

vi.mock('@/entities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities')>()
  return {
    ...actual,
    createCharacterApis: characterApisFactory,
    createProjectApis: projectApisFactory,
    createMediaApis: mediaApisFactory,
    createUserApis: userApisFactory,
  }
})

import { App } from './app'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('App Playtest composition', () => {
  it('uses local authentication by default without creating the backend auth adapter', async () => {
    window.history.replaceState({}, '', '/')

    render(<App />)

    expect(userApisFactory).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: '登录 / 注册' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('让你的角色，真正登场。')
  })

  it('opens the account panel for local authentication', async () => {
    window.history.replaceState({}, '', '/?account=login&returnTo=%2Fprojects')

    render(<App />)

    expect(await screen.findByRole('dialog', { name: '账户认证' })).toBeTruthy()
  })

  it('creates one shared Character and Project API instance for Playtest routes', () => {
    window.history.replaceState({}, '', '/playtest/25/outfit-25-default')

    render(<App />)

    expect(characterApisFactory).toHaveBeenCalledTimes(1)
    expect(projectApisFactory).toHaveBeenCalledTimes(1)
  })

  it('creates one shared Media API instance for both character-creation entries', () => {
    render(<App />)

    expect(mediaApisFactory).toHaveBeenCalledTimes(1)
  })
})
