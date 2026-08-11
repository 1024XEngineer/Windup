import { describe, expect, it, vi } from 'vitest'

import { createEventStreamSubscriber } from './stream'

function eventStreamResponse(data: string, event = 'task_update'): Response {
  return new Response(`event: ${event}\ndata: ${data}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('createEventStreamSubscriber', () => {
  it('使用 Bearer Token 建立 SSE 连接并在终态后停止', async () => {
    let request: Request | undefined
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init)
      return eventStreamResponse('{"status":"completed"}')
    })
    const subscriber = createEventStreamSubscriber({
      fetchFn,
      getAccessToken: () => 'access-token',
    })

    await new Promise<void>((resolve, reject) => {
      subscriber('https://api.test/generation/tasks/91/stream?project_id=42', {
        eventName: 'task_update',
        onEvent(data) {
          expect(data).toBe('{"status":"completed"}')
          resolve()
          return true
        },
        onError: reject,
      })
    })

    expect(request?.headers.get('accept')).toBe('text/event-stream')
    expect(request?.headers.get('authorization')).toBe('Bearer access-token')
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('HTTP 401 时刷新会话并用新 token 重连一次', async () => {
    const requests: Request[] = []
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (input, init) => {
        requests.push(new Request(input, init))
        return new Response(null, { status: 401 })
      })
      .mockImplementationOnce(async (input, init) => {
        requests.push(new Request(input, init))
        return eventStreamResponse('{"status":"completed"}')
      })
    const getAccessToken = vi
      .fn<() => string>()
      .mockReturnValueOnce('expired-token')
      .mockReturnValueOnce('refreshed-token')
    const recoverUnauthorized = vi.fn(async () => true)
    const subscriber = createEventStreamSubscriber({
      fetchFn,
      getAccessToken,
      recoverUnauthorized,
      reconnectDelayMs: 0,
    })

    await new Promise<void>((resolve, reject) => {
      subscriber('https://api.test/generation/tasks/91/stream', {
        eventName: 'task_update',
        onEvent() {
          resolve()
          return true
        },
        onError: reject,
      })
    })

    expect(recoverUnauthorized).toHaveBeenCalledOnce()
    expect(requests.map((request) => request.headers.get('authorization'))).toEqual([
      'Bearer expired-token',
      'Bearer refreshed-token',
    ])
  })

  it('网络中断后重连，并为新连接重新读取 access token', async () => {
    const getAccessToken = vi
      .fn<() => string>()
      .mockReturnValueOnce('first-token')
      .mockReturnValueOnce('second-token')
    const requests: Request[] = []
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockImplementationOnce(async () => eventStreamResponse('{"status":"failed"}'))
    const onError = vi.fn()
    const subscriber = createEventStreamSubscriber({
      fetchFn: async (input, init) => {
        requests.push(new Request(input, init))
        return fetchFn(input, init)
      },
      getAccessToken,
      reconnectDelayMs: 0,
    })

    await new Promise<void>((resolve) => {
      subscriber('https://api.test/generation/tasks/91/stream', {
        eventName: 'task_update',
        onEvent() {
          resolve()
          return true
        },
        onError,
      })
    })

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'SSE 连接中断，正在自动重连' }),
    )
    expect(requests.map((request) => request.headers.get('authorization'))).toEqual([
      'Bearer first-token',
      'Bearer second-token',
    ])
  })

  it('取消订阅会中止正在进行的请求', async () => {
    let signal: AbortSignal | undefined
    const subscriber = createEventStreamSubscriber({
      async fetchFn(_input, init) {
        signal = init?.signal as AbortSignal
        return new Promise<Response>(() => undefined)
      },
      getAccessToken: () => undefined,
    })

    const unsubscribe = subscriber('https://api.test/generation/tasks/91/stream', {
      eventName: 'task_update',
      onEvent: () => false,
      onError: vi.fn(),
    })
    await vi.waitFor(() => expect(signal).toBeDefined())
    unsubscribe()

    expect(signal?.aborted).toBe(true)
  })

  it('业务事件解析失败时报告错误且不重连', async () => {
    const fetchFn = vi.fn(async () => eventStreamResponse('{}'))
    const onError = vi.fn()
    const subscriber = createEventStreamSubscriber({
      fetchFn,
      getAccessToken: () => undefined,
      reconnectDelayMs: 0,
    })

    subscriber('https://api.test/generation/tasks/91/stream', {
      eventName: 'task_update',
      onEvent() {
        throw new Error('invalid task DTO')
      },
      onError,
    })

    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'invalid task DTO' }),
      ),
    )
    expect(fetchFn).toHaveBeenCalledOnce()
  })
})
