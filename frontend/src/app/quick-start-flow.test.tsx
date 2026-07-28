// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDevelopmentAppServices } from './composition/development'
import { App } from './index'

describe('QuickStartPage', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    cleanup()
  })

  it('从 Home 进入 Quick Start 后创建统一运行并保留在简化创作台', async () => {
    render(<App services={createDevelopmentAppServices()} />)

    fireEvent.click(screen.getAllByRole('link', { name: /快速开始/ })[0])

    fireEvent.change(screen.getByPlaceholderText(/一个戴斗篷的像素小骑士/), {
      target: { value: '像素小骑士，要走路' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始创作' }))

    expect(await screen.findByRole('heading', { name: '正在理解你的设定' })).toBeTruthy()
    expect(screen.getByLabelText('创作进度')).toBeTruthy()
    expect(screen.getByText('生成服务暂未连接')).toBeTruthy()
    expect(window.location.pathname).toMatch(/^\/quick-start\/run-[^/]+$/)
    const runId = window.location.pathname.split('/').at(-1)!
    const persistedRuns = JSON.parse(
      localStorage.getItem('windup.workflow-runs.v1') ?? '{}',
    ) as Record<string, { projectId: string }>
    expect(persistedRuns[runId]?.projectId).toMatch(/^\d+$/)
    expect(persistedRuns[runId]?.projectId).not.toBe('quick-start')
    expect(screen.queryByRole('heading', { name: '工作流' })).toBeNull()
    expect(screen.queryByText(/Provider Session/)).toBeNull()
  })
})
