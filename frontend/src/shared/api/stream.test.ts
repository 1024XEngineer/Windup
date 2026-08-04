import { describe, expect, it, vi } from 'vitest'

import { subscribeToEventStream, type EventSourceFactory, type EventSourceLike } from './stream'

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, Set<(event: Event) => void>>()
  readonly close = vi.fn()
  onerror: ((event: Event) => void) | null = null

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>)
    }
  }

  disconnect(): void {
    this.onerror?.(new Event('error'))
  }
}

function setup() {
  const source = new FakeEventSource()
  const factory = vi.fn<EventSourceFactory>(() => source)
  return { source, factory }
}

describe('subscribeToEventStream', () => {
  it('取消后关闭连接并忽略后续事件', () => {
    const { source, factory } = setup()
    const onEvent = vi.fn(() => false)
    const unsubscribe = subscribeToEventStream(
      '/generation/tasks/91/stream?project_id=42',
      { eventName: 'task_update', onEvent, onError: vi.fn() },
      factory,
    )

    unsubscribe()
    source.emit('task_update', '{"status":"running"}')

    expect(source.close).toHaveBeenCalledOnce()
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('收到终态关闭信号后关闭连接且只交付一次', () => {
    const { source, factory } = setup()
    const onEvent = vi.fn(() => true)
    subscribeToEventStream(
      '/generation/tasks/91/stream?project_id=42',
      { eventName: 'task_update', onEvent, onError: vi.fn() },
      factory,
    )

    source.emit('task_update', '{"status":"completed"}')
    source.emit('task_update', '{"status":"completed"}')

    expect(onEvent).toHaveBeenCalledOnce()
    expect(source.close).toHaveBeenCalledOnce()
  })

  it('事件解析失败时报告错误并关闭连接', () => {
    const { source, factory } = setup()
    const onError = vi.fn()
    subscribeToEventStream(
      '/generation/tasks/91/stream?project_id=42',
      {
        eventName: 'task_update',
        onEvent: () => {
          throw new Error('invalid task DTO')
        },
        onError,
      },
      factory,
    )

    source.emit('task_update', '{}')

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'invalid task DTO' }))
    expect(source.close).toHaveBeenCalledOnce()
  })

  it('断线时报告错误并保留 EventSource 的自动重连能力', () => {
    const { source, factory } = setup()
    const onEvent = vi.fn(() => false)
    const onError = vi.fn()
    subscribeToEventStream(
      '/generation/tasks/91/stream?project_id=42',
      { eventName: 'task_update', onEvent, onError },
      factory,
    )

    source.disconnect()
    source.emit('task_update', '{"status":"running"}')

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'SSE 连接中断' }))
    expect(source.close).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledOnce()
  })
})
