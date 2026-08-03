// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppHeader } from './app-header'

afterEach(cleanup)

describe('AppHeader', () => {
  it('保留产品入口，并将工作流路由归入创作', () => {
    render(
      <MemoryRouter initialEntries={['/workflow-editor/run-1']}>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '返回 Windup 首页' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: '项目' }).getAttribute('href')).toBe('/projects')
    expect(screen.getByRole('link', { name: '创作' }).getAttribute('aria-current')).toBe('page')
  })

  it('在 Playtest 中随页面滚动，其余页面继续悬浮', () => {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/playtest/25/outfit-25-default']}>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(container.querySelector('header')?.className.split(' ')).toContain('relative')
    expect(container.querySelector('header')?.className.split(' ')).not.toContain('fixed')
    unmount()

    const projects = render(
      <MemoryRouter initialEntries={['/projects']}>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(projects.container.querySelector('header')?.className.split(' ')).toContain('fixed')
  })

  it('将 Playtest 标记为独立核验工作区', () => {
    render(
      <MemoryRouter initialEntries={['/playtest/25/outfit-25-default']}>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(screen.getByText('动作预览与质量核验')).toBeTruthy()
    expect(screen.queryByText('项目与历史记录')).toBeNull()
  })
})
