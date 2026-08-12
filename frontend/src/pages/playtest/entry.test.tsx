// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '@/app'
import { AuthenticatedAuthSession } from '@/test/auth-session'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function renderEntryWith(fetchFn: typeof globalThis.fetch) {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', fetchFn)

  return render(
    <AuthenticatedAuthSession>
      <MemoryRouter initialEntries={['/playtest']}>
        <AppRoutes />
      </MemoryRouter>
    </AuthenticatedAuthSession>,
  )
}

function renderEntry(characterCount = 2) {
  return renderEntryWith(createProjectAssetsBackend({ characterCount }).fetch)
}

describe('PlaytestEntryPage', () => {
  it('links playable outfits to their concrete Playtest route', async () => {
    renderEntry()

    expect(await screen.findByRole('heading', { name: '选择可试玩资产' })).toBeTruthy()
    expect(screen.getByTestId('playtest-pixel-stage').getAttribute('aria-hidden')).toBe('true')
    expect(
      (await screen.findByRole('link', { name: '试玩 轻装信使 · 常态造型' })).getAttribute('href'),
    ).toBe('/playtest/51/outfit-default')
    expect(screen.getByText('2 个动作 · 5 帧')).toBeTruthy()
    expect(screen.getByText('尚无可播放帧')).toBeTruthy()
  })

  it('directs an empty account back to character creation', async () => {
    renderEntry(0)

    expect(await screen.findByText('还没有可试玩的角色')).toBeTruthy()
    expect(screen.getByRole('link', { name: '开始创作' }).getAttribute('href')).toBe('/quick-start')
    expect(screen.getByRole('link', { name: '查看项目资产' }).getAttribute('href')).toBe(
      '/projects',
    )
  })

  it('keeps a failed asset request distinct from an empty account', async () => {
    renderEntryWith(() => Promise.reject(new TypeError('network unavailable')))

    expect(await screen.findByText('可试玩资产暂时无法读取')).toBeTruthy()
    expect(screen.queryByText('还没有可试玩的角色')).toBeNull()
  })

  it('loads every project and character page before presenting the asset count', async () => {
    const backend = createProjectAssetsBackend({ projectCount: 101, characterCount: 101 })
    renderEntryWith(backend.fetch)

    expect(await screen.findByText('101 套造型已接入')).toBeTruthy()
    expect(
      backend.requests.some((request) => {
        const url = new URL(request.url)
        return url.pathname === '/projects' && url.searchParams.get('page') === '2'
      }),
    ).toBe(true)
    expect(
      backend.requests.some((request) => {
        const url = new URL(request.url)
        return (
          url.pathname === '/characters' &&
          url.searchParams.get('project_id') === '42' &&
          url.searchParams.get('page') === '2'
        )
      }),
    ).toBe(true)
  })
})
