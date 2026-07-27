// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { App } from './index'

describe('QuickStartPage', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    cleanup()
  })

  it('从 Home 进入 Quick Start 后创建统一工作流并跳到 generation', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('link', { name: /快速开始/ })[0])

    fireEvent.change(screen.getByPlaceholderText(/一个戴斗篷的像素小骑士/), {
      target: { value: '像素小骑士，要走路' },
    })
    fireEvent.click(screen.getByRole('button', { name: '进入工作流' }))

    expect(await screen.findByRole('heading', { name: '工作流' })).toBeTruthy()
    expect(screen.getByText(/Provider Session 尚未连接/)).toBeTruthy()
    expect(window.location.pathname).toMatch(/^\/workflow-editor\/run-[^/]+\/generation$/)
    expect(screen.queryByRole('heading', { name: '快速开始' })).toBeNull()
  })
})
