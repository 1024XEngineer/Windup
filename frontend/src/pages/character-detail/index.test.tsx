// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'
import { AuthenticatedAuthSession } from '@/test/auth-session'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function renderCharacter(characterId: string) {
  const backend = createProjectAssetsBackend()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', backend.fetch)
  return render(
    <AuthenticatedAuthSession>
      <MemoryRouter initialEntries={[`/projects/42/assets/${characterId}`]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthenticatedAuthSession>,
  )
}

describe('CharacterDetailPage', () => {
  it('uses the first ordered Frame as the Action preview', async () => {
    renderCharacter('51')

    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '选择造型' })).toBeNull()
    expect(screen.getAllByRole('article', { name: /动作/ })).toHaveLength(2)
    expect(screen.getByRole('img', { name: '呼吸待机帧预览' }).getAttribute('src')).toBe(
      'https://cdn.windup.test/idle-01.png',
    )
    expect(screen.getByRole('img', { name: '行走帧预览' }).getAttribute('src')).toBe(
      'https://cdn.windup.test/walk-01.png',
    )
    const master = screen.getByRole('img', { name: '轻装信使的常态造型预览' })
    expect(master.getAttribute('loading')).toBe('eager')
    expect(master.getAttribute('decoding')).toBe('async')
    expect(master.getAttribute('fetchpriority')).toBe('high')
    for (const preview of [
      screen.getByRole('img', { name: '呼吸待机帧预览' }),
      screen.getByRole('img', { name: '行走帧预览' }),
    ]) {
      expect(preview.getAttribute('loading')).toBe('lazy')
      expect(preview.getAttribute('decoding')).toBe('async')
    }
    expect(screen.queryByText('GIF')).toBeNull()
    expect(screen.queryByRole('button', { name: '增加动作' })).toBeNull()
    const exportEntry = screen.getByRole('button', { name: '导出资产包' })
    expect(exportEntry.className).toContain('rounded-full')
    expect(screen.queryByText('当前阶段')).toBeNull()
    expect(screen.queryByRole('dialog', { name: '导出资产包' })).toBeNull()
    expect(screen.queryByText('导出能力待 PR #97 合并并完成资产字段接线')).toBeNull()
    expect(screen.getByRole('link', { name: '在预览台打开当前造型' }).getAttribute('href')).toBe(
      '/playtest/51/outfit-default',
    )
  })

  it('expands an Action into backend Frames sorted by index', async () => {
    renderCharacter('51')

    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开行走' }))

    const sequence = screen.getByRole('region', { name: '行走完整帧序列' })
    const frames = within(sequence).getAllByRole('img')
    expect(frames.map((frame) => frame.getAttribute('src'))).toEqual([
      'https://cdn.windup.test/walk-01.png',
      'https://cdn.windup.test/walk-02.png',
      'https://cdn.windup.test/walk-03.png',
    ])
    expect(within(sequence).queryByRole('button', { name: '保存为动作模板' })).toBeNull()
    expect(screen.queryByText('动作模板后端未提供')).toBeNull()
    const scroller = sequence.querySelector('.overflow-x-auto')
    expect(scroller).toBeTruthy()
    expect(scroller?.querySelector('ol')?.className).toContain('min-w-max')
  })

  it('preserves the Outfit level when no Action exists', async () => {
    renderCharacter('52')

    expect(await screen.findByRole('heading', { name: '待定角色' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '选择造型' })).toBeNull()
    expect(screen.getByText('这个造型还没有动作')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '在预览台打开当前造型' })).toBeNull()
  })

  it('renders a real empty state when the Character has no Outfit', async () => {
    const backend = createProjectAssetsBackend()
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const response = await backend.fetch(input, init)
      if (!request.url.endsWith('/characters/51')) return response

      const payload = (await response.json()) as {
        data: { character_data: { outfits: unknown[] } }
        [key: string]: unknown
      }
      payload.data.character_data.outfits = []
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      })
    })

    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects/42/assets/51']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByText('这个角色还没有造型')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '导出资产包' })).toBeNull()
    expect(screen.queryByRole('link', { name: '在预览台打开当前造型' })).toBeNull()
  })
})
