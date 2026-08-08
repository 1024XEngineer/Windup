/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

import type { QuickStartService, QuickStartView } from './service'
import { QuickStartPage } from './index'

afterEach(cleanup)

function service(overrides: Partial<QuickStartService> = {}): QuickStartService {
  return {
    unavailableReason: null,
    start: vi.fn(async () => ({ runId: 'run-1' })),
    load: vi.fn(async () => null),
    subscribe: vi.fn(() => () => undefined),
    interrupt: vi.fn(async () => undefined),
    approve: vi.fn(async () => ({ characterId: 'character-1', outfitId: 'outfit-1' })),
    ...overrides,
  }
}

function view(overrides: Partial<QuickStartView> = {}): QuickStartView {
  return {
    runId: 'run-1',
    status: 'running',
    title: '像素信使',
    message: '正在生成完整动画',
    completedNodes: 3,
    totalNodes: 6,
    generationMethod: null,
    fps: 12,
    animationFrames: [],
    ...overrides,
  }
}

function renderPage(testService: QuickStartService, path = '/quick-start') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/quick-start" element={<QuickStartPage service={testService} />} />
        <Route path="/quick-start/:runId" element={<QuickStartPage service={testService} />} />
      </Routes>
    </MemoryRouter>,
  )
}

function LocationProbe() {
  const location = useLocation()
  return <p>{location.pathname}</p>
}

describe('QuickStartPage', () => {
  it('未装配时明确禁用，不回退 Mock', () => {
    renderPage(service({ unavailableReason: '服务尚未配置' }))
    expect(screen.getByRole('alert').textContent).toContain('服务尚未配置')
    expect(screen.getByRole('button', { name: '开始自动生成' })).toHaveProperty('disabled', true)
  })

  it('提交自然语言后进入同一 WorkflowRun 路由', async () => {
    const testService = service()
    renderPage(testService)
    fireEvent.change(screen.getByLabelText('角色描述'), { target: { value: '像素信使' } })
    fireEvent.change(screen.getByLabelText('动作描述（可选）'), { target: { value: '向前奔跑' } })
    fireEvent.click(screen.getByRole('button', { name: '开始自动生成' }))

    await waitFor(() => expect(screen.getByText('/quick-start/run-1')).toBeTruthy())
    expect(testService.start).toHaveBeenCalledWith({
      prompt: '像素信使',
      actionDescription: '向前奔跑',
    })
  })

  it('审核视图播放同一份逐帧结果并进入 Playtest', async () => {
    const testService = service({
      load: vi.fn(async () =>
        view({
          status: 'review',
          totalNodes: 6,
          completedNodes: 5,
          generationMethod: 'video-cropping',
          animationFrames: ['1.png', '2.png'],
        }),
      ),
    })
    renderPage(testService, '/quick-start/run-1')

    expect(await screen.findByAltText('动画第 1 帧')).toHaveProperty(
      'src',
      expect.stringContaining('1.png'),
    )
    expect(screen.getByText('资产路线：视频裁剪（自动选择）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '审核通过并打开预览台' }))
    await waitFor(() => expect(screen.getByText('/playtest/character-1/outfit-1')).toBeTruthy())
    expect(testService.approve).toHaveBeenCalledWith('run-1')
  })

  it('卸载时取消 Controller 投影订阅', async () => {
    const unsubscribe = vi.fn()
    const testService = service({
      load: vi.fn(async () => view()),
      subscribe: vi.fn(() => unsubscribe),
    })
    const rendered = renderPage(testService, '/quick-start/run-1')
    await screen.findByText('像素信使')
    rendered.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
