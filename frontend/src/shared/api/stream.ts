/** 业务无关的、可鉴权的 SSE 订阅边界。 */

export interface EventStreamOptions {
  /** 只监听业务指定的命名事件，例如 task_update。 */
  eventName: string
  /** 返回 true 表示 payload 是终态，传输层随后关闭连接。 */
  onEvent(data: string): boolean
  /** 包含连接中断、非法响应和业务解析器抛出的错误。 */
  onError(error: Error): void
}

export type EventStreamSubscriber = (url: string, options: EventStreamOptions) => () => void

export interface EventStreamSubscriberConfig {
  fetchFn?: typeof fetch
  /** 每次连接前重新读取，支持刷新后的 token。 */
  getAccessToken: () => string | null | undefined
  /** HTTP 401 时由认证会话尝试刷新；成功后只重放本次连接。 */
  recoverUnauthorized?: () => Promise<boolean>
  reconnectDelayMs?: number
}

export class EventStreamError extends Error {
  readonly retryable: boolean
  readonly status: number | null

  constructor(
    message: string,
    retryable = false,
    options?: ErrorOptions,
    status: number | null = null,
  ) {
    super(message, options)
    this.name = 'EventStreamError'
    this.retryable = retryable
    this.status = status
  }
}

interface SseRecord {
  event: string
  data: string
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new EventStreamError('SSE 事件处理失败')
}

function connectionError(cause?: unknown): EventStreamError {
  return new EventStreamError('SSE 连接中断，正在自动重连', true, { cause })
}

function parseRecord(block: string): SseRecord | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split(/\r?\n/u)) {
    if (line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const rawValue = separator < 0 ? '' : line.slice(separator + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
    if (field === 'event') event = value
    if (field === 'data') data.push(value)
  }
  return data.length === 0 ? null : { event, data: data.join('\n') }
}

async function readEventStream(response: Response, options: EventStreamOptions): Promise<boolean> {
  if (!response.body) throw new EventStreamError('SSE 响应缺少消息流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const deliver = async (block: string): Promise<boolean> => {
    const record = parseRecord(block)
    if (record?.event !== options.eventName) return false
    if (!options.onEvent(record.data)) return false
    await reader.cancel()
    return true
  }

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (cause) {
        throw connectionError(cause)
      }
      const { done, value } = chunk
      buffer += decoder.decode(value, { stream: !done })
      let boundary = /\r?\n\r?\n/u.exec(buffer)
      while (boundary) {
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        if (await deliver(block)) return true
        boundary = /\r?\n\r?\n/u.exec(buffer)
      }
      if (!done) continue
      return buffer.length > 0 ? deliver(buffer) : false
    }
  } catch (cause) {
    try {
      await reader.cancel(cause)
    } catch {
      // 取消失败不能覆盖真正的协议或业务错误。
    }
    throw cause
  } finally {
    reader.releaseLock()
  }
}

function waitForReconnect(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, delayMs)
    signal.addEventListener('abort', finish, { once: true })
  })
}

/**
 * 使用 fetch 流建立 SSE。浏览器原生 EventSource 不能设置 Authorization，
 * 因此不能用于当前受保护的任务订阅接口。
 */
export function createEventStreamSubscriber(
  config: EventStreamSubscriberConfig,
): EventStreamSubscriber {
  const fetchFn = config.fetchFn ?? globalThis.fetch
  const reconnectDelayMs = config.reconnectDelayMs ?? 1_000

  return (url, options) => {
    const controller = new AbortController()
    let attemptedUnauthorizedRecovery = false

    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          const headers = new Headers({ Accept: 'text/event-stream' })
          const accessToken = config.getAccessToken()
          if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
          let response: Response
          try {
            response = await fetchFn(url, {
              method: 'GET',
              headers,
              credentials: 'include',
              signal: controller.signal,
            })
          } catch (cause) {
            throw connectionError(cause)
          }

          if (
            response.status === 401 &&
            !attemptedUnauthorizedRecovery &&
            config.recoverUnauthorized
          ) {
            attemptedUnauthorizedRecovery = true
            if (await config.recoverUnauthorized()) continue
          }
          if (!response.ok) {
            throw new EventStreamError(
              `SSE 请求失败（HTTP ${response.status}）`,
              false,
              undefined,
              response.status,
            )
          }
          if (!response.headers.get('content-type')?.includes('text/event-stream')) {
            throw new EventStreamError('SSE 响应类型无效')
          }
          attemptedUnauthorizedRecovery = false
          const terminal = await readEventStream(response, options)
          if (terminal || controller.signal.aborted) return
          throw connectionError()
        } catch (cause) {
          if (controller.signal.aborted) return
          const error = asError(cause)
          options.onError(error)
          if (!(error instanceof EventStreamError) || !error.retryable) return
          await waitForReconnect(reconnectDelayMs, controller.signal)
        }
      }
    }

    void run()
    return () => controller.abort()
  }
}
