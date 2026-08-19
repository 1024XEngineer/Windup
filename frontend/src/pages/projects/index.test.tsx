// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'
import { characterApis } from '@/entities'
import { AuthenticatedAuthSession } from '@/test/auth-session'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
    const emptyProject = screen.getByRole('link', { name: '打开项目 空白海岸' })
    await waitFor(() => {
      expect(previewProject.querySelector('img')?.getAttribute('src')).toBe(
        'https://cdn.windup.test/messenger-outfit.png',
      )
      expect(emptyProject.querySelector('img')).toBeNull()
      expect(emptyProject.textContent).toContain('等待第一份角色资产')
    })
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
        return query.get('page') === '1' && query.get('page_size') === '6'
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

  it('keeps the project and shows why delete is blocked when characters remain', async () => {
    installBackend()
    const { ProjectHasCharactersError, projectApis } = await import('@/entities')
    vi.spyOn(projectApis, 'remove').mockRejectedValue(new ProjectHasCharactersError())
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除项目 点灯人 · MVP' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除项目' }))

    expect(await screen.findByText('项目下仍有角色，无法删除')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '删除项目' })).toBeNull()
    expect(screen.getByRole('link', { name: '打开项目 点灯人 · MVP' })).toBeTruthy()
  })

  it('falls back through character preview sources without blocking the gallery', async () => {
    const backend = createProjectAssetsBackend({ projectCount: 3 })
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)
    const character = await characterApis.get('51')
    vi.spyOn(characterApis, 'listByProject').mockImplementation(async (projectId) => {
      if (Number(projectId) === 1002) throw new Error('preview unavailable')
      const emptyCharacter = {
        ...character,
        referenceImageUrl: null,
        outfits: character.outfits.map((outfit) => ({
          ...outfit,
          previewUrl: null,
          actions: outfit.actions.map((action) => ({ ...action, frames: [] })),
        })),
      }
      return {
        items: [
          emptyCharacter,
          {
            ...character,
            referenceImageUrl: Number(projectId) === 42 ? character.referenceImageUrl : null,
            outfits: character.outfits.map((outfit) => ({ ...outfit, previewUrl: null })),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 6,
      }
    })
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect(await screen.findAllByRole('link', { name: /打开项目/ })).toHaveLength(3)
    await waitFor(() => {
      expect(
        screen
          .getByRole('link', { name: '打开项目 点灯人 · MVP' })
          .querySelector('img')
          ?.getAttribute('src'),
      ).toBe('https://cdn.windup.test/messenger-reference.png')
      expect(
        screen
          .getByRole('link', { name: '打开项目 空白海岸' })
          .querySelector('img')
          ?.getAttribute('src'),
      ).toBe('https://cdn.windup.test/idle-01.png')
      expect(screen.getByText('等待第一份角色资产')).toBeTruthy()
    })
  })

  it('limits preview request concurrency', async () => {
    const backend = createProjectAssetsBackend({ projectCount: 5 })
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)
    let activeRequests = 0
    let maxActiveRequests = 0
    let releaseRequests: (() => void) | undefined
    const requestGate = new Promise<void>((resolve) => {
      releaseRequests = resolve
    })
    const listSpy = vi.spyOn(characterApis, 'listByProject').mockImplementation(async () => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await requestGate
      activeRequests -= 1
      return { items: [], total: 0, page: 1, pageSize: 6 }
    })
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2))
    expect(maxActiveRequests).toBe(2)
    releaseRequests?.()
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(5))
    expect(maxActiveRequests).toBe(2)
    expect(listSpy.mock.calls.every(([, query]) => query?.page === 1 && query.pageSize === 6)).toBe(
      true,
    )
  })

  it('shares concurrency across pages, deduplicates active requests, and reuses cached previews', async () => {
    const backend = createProjectAssetsBackend({ projectCount: 13 })
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)
    let activeRequests = 0
    let maxActiveRequests = 0
    let releaseRequests: (() => void) | undefined
    const requestGate = new Promise<void>((resolve) => {
      releaseRequests = resolve
    })
    const listSpy = vi.spyOn(characterApis, 'listByProject').mockImplementation(async () => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await requestGate
      activeRequests -= 1
      return { items: [], total: 0, page: 1, pageSize: 6 }
    })
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /打开项目/ })).toHaveLength(1)
    })
    expect(listSpy).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /打开项目/ })).toHaveLength(12)
    })
    expect(listSpy).toHaveBeenCalledTimes(2)
    expect(new Set(listSpy.mock.calls.map(([projectId]) => projectId)).size).toBe(2)

    releaseRequests?.()
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(12))
    expect(maxActiveRequests).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(13))
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /打开项目/ })).toHaveLength(12)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listSpy).toHaveBeenCalledTimes(13)
    expect(maxActiveRequests).toBe(2)
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
