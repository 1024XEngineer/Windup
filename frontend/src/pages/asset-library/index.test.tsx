// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function renderRoute(route: string) {
  const backend = createProjectAssetsBackend()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', backend.fetch)
  return render(
    <AuthenticatedAuthSession>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthenticatedAuthSession>,
  )
}

describe('AssetLibraryPage', () => {
  it('hides draft characters from the published asset list', async () => {
    renderRoute('/projects/42/assets')

    expect(await screen.findByRole('heading', { name: '角色' })).toBeTruthy()
    expect(await screen.findAllByRole('link', { name: /查看角色/ })).toHaveLength(1)
    expect(screen.getByText('轻装信使')).toBeTruthy()
    expect(screen.queryByText('待定角色')).toBeNull()
    expect(screen.queryByText('暂无造型预览')).toBeNull()
    const preview = screen.getByRole('img', { name: '轻装信使的常态造型预览' })
    expect(preview.getAttribute('loading')).toBe('eager')
    expect(preview.getAttribute('decoding')).toBe('async')
    expect(preview.getAttribute('fetchpriority')).toBe('high')
    expect(screen.getAllByText('1 套造型')).toHaveLength(1)
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

  it('requests each published Character page from the backend', async () => {
    const backend = createProjectAssetsBackend({ characterCount: 26 })
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects/42/assets']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findAllByRole('link', { name: /查看角色/ })).toHaveLength(24)
    const requestsBeforePaging = backend.requests.filter((request) =>
      request.url.includes('/characters?project_id=42'),
    ).length
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /查看角色/ })).toHaveLength(1)
    })
    const characterRequests = backend.requests.filter((request) =>
      request.url.includes('/characters?project_id=42'),
    )
    expect(characterRequests).toHaveLength(requestsBeforePaging + 1)
    expect(characterRequests.at(-1)?.url).toContain('page=2&page_size=24&status=1')
  })
})
