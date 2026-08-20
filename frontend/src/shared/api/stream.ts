/** 业务无关的、可鉴权的 SSE 订阅边界。 */

export interface EventStreamOptions {
  /** 只监听业务指定的命名事件，例如 task_update 或 completed。 */
  eventName: string | readonly string[]
  /** 返回 true 表示 payload 是终态，传输层随后关闭连接。 */
  onEvent(data: string, eventName: string): boolean
  /** 包含连接中断、非法响应和业务解析器抛出的错误。 */
  onError(error: Error): void
  /**
   * 断线后重新建立连接时触发，首次连接不触发。
   * 传输层不补发断线窗口内的事件，业务层收到后应自行对账当前状态。
   */
  onReconnect?(): void
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
    if (!record) return false
    const matches =
      typeof options.eventName === 'string'
        ? record.event === options.eventName
        : options.eventName.includes(record.event)
    if (!matches) return false
    if (!options.onEvent(record.data, record.event)) return false
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

const MAX_RECONNECT_DELAY_MS = 30_000

/**
 * 指数退避加抖动。服务端整体不可用时，固定间隔会让所有在线页面以同一节奏
 * 持续重试；抖动把它们的重连时刻打散，退避把总量压下来。
 */
function reconnectDelay(baseDelayMs: number, failures: number): number {
  if (baseDelayMs <= 0) return 0
  const backoff = Math.min(baseDelayMs * 2 ** failures, MAX_RECONNECT_DELAY_MS)
  return Math.round(backoff * (0.5 + Math.random() * 0.5))
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
    let attempted = false
    let failures = 0

    const run = async () => {
      while (!controller.signal.aborted) {
        // 重连判定放在发起请求之前：首次连接就失败、由重试建立起来的流，
        // 同样错过了断线窗口内的事件。
        const reconnecting = attempted
        attempted = true
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
          if (reconnecting) options.onReconnect?.()
          // 流建立成功即视为服务端恢复，退避从头算起。
          failures = 0
          const terminal = await readEventStream(response, options)
          if (terminal || controller.signal.aborted) return
          throw connectionError()
        } catch (cause) {
          if (controller.signal.aborted) return
          const error = asError(cause)
          options.onError(error)
          if (!(error instanceof EventStreamError) || !error.retryable) return
          await waitForReconnect(reconnectDelay(reconnectDelayMs, failures), controller.signal)
          failures += 1
        }
      }
    }

    void run()
    return () => controller.abort()
  }
}
