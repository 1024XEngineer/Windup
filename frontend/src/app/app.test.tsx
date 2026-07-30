// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './app'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('App', () => {
  it('将项目完成版本的入口路由到历史记录', () => {
    window.history.replaceState({}, '', '/projects/project-1/history')

    render(<App />)

    expect(screen.getByRole('heading', { name: '历史记录' })).toBeTruthy()
  })
})
