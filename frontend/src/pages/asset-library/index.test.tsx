// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function renderRoute(route: string) {
  const backend = createProjectAssetsBackend()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', backend.fetch)
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('AssetLibraryPage', () => {
  it('renders only backend Character assets and their nested counts', async () => {
    renderRoute('/projects/42/assets')

    expect(await screen.findByRole('heading', { name: '角色' })).toBeTruthy()
    expect(await screen.findAllByRole('link', { name: /查看角色/ })).toHaveLength(2)
    expect(screen.getByText('轻装信使')).toBeTruthy()
    expect(screen.getByText('待定角色')).toBeTruthy()
    expect(screen.getByText('暂无造型预览')).toBeTruthy()
    expect(screen.getAllByText('1 套造型')).toHaveLength(2)
    expect(screen.getByText('2 个动作')).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '导出全部角色资产' })).toBeNull()
  })

  it('renders the real empty state without creating a local Character', async () => {
    renderRoute('/projects/99/assets')

    expect(await screen.findByText('这个项目还没有角色')).toBeTruthy()
    const createButton = screen.getByRole('button', { name: '新建角色' })
    expect(createButton.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('link', { name: /查看角色/ })).toBeNull()
  })

  it('navigates every backend Character page instead of truncating after the first page', async () => {
    const backend = createProjectAssetsBackend({ characterCount: 25 })
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)
    render(
      <MemoryRouter initialEntries={['/projects/42/assets']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findAllByRole('link', { name: /查看角色/ })).toHaveLength(24)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /查看角色/ })).toHaveLength(1)
    })
    expect(
      backend.requests.some((request) =>
        request.url.includes('/characters?project_id=42&page=2&page_size=24'),
      ),
    ).toBe(true)
  })
})
