// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { HomePage } from './index'

afterEach(cleanup)

describe('HomePage', () => {
  it('提供快速开始、新建项目和项目历史两个明确入口', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /真正登场/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /快速开始/ }).getAttribute('href')).toBe('/quick-start')
    expect(screen.getByRole('link', { name: /新建项目/ }).getAttribute('href')).toBe(
      '/workflow-editor',
    )
    expect(screen.getByRole('link', { name: '查看项目历史' }).getAttribute('href')).toBe(
      '/projects',
    )
  })
})
