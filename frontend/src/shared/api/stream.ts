/**
 * 业务无关的 SSE 订阅边界。
 *
 * 上层只处理字符串 payload、终态判断和错误回调，不接触 EventSource 实例。
 * 浏览器断线后由 EventSource 按协议自动重连；显式取消、终态或非法消息才会关闭连接。
 */

export interface EventSourceLike {
  onerror: ((event: Event) => void) | null
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
  close(): void
}

export type EventSourceFactory = (url: string) => EventSourceLike

export interface EventStreamOptions {
  /** 只监听业务指定的命名事件，例如 task_update。 */
  eventName: string
  /** 返回 true 表示 payload 是终态，传输层随后关闭连接。 */
  onEvent(data: string): boolean
  /** 包含连接中断、非法消息和业务解析器抛出的错误。 */
  onError(error: Error): void
}

export type EventStreamSubscriber = (url: string, options: EventStreamOptions) => () => void

export class EventStreamError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EventStreamError'
  }
}

const createBrowserEventSource: EventSourceFactory = (url) => new EventSource(url)

function asError(value: unknown): Error {
  return value instanceof Error ? value : new EventStreamError('SSE 事件处理失败')
}

/**
 * 建立命名 SSE 事件订阅并返回幂等取消函数。
 *
 * `error` 事件通常表示临时断线。此处只通知上层而不主动 close，让浏览器原生
 * EventSource 继续使用服务端 retry 配置重连，避免退回业务轮询。
 */
export function subscribeToEventStream(
  url: string,
  options: EventStreamOptions,
  eventSourceFactory: EventSourceFactory = createBrowserEventSource,
): () => void {
  let active = true
  let source: EventSourceLike | null = null

  const stop = () => {
    if (!active) return
    active = false
    if (source === null) return
    source.removeEventListener(options.eventName, handleEvent)
    source.onerror = null
    source.close()
  }

  const handleEvent = (event: Event) => {
    if (!active) return
    try {
      if (!('data' in event) || typeof event.data !== 'string') {
        throw new EventStreamError('SSE 事件缺少字符串 data')
      }
      if (options.onEvent(event.data)) stop()
    } catch (error) {
      stop()
      options.onError(asError(error))
    }
  }

  try {
    source = eventSourceFactory(url)
    source.addEventListener(options.eventName, handleEvent)
    source.onerror = () => {
      if (active) options.onError(new EventStreamError('SSE 连接中断'))
    }
  } catch (error) {
    stop()
    options.onError(new EventStreamError('SSE 连接建立失败', { cause: error }))
  }

  return stop
}
