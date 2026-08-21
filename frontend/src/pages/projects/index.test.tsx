// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'
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
  it('loads a project card thumbnail and falls back to its original preview', async () => {
    const backend = createProjectAssetsBackend()
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const response = await backend.fetch(input, init)
      if (new URL(request.url).pathname !== '/projects') return response

      const payload = (await response.json()) as {
        data: Array<{ preview_url: string | null }>
      }
      payload.data[0]!.preview_url =
        'https://cdn.windup.test/media/outfit-preview/messenger.source.png'
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      })
    })

    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    const preview = await screen.findByRole('img', { name: '点灯人 · MVP的项目预览' })
    // findByRole 只等到 img 挂上，不等 src 落定：缩略图地址要等角色请求回来后的那次状态
    // 更新才写进去。裸断言在 CI 这类慢环境上会取到写入前的值，随机把无关 PR 染红。
    await waitFor(() => {
      expect(preview.getAttribute('src')).toBe(
        'https://cdn.windup.test/media/outfit-preview/messenger.card.webp',
      )
    })

    fireEvent.error(preview)

    await waitFor(
      () => {
        expect(preview.getAttribute('src')).toBe(
          'https://cdn.windup.test/media/outfit-preview/messenger.source.png',
        )
      },
      { timeout: 5_000 },
    )
  })

  it('keeps the loading surface until the preview image is decoded', async () => {
    installBackend()
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    const project = await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })
    const preview = await screen.findByRole('img', { name: '点灯人 · MVP的项目预览' })
    expect(screen.getByRole('status', { name: '正在装载点灯人 · MVP的项目预览' })).toBeTruthy()
    expect(project.querySelector('[aria-busy="true"]')).toBeTruthy()

    fireEvent.load(preview)

    expect(screen.queryByRole('status', { name: '正在装载点灯人 · MVP的项目预览' })).toBeNull()
    expect(project.querySelector('[aria-busy="false"]')).toBeTruthy()
  })

  it('shows an image error when a resolved preview cannot be displayed', async () => {
    installBackend()
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    const project = await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })
    const preview = await screen.findByRole('img', { name: '点灯人 · MVP的项目预览' })
    fireEvent.error(preview)

    expect(await screen.findByText('预览图片无法显示')).toBeTruthy()
    expect(within(project).queryByText('等待第一份角色资产')).toBeNull()
  })

  it('renders backend Projects as the first browsing level', async () => {
    const backend = installBackend()
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter initialEntries={['/projects']}>
          <AppRoutes />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    const pageTitle = await screen.findByRole('heading', { name: '项目中心', level: 1 })
    expect(pageTitle.classList.contains('sr-only')).toBe(true)
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
    expect(previewProject.textContent).toContain('横版视角 · 四向')
    expect(previewProject.textContent).toContain('64 × 64 px')
    expect(previewProject.textContent).toContain('低饱和像素绘本')
    expect(screen.queryByText('项目名称')).toBeNull()
    expect(screen.queryByRole('link', { name: /查看角色/ })).toBeNull()
    const gallery = screen.getByRole('heading', { name: '最近项目 · 02' }).closest('section')
    expect(gallery).toBeTruthy()
    expect(within(gallery as HTMLElement).queryByRole('link', { name: '新建项目' })).toBeNull()
    // 预览改由列表响应带回后，这个页面不再打 /characters；放宽成白名单会让瀑布悄悄回来。
    expect(backend.requests.every((request) => new URL(request.url).pathname === '/projects')).toBe(
      true,
    )
    expect(
      backend.requests.filter((request) => new URL(request.url).pathname === '/projects'),
    ).toHaveLength(1)
    expect(
      backend.requests.filter((request) => new URL(request.url).pathname === '/characters'),
    ).toHaveLength(0)
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

  it('uses project previews and keeps missing previews in the empty state', async () => {
    const backend = createProjectAssetsBackend({ projectCount: 3 })
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)
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
      ).toBe('https://cdn.windup.test/messenger-outfit.png')
      expect(
        screen
          .getByRole('link', { name: '打开项目 空白海岸' })
          .querySelector('img')
          ?.getAttribute('src'),
      ).toBeUndefined()
      expect(screen.getAllByText('等待第一份角色资产')).toHaveLength(1)
    })
    expect(
      backend.requests.filter((request) => new URL(request.url).pathname === '/characters'),
    ).toHaveLength(0)
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
