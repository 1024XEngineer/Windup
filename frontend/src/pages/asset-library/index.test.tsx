// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'

afterEach(cleanup)

describe('AssetLibraryPage', () => {
  it('按角色成卡并保留项目级新建与导出入口', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/project-ember/assets']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '角色' })).toBeTruthy()
    expect(await screen.findAllByRole('link', { name: /查看角色/ })).toHaveLength(3)
    expect(screen.getByText('轻装信使')).toBeTruthy()
    expect(screen.getByText('暗色游侠')).toBeTruthy()
    expect(screen.getByText('待定角色')).toBeTruthy()
    expect(screen.getByText('母版未定稿')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建角色' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出全部角色资产' })).toBeTruthy()
  })

  it('空项目说明资产归属并提供新建角色入口', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/project-empty/assets']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByText('这个项目还没有角色')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '新建角色' })).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /查看角色/ })).toBeNull()
  })

  it('资产库一级只展示原始角色资产，不预设穿戴和动作模板分类', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/project-ember/assets']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '角色' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '资产分类' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '角色3' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('link', { name: /穿戴/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /动作模板/ })).toBeNull()
  })
})
