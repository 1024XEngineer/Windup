// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './app'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('App', () => {
  it('keeps the new-project route ahead of the dynamic project detail route', () => {
    window.history.replaceState({}, '', '/projects/new')

    render(<App />)

    expect(screen.getByRole('heading', { name: '新建项目' })).toBeTruthy()
  })

  it('将项目完成版本的入口路由到历史记录', () => {
    window.history.replaceState({}, '', '/projects/project-1/history')

    render(<App />)

    expect(screen.getByRole('heading', { name: '历史记录' })).toBeTruthy()
  })

  it('keeps the asset library separate from workflow history', () => {
    window.history.replaceState({}, '', '/projects/project-1/assets')

    render(<App />)

    expect(screen.getByRole('heading', { name: '资产库' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '历史记录' })).toBeNull()
  })

  it('provides a dedicated Playtest entry', () => {
    window.history.replaceState({}, '', '/playtest')

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Playtest' })).toBeTruthy()
  })
})
