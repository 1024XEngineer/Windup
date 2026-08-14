// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

    expect(await screen.findByRole('heading', { name: '预览台' })).toBeTruthy()
    expect(screen.queryByTestId('playtest-pixel-stage')).toBeNull()
    expect(
      (await screen.findByRole('link', { name: '预览 轻装信使 · 常态造型' })).getAttribute('href'),
    ).toBe('/playtest/51/outfit-default')
    expect(screen.getAllByText('点灯人 · MVP').length).toBeGreaterThan(0)
    expect(screen.getByText('呼吸待机 · 行走')).toBeTruthy()
    expect(screen.getByText('2 个动作 · 5 帧')).toBeTruthy()
    expect(screen.getByText('尚无可播放帧')).toBeTruthy()
  })

  it('filters the global outfit gallery by project without starting a second picker flow', async () => {
    renderEntry()

    expect(await screen.findByRole('button', { name: '筛选项目 空白海岸' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '筛选项目 空白海岸' }))

    expect(screen.queryByRole('link', { name: '预览 轻装信使 · 常态造型' })).toBeNull()
    expect(screen.getByText('这个项目还没有可预览造型')).toBeTruthy()
    expect(screen.getByRole('button', { name: '筛选全部项目' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('directs an empty account back to character creation', async () => {
    renderEntry(0)

    expect(await screen.findByText('还没有可预览的角色')).toBeTruthy()
    const createLink = screen.getByRole('link', { name: '开始创作' })
    expect(createLink.getAttribute('href')).toBe('/quick-start')
    expect(createLink.getAttribute('data-ui')).toBe('editorial-entry-card')
    expect(createLink.querySelector('img')?.getAttribute('src')).toContain('playtest.png')
    expect(screen.getByRole('link', { name: '查看项目资产' }).getAttribute('href')).toBe(
      '/projects',
    )
  })

  it('keeps a failed asset request distinct from an empty account', async () => {
    renderEntryWith(() => Promise.reject(new TypeError('network unavailable')))

    expect(await screen.findByText('可预览资产暂时无法读取')).toBeTruthy()
    expect(screen.queryByText('还没有可预览的角色')).toBeNull()
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
