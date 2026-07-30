// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppHeader } from './app-header'

afterEach(cleanup)

describe('AppHeader', () => {
  it('保留三个产品入口，并将工作流路由归入创作', () => {
    render(
      <MemoryRouter initialEntries={['/workflow-editor/run-1']}>
        <AppHeader />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '返回 Windup 首页' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: '项目资产' }).getAttribute('href')).toBe('/projects')
    expect(screen.getByRole('link', { name: '创作' }).getAttribute('aria-current')).toBe('page')
  })
})
