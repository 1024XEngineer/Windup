// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('从 Home 进入 Quick Start 后创建 Project 和 WorkflowRun 并进入独立会话页', async () => {
    const services = createDevelopmentAppServices()
    render(<App services={services} />)

    fireEvent.click(screen.getAllByRole('link', { name: /快速开始/ })[0])

    expect(screen.getByLabelText('创作描述')).toBeTruthy()
    expect(screen.getByText(/底层媒体上传已可用/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('创作描述'), { target: { value: '像素小骑士' } })
    fireEvent.click(screen.getByRole('button', { name: '开始创作' }))

    await waitFor(() => expect(window.location.pathname).toMatch(/^\/quick-start\/run-/))
    expect(await screen.findByText(/创作会话 run-/)).toBeTruthy()
    expect(await screen.findByText(/自动制作中|等待人工审核/)).toBeTruthy()
    expect(localStorage.getItem('windup.workflow-runs.v1')).toBeNull()
  })
})
