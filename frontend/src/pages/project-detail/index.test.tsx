// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('ProjectDetailPage', () => {
  it('keeps the Project workspace around a directly opened Character', async () => {
    const backend = createProjectAssetsBackend()
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', backend.fetch)

    const { container } = render(
      <MemoryRouter initialEntries={['/projects/42/assets/51']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '点灯人 · MVP' })).toBeTruthy()
    expect(screen.getByText('横版视角')).toBeTruthy()
    expect(screen.getByText('四向')).toBeTruthy()
    expect(screen.getByText('64 × 64')).toBeTruthy()
    expect(screen.getByText('低饱和像素绘本')).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回项目中心' }).getAttribute('href')).toBe(
      '/projects',
    )
    expect(screen.getByRole('link', { name: /角色/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '动作模板' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('穿戴')).toBeNull()
    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
    expect(container.querySelector('[data-route-transition="/projects/42/assets/51"]')).toBeTruthy()
  })
})
