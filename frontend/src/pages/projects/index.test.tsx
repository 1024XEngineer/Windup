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

function installBackend() {
  const backend = createProjectAssetsBackend()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', backend.fetch)
  return backend
}

describe('ProjectsPage', () => {
  it('renders backend Projects as the first browsing level', async () => {
    installBackend()
    const { container } = render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '项目中心' })).toBeTruthy()
    expect(await screen.findAllByRole('link', { name: /打开项目/ })).toHaveLength(2)
    expect(screen.getByRole('link', { name: '打开项目 点灯人 · MVP' }).getAttribute('href')).toBe(
      '/projects/42/assets',
    )
    expect(screen.getByText('低饱和像素绘本')).toBeTruthy()
    expect(container.querySelectorAll('[data-project-card]')).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /查看角色/ })).toBeNull()
  })

  it('keeps creation out of this module and deletes through the Project API', async () => {
    const backend = installBackend()
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findAllByRole('link', { name: /打开项目/ })).toHaveLength(2)
    const createButton = screen.getByRole('button', { name: '新建项目' })
    expect(createButton.hasAttribute('disabled')).toBe(true)
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
      <MemoryRouter initialEntries={['/projects']}>
        <AppRoutes />
      </MemoryRouter>,
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
