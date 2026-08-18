// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'
import { workflowRunApis } from '@/entities'
import { AuthenticatedAuthSession } from '@/test/auth-session'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
    expect(screen.getByRole('button', { name: '增加动作' }).hasAttribute('disabled')).toBe(false)
    const exportEntry = screen.getByRole('button', { name: '导出资产包' })
    expect(exportEntry.className).toContain('rounded-full')
    expect(screen.queryByText('当前阶段')).toBeNull()
    expect(screen.queryByRole('dialog', { name: '导出资产包' })).toBeNull()
    expect(screen.queryByText('导出能力待 PR #97 合并并完成资产字段接线')).toBeNull()
    const playtestEntry = screen.getByRole('link', { name: '在预览台打开当前造型' })
    expect(playtestEntry.getAttribute('href')).toBe('/playtest/51/outfit-default')
    expect(playtestEntry.parentElement?.className).toContain('items-start')
  })

  it('lets the user choose Quick Start or Workflow Editor for the selected outfit', async () => {
    renderCharacter('51')
    await screen.findByRole('heading', { name: '轻装信使' })

    fireEvent.click(screen.getByRole('button', { name: '增加动作' }))

    expect(screen.getByRole('dialog', { name: '选择动作创建方式' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '使用 Quick Start' }).getAttribute('href')).toBe(
      '/quick-start?characterId=51&outfitId=outfit-default',
    )
    expect(screen.getByRole('button', { name: '使用 Workflow Editor' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '关闭动作创建方式' }))
    expect(screen.queryByRole('dialog', { name: '选择动作创建方式' })).toBeNull()
  })

  it('keeps the chooser open and reports Workflow Editor creation failures', async () => {
    vi.spyOn(workflowRunApis, 'create').mockRejectedValue(new Error('工作流暂时不可用'))
    renderCharacter('51')
    await screen.findByRole('heading', { name: '轻装信使' })

    fireEvent.click(screen.getByRole('button', { name: '增加动作' }))
    fireEvent.click(screen.getByRole('button', { name: '使用 Workflow Editor' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '工作流暂时不可用')
    expect(screen.getByRole('dialog', { name: '选择动作创建方式' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '使用 Workflow Editor' }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it('creates an independent template-bound run before opening Workflow Editor', async () => {
    const create = vi.spyOn(workflowRunApis, 'create').mockImplementation(async (input) => ({
      id: 'new-action-run',
      projectId: input.projectId,
      version: 1,
      storageStatus: 'active',
      nodes: input.nodes,
    }))
    renderCharacter('51')
    await screen.findByRole('heading', { name: '轻装信使' })

    fireEvent.click(screen.getByRole('button', { name: '增加动作' }))
    fireEvent.click(screen.getByRole('button', { name: '使用 Workflow Editor' }))

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledWith({
      projectId: '42',
      nodes: expect.arrayContaining([
        expect.objectContaining({
          type: 'character-setup',
          status: 'passed',
          input: expect.objectContaining({ characterId: '51' }),
        }),
        expect.objectContaining({
          type: 'character-template',
          status: 'passed',
          selectedImageUrl: 'https://cdn.windup.test/messenger-outfit.png',
        }),
      ]),
    })
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
    const addAction = screen.getByRole('button', { name: '增加动作' })
    expect(addAction.hasAttribute('disabled')).toBe(true)
    expect(addAction.getAttribute('title')).toBe('当前造型缺少角色母版')
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
