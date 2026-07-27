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

  it('自动推进 AI 工作流，且始终留在 Quick Start 路由', async () => {
    render(<App />)

    fireEvent.change(screen.getByPlaceholderText(/一个戴斗篷的像素小骑士/), {
      target: { value: '像素小骑士，要走路' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))

    expect(await screen.findByText(/AI 快速生成已启动.*状态 completed/)).toBeTruthy()
    expect(screen.getByText(/生成待实现（工作流 run-/)).toBeTruthy()
    expect(window.location.pathname).toBe('/')
    expect(screen.getByRole('heading', { name: '快速开始' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '工作流' })).toBeNull()
  })
})
