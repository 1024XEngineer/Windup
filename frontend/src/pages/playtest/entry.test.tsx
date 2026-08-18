// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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

    expect(await screen.findByRole('heading', { name: '预览台' })).toBeTruthy()
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

    expect(await screen.findByRole('heading', { name: '角色 4 · 造型 4' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /继续预览/ })).toHaveLength(3)
    expect(screen.queryByText('角色 1')).toBeNull()
    expect(screen.getByRole('link', { name: '从项目资产中选择' }).getAttribute('href')).toBe(
      '/projects',
    )
  })

  it('keeps the recent preview link on the existing parameterized workbench route', async () => {
    rememberRecentPreview('7', preview(1), window.localStorage)

    renderEntry()

    expect(
      (await screen.findByRole('link', { name: '继续预览 角色 1 · 造型 1' })).getAttribute('href'),
    ).toBe('/playtest/51/outfit-1')
  })
})
