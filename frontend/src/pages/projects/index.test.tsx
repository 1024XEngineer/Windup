// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'

afterEach(cleanup)

describe('ProjectsPage', () => {
  it('先以项目为浏览粒度，再从整张项目卡进入该项目的资产库', async () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '项目中心' })).toBeTruthy()
    expect(await screen.findAllByRole('link', { name: /打开项目/ })).toHaveLength(2)
    expect(screen.getByRole('link', { name: '打开项目 点灯人 · MVP' }).getAttribute('href')).toBe(
      '/projects/project-ember/assets',
    )
    expect(screen.queryByRole('link', { name: /查看角色/ })).toBeNull()
    expect(screen.getAllByText(/个角色/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/更新于/).length).toBeGreaterThan(0)
  })

  it('支持搜索、新建和删除项目的本地演示闭环', async () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findAllByRole('link', { name: /打开项目/ })).toHaveLength(2)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), {
      target: { value: '海岸' },
    })
    expect(screen.getAllByRole('link', { name: /打开项目/ })).toHaveLength(1)
    expect(screen.getByText('空白海岸')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    expect(screen.getByRole('dialog', { name: '新建项目' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), {
      target: { value: '夜航测试' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    expect(screen.getByRole('link', { name: '打开项目 夜航测试' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '删除项目 夜航测试' }))
    expect(screen.getByRole('dialog', { name: '删除项目' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认删除项目' }))
    expect(screen.queryByRole('link', { name: '打开项目 夜航测试' })).toBeNull()
  })
})
