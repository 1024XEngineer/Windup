// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { HomePage } from './index'

afterEach(cleanup)

describe('HomePage', () => {
  it('提供快速开始和项目工作台两个既有入口', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /真正登场/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /快速开始/ }).getAttribute('href')).toBe('/quick-start')
    expect(screen.getByRole('link', { name: /从项目开始/ }).getAttribute('href')).toBe('/projects')
  })
})
