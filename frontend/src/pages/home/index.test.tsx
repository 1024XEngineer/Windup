// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { WorkspaceHomePage } from './index'

afterEach(cleanup)

describe('WorkspaceHomePage', () => {
  it('按交互形态提供快速开始与工作流画布两个入口', () => {
    render(
      <MemoryRouter>
        <WorkspaceHomePage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /真正登场/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /快速开始/ }).getAttribute('href')).toBe('/quick-start')
    expect(screen.getByText('工作流画布')).toBeTruthy()
    expect(screen.getByRole('link', { name: '创建新项目' }).getAttribute('href')).toBe(
      '/projects/new',
    )
    expect(screen.getByRole('link', { name: '继续已有项目' }).getAttribute('href')).toBe(
      '/projects',
    )
    expect(screen.getByTestId('home-brand-bird').tagName).toBe('CANVAS')
  })
})
