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

  it('创建统一工作流后结果留在 Quick Start，不自动跳走', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('link', { name: /快速开始/ })[0])

    fireEvent.change(screen.getByPlaceholderText(/一个戴斗篷的像素小骑士/), {
      target: { value: '像素小骑士，要走路' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))

    expect(await screen.findByText(/工作流 run-.+ · 生成 in_progress/)).toBeTruthy()
    expect(window.location.pathname).toBe('/quick-start')
    expect(screen.getByRole('heading', { name: '快速开始' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '工作流' })).toBeNull()
  })
})
