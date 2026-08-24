// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    const assetActions = screen.getByRole('group', { name: '角色资产操作' })
    const exportEntry = within(assetActions).getByRole('button', { name: '导出资产包' })
    expect(exportEntry.className).toContain('rounded-full')
    const pixelPerfectEntry = within(assetActions).getByRole('button', { name: '完美像素化' })
    const playtestEntry = within(assetActions).getByRole('link', {
      name: '在预览台打开当前造型',
    })
    for (const action of [exportEntry, pixelPerfectEntry, playtestEntry]) {
      expect(action.querySelector('svg')).toBeTruthy()
      expect(action.className).toContain('min-h-10')
      expect(action.className).toContain('rounded-full')
    }
    expect(screen.queryByRole('button', { name: '完美像素画' })).toBeNull()
    expect(screen.queryByText('当前阶段')).toBeNull()
    expect(screen.queryByRole('heading', { name: '动作与帧' })).toBeNull()
    expect(screen.getByRole('region', { name: '角色动作' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '导出资产包' })).toBeNull()
    expect(screen.queryByText('导出能力待 PR #97 合并并完成资产字段接线')).toBeNull()
    expect(playtestEntry.getAttribute('href')).toBe('/playtest/51/outfit-default')
    expect(playtestEntry.parentElement?.className).toContain('items-center')
  })

  it('routes both add-action choices to the character existing WorkflowRun', async () => {
    const create = vi.spyOn(workflowRunApis, 'create')
    renderCharacter('51')
    await screen.findByRole('heading', { name: '轻装信使' })

    fireEvent.click(screen.getByRole('button', { name: '增加动作' }))

    expect(screen.getByRole('dialog', { name: '选择动作创建方式' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '使用 Quick Start' }).getAttribute('href')).toBe(
      '/quick-start/501?intent=add-action&outfitId=outfit-default',
    )
    expect(screen.getByRole('link', { name: '使用 Workflow Editor' }).getAttribute('href')).toBe(
      '/workflow-editor/501',
    )
    expect(create).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '关闭动作创建方式' }))
    expect(screen.queryByRole('dialog', { name: '选择动作创建方式' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '增加动作' }))
    const dialog = screen.getByRole('dialog', { name: '选择动作创建方式' })
    fireEvent.mouseDown(dialog.parentElement!)
    expect(screen.queryByRole('dialog', { name: '选择动作创建方式' })).toBeNull()
  })

  it('expands an Action into backend Frames sorted by index', async () => {
    renderCharacter('51')

    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开行走' }))

    const sequence = screen.getByRole('region', { name: '行走完整帧序列' })
    const expandedCard = screen.getByRole('article', { name: '动作 行走' })
    expect(expandedCard.contains(sequence)).toBe(true)
    const frames = within(sequence).getAllByRole('img')
    expect(frames.map((frame) => frame.getAttribute('src'))).toEqual([
      'https://cdn.windup.test/walk-01.png',
      'https://cdn.windup.test/walk-02.png',
      'https://cdn.windup.test/walk-03.png',
    ])
    expect(within(sequence).queryByRole('button', { name: '保存为动作模板' })).toBeNull()
    expect(screen.queryByText('动作模板后端未提供')).toBeNull()
    const scroller = sequence.querySelector('.overflow-y-auto')
    expect(scroller).toBeTruthy()
    expect(scroller?.className).not.toContain('overflow-x-auto')
    expect(scroller?.querySelector('ol')?.className).toContain('auto-fill')
  })

  it('keeps the frame panel mounted while the selected card collapses', async () => {
    renderCharacter('51')

    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开行走' }))
    const card = screen.getByRole('article', { name: '动作 行走' })
    expect(card.querySelector('[aria-label="行走完整帧序列"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '收起行走' }))

    const exitingPanel = card.querySelector('[aria-label="行走完整帧序列"]')
    expect(exitingPanel).toBeTruthy()
    expect(exitingPanel?.getAttribute('aria-hidden')).toBe('true')
    expect(exitingPanel?.className).toContain('h-0')
  })

  it('allows adding an action when the character has directional templates without an outfit preview', async () => {
    const backend = createProjectAssetsBackend()
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const response = await backend.fetch(input, init)
      if (!request.url.endsWith('/characters/52')) return response

      const payload = (await response.json()) as {
        data: { character_data: { templates?: unknown[] } }
        [key: string]: unknown
      }
      payload.data.character_data.templates = [
        {
          direction: 'east',
          source_direction: null,
          mirror_x: false,
          image_url: 'https://cdn.windup.test/draft-east.png',
        },
      ]
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      })
    })

    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects/42/assets/52']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByRole('heading', { name: '待定角色' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '增加动作' }).hasAttribute('disabled')).toBe(false)
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
    expect(screen.queryByRole('button', { name: '完美像素化' })).toBeNull()
    expect(screen.queryByRole('link', { name: '在预览台打开当前造型' })).toBeNull()
  })
})
