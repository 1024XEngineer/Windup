// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/shared/api'
import { readActiveRun, rememberActiveRun, type ActiveRunSnapshot } from '@/features/active-run'
import { ActiveRunMonitor, type ActiveRunMonitorService } from './active-run-monitor'

function run(phase: string): ActiveRunSnapshot {
  return { id: '42', nodes: [{ status: 'active', phase, deletedAt: null }] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function monitorService(initial = run('generating')) {
  let publish: ((snapshot: ActiveRunSnapshot) => void) | null = null
  const dispose = vi.fn()
  const session = {
    getWorkflow: vi.fn(() => initial),
    subscribe: vi.fn((listener: (snapshot: ActiveRunSnapshot) => void) => {
      publish = listener
      return () => {
        publish = null
      }
    }),
    resume: vi.fn(async () => initial),
    dispose,
  }
  const service: ActiveRunMonitorService = { open: vi.fn(async () => session) }
  return {
    service,
    session,
    dispose,
    publish(snapshot: ActiveRunSnapshot) {
      publish?.(snapshot)
    },
  }
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('ActiveRunMonitor', () => {
  it('离开 Quick Start 后继续对齐终态并清除入口', async () => {
    const harness = monitorService()
    rememberActiveRun('7', '42')
    render(<ActiveRunMonitor userId="7" pathname="/workspace" service={harness.service} />)

    await waitFor(() => expect(harness.service.open).toHaveBeenCalledWith('42'))
    act(() => harness.publish(run('selecting')))

    await waitFor(() => expect(readActiveRun('7')).toBeNull())
    expect(harness.dispose).toHaveBeenCalledOnce()
  })

  it('当前任务页面自己持有 session 时不重复恢复', async () => {
    const harness = monitorService()
    rememberActiveRun('7', '42')
    render(<ActiveRunMonitor userId="7" pathname="/quick-start/42" service={harness.service} />)

    await act(async () => Promise.resolve())
    expect(harness.service.open).not.toHaveBeenCalled()
  })

  it('open 在监控卸载后才返回时只释放 session', async () => {
    const opened = deferred<Awaited<ReturnType<ActiveRunMonitorService['open']>>>()
    const harness = monitorService()
    const service: ActiveRunMonitorService = { open: vi.fn(() => opened.promise) }
    rememberActiveRun('7', '42')
    const view = render(<ActiveRunMonitor userId="7" pathname="/workspace" service={service} />)
    await waitFor(() => expect(service.open).toHaveBeenCalledOnce())

    view.unmount()
    await act(async () => opened.resolve(harness.session))

    expect(harness.dispose).toHaveBeenCalledOnce()
    expect(harness.session.resume).not.toHaveBeenCalled()
  })

  it('初始快照已经结束时立即清除入口并释放 session', async () => {
    const harness = monitorService(run('selecting'))
    rememberActiveRun('7', '42')

    render(<ActiveRunMonitor userId="7" pathname="/workspace" service={harness.service} />)

    await waitFor(() => expect(readActiveRun('7')).toBeNull())
    expect(harness.dispose).toHaveBeenCalledOnce()
    expect(harness.session.resume).not.toHaveBeenCalled()
  })

  it('后端确认任务不存在时清除旧指针', async () => {
    rememberActiveRun('7', '42')
    const service: ActiveRunMonitorService = {
      open: vi.fn(async () => {
        throw new ApiError('执行记录不存在', { kind: 'business', code: 404, status: 200 })
      }),
    }

    render(<ActiveRunMonitor userId="7" pathname="/workspace" service={service} />)

    await waitFor(() => expect(readActiveRun('7')).toBeNull())
  })

  it('网络错误时保留入口供用户稍后重试', async () => {
    rememberActiveRun('7', '42')
    const service: ActiveRunMonitorService = {
      open: vi.fn(async () => {
        throw new ApiError('网络请求失败', { kind: 'network' })
      }),
    }

    render(<ActiveRunMonitor userId="7" pathname="/workspace" service={service} />)

    await waitFor(() => expect(service.open).toHaveBeenCalledOnce())
    expect(readActiveRun('7')).toBe('42')
  })

  it('旧任务恢复结果晚到时不覆盖用户刚开始的新任务', async () => {
    const resumed = deferred<ActiveRunSnapshot>()
    const harness = monitorService()
    harness.session.resume.mockReturnValue(resumed.promise)
    rememberActiveRun('7', '42')
    const view = render(
      <ActiveRunMonitor userId="7" pathname="/workspace" service={harness.service} />,
    )
    await waitFor(() => expect(harness.session.resume).toHaveBeenCalledOnce())

    act(() => {
      rememberActiveRun('7', '99')
      view.unmount()
    })
    await act(async () => resumed.resolve(run('generating')))

    expect(readActiveRun('7')).toBe('99')
  })
})
