// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '@/app'
import { AuthenticatedAuthSession } from '@/test/auth-session'

import { rememberRecentPreview, type RecentPreview } from './recent-previews'

vi.mock('./recent-previews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./recent-previews')>()
  return { ...actual, getRecentPreviewOwnerId: () => '7' }
})

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function renderEntry() {
  const fetch = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal('fetch', fetch)
  render(
    <AuthenticatedAuthSession>
      <MemoryRouter initialEntries={['/playtest']}>
        <AppRoutes />
      </MemoryRouter>
    </AuthenticatedAuthSession>,
  )
  return fetch
}

function preview(index: number): RecentPreview {
  return {
    characterId: String(50 + index),
    outfitId: `outfit-${index}`,
    characterName: `角色 ${index}`,
    outfitName: `造型 ${index}`,
    projectId: '42',
    projectName: '点灯人 · MVP',
    previewUrl: null,
    lastOpenedAt: index,
  }
}

describe('PlaytestEntryPage', () => {
  it('does not call project or character APIs and points new users to the asset library', async () => {
    const fetch = renderEntry()

    const pageTitle = await screen.findByRole('heading', { name: '预览台', level: 1 })
    expect(pageTitle.classList.contains('sr-only')).toBe(true)
    expect(screen.getByText('还没有最近预览')).toBeTruthy()
    expect(screen.getByRole('link', { name: '从项目资产中选择' }).getAttribute('href')).toBe(
      '/projects',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows at most three recent previews', async () => {
    for (let index = 0; index < 5; index += 1) {
      rememberRecentPreview('7', preview(index), window.localStorage)
    }

    renderEntry()

    expect(await screen.findByRole('heading', { name: '最近预览 · 03', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '预览台', level: 1 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '角色 4 · 造型 4' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /继续预览/ })).toHaveLength(3)
    expect(screen.queryByText('角色 1')).toBeNull()
    expect(screen.getByRole('link', { name: '从项目资产中选择' }).getAttribute('href')).toBe(
      '/projects',
    )
    const recentSection = screen.getByRole('heading', { name: '最近预览 · 03' }).closest('section')
    expect(recentSection).toBeTruthy()
    expect(
      within(recentSection as HTMLElement).queryByRole('link', { name: '从项目资产中选择' }),
    ).toBeNull()
  })

  it('keeps the recent preview link on the existing parameterized workbench route', async () => {
    rememberRecentPreview('7', preview(1), window.localStorage)

    renderEntry()

    expect(
      (await screen.findByRole('link', { name: '继续预览 角色 1 · 造型 1' })).getAttribute('href'),
    ).toBe('/playtest/51/outfit-1')
  })

  it('renders a real preview image and falls back for an unnamed character', async () => {
    rememberRecentPreview(
      '7',
      { ...preview(1), characterName: '', previewUrl: 'https://cdn.windup.test/outfit-1.png' },
      window.localStorage,
    )
    rememberRecentPreview(
      '7',
      { ...preview(2), previewUrl: 'https://cdn.windup.test/outfit-2.png' },
      window.localStorage,
    )

    renderEntry()

    const newestPreview = await screen.findByRole('img', { name: '角色 2 · 造型 2预览图' })
    const olderPreview = screen.getByRole('img', { name: '未命名角色 · 造型 1预览图' })

    expect(newestPreview.getAttribute('loading')).toBe('eager')
    expect(newestPreview.getAttribute('fetchpriority')).toBe('high')
    expect(olderPreview.getAttribute('src')).toBe('https://cdn.windup.test/outfit-1.png')
    expect(olderPreview.getAttribute('loading')).toBe('lazy')
    expect(olderPreview.getAttribute('fetchpriority')).toBe('auto')
  })
})
