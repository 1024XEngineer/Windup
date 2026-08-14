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
    expect(screen.getByRole('combobox', { name: '选择造型' })).toBeTruthy()
    expect(screen.getAllByRole('article', { name: /动作/ })).toHaveLength(3)
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
    expect(screen.getByRole('button', { name: '增加动作' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '导出游戏资产包' }).hasAttribute('disabled')).toBe(
      false,
    )
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
    expect(
      within(sequence).getByRole('button', { name: '保存为动作模板' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByText('动作模板后端未提供')).toBeTruthy()
  })

  it('preserves the Outfit level when no Action exists', async () => {
    renderCharacter('52')

    expect(await screen.findByRole('heading', { name: '待定角色' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '选择造型' })).toBeTruthy()
    expect(screen.getByText('这个造型还没有动作')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '在预览台打开当前造型' })).toBeNull()
  })
})
