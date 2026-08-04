// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'

afterEach(cleanup)

describe('CharacterDetailPage', () => {
  it('造型并入角色标题区，动作以带动画预览的堆叠卡片展示', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/project-ember/assets/character-mist']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '选择造型' })).toBeTruthy()
    expect(screen.queryByRole('tablist', { name: '角色造型' })).toBeNull()
    expect(screen.getAllByRole('article', { name: /动作/ })).toHaveLength(2)
    expect(screen.getByRole('button', { name: '展开呼吸待机' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开行走' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '呼吸待机动画预览' }).getAttribute('src')).toContain(
      '.gif',
    )
    expect(screen.getByRole('img', { name: '行走动画预览' }).getAttribute('src')).toContain('.gif')
    expect(screen.queryByRole('region', { name: /完整帧序列/ })).toBeNull()
    expect(screen.getByRole('button', { name: '加动作' })).toBeTruthy()
    expect(screen.queryByText('红色围巾')).toBeNull()
    expect(screen.queryByRole('button', { name: '复用穿戴' })).toBeNull()
    expect(screen.queryByRole('button', { name: '提取穿戴' })).toBeNull()
    expect(screen.queryByText(/复用模板/)).toBeNull()
  })

  it('把选中的角色动作保存为供工作流节点读取的动作模板', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/project-ember/assets/character-mist']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '轻装信使' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开行走' }))
    expect(screen.getByText('轻装信使 / 常态造型 / 行走')).toBeTruthy()
    expect(screen.getByRole('region', { name: '行走完整帧序列' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '资产提取' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '保存为动作模板' }))
    expect(screen.getByRole('status').textContent).toContain('行走')
    expect(screen.getByRole('status').textContent).toContain('动作模板')
    expect(screen.getByRole('link', { name: /动作模板/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加动作' }))
    expect(screen.getByRole('dialog', { name: '生成新动作' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '从动作模板复用' })).toBeNull()
  })

  it('只有母版的角色保留造型层与无动作入口', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/project-ember/assets/character-draft']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '待定角色' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '选择造型' })).toBeTruthy()
    expect(screen.getByText('这个造型还没有动作')).toBeTruthy()
    expect(screen.getByRole('button', { name: '加动作' })).toBeTruthy()
  })
})
