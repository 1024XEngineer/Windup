// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'

afterEach(cleanup)

describe('ProjectDetailPage', () => {
  it('直接访问角色子路由时仍保留项目名称与四项约束', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/project-ember/assets/character-mist']}>
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
    expect(screen.getByRole('navigation', { name: '资产分类' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /角色/ }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回资产库' }).getAttribute('href')).toBe(
      '/projects/project-ember/assets',
    )
  })
})
