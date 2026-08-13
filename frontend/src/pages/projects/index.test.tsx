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

function installBackend() {
  const backend = createProjectAssetsBackend()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', backend.fetch)
  return backend
}

describe('ProjectsPage', () => {
  it('renders backend Projects as the first browsing level', async () => {
    const backend = installBackend()
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByRole('heading', { name: '项目中心' })).toBeTruthy()
    const createLink = await screen.findByRole('link', { name: '新建项目' })
    const artwork = createLink.querySelector('img')
    expect(artwork).toBeTruthy()
    if (!artwork) throw new Error('新建项目入口缺少资产装饰图')
    expect(artwork.getAttribute('src')).toContain('asset-library.png')
    expect(artwork.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByText('新的资产空间')).toBeNull()
    expect(screen.queryByText('按最近更新排列')).toBeNull()
    expect(screen.getAllByRole('link', { name: '新建项目' })).toHaveLength(1)
    expect(createLink.getAttribute('href')).toBe('/projects/new')
    expect(await screen.findAllByRole('link', { name: /打开项目/ })).toHaveLength(2)
    const previewProject = screen.getByRole('link', { name: '打开项目 点灯人 · MVP' })
    expect(previewProject.getAttribute('href')).toBe('/projects/42/assets')
    expect(screen.getByRole('heading', { name: '最近项目 · 02' })).toBeTruthy()
    expect(previewProject.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.windup.test/messenger-outfit.png',
    )
    const emptyProject = screen.getByRole('link', { name: '打开项目 空白海岸' })
    expect(emptyProject.querySelector('img')).toBeNull()
    expect(emptyProject.textContent).toContain('等待第一份角色资产')
    expect(previewProject.textContent).toContain('08/04')
    expect(screen.queryByText('项目名称')).toBeNull()
    expect(screen.queryByText('视角 / 朝向')).toBeNull()
    expect(screen.queryByRole('link', { name: /查看角色/ })).toBeNull()
    expect(
      backend.requests.every((request) =>
        ['/projects', '/characters'].includes(new URL(request.url).pathname),
      ),
    ).toBe(true)
    expect(
      backend.requests.filter((request) => new URL(request.url).pathname === '/projects'),
    ).toHaveLength(1)
    const previewRequests = backend.requests.filter(
      (request) => new URL(request.url).pathname === '/characters',
    )
    expect(previewRequests).toHaveLength(2)
    expect(
      previewRequests.map((request) => new URL(request.url).searchParams.get('project_id')),
    ).toEqual(['42', '99'])
    expect(
      previewRequests.every((request) => {
        const query = new URL(request.url).searchParams
        return query.get('page') === '1' && query.get('page_size') === '1'
      }),
    ).toBe(true)
  })

  it('sends creation to the project create page and deletes through the Project API', async () => {
    const backend = installBackend()
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findAllByRole('link', { name: /打开项目/ })).toHaveLength(2)
    expect(screen.getByRole('link', { name: '新建项目' }).getAttribute('href')).toBe(
      '/projects/new',
    )
    expect(screen.queryByRole('dialog', { name: '新建项目' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '删除项目 空白海岸' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除项目' }))

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: '打开项目 空白海岸' })).toBeNull()
    })
    expect(
      backend.requests.some(
        (request) => request.method === 'DELETE' && request.url.endsWith('/projects/99'),
      ),
    ).toBe(true)
  })

  it('navigates every backend Project page instead of truncating after the first page', async () => {
    const backend = createProjectAssetsBackend({ projectCount: 13 })
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findAllByRole('link', { name: /打开项目/ })).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /打开项目/ })).toHaveLength(1)
    })
    expect(
      backend.requests.some((request) => request.url.includes('/projects?page=2&page_size=12')),
    ).toBe(true)
  })
})
