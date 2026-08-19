import { createParser } from 'eventsource-parser'
import * as v from 'valibot'

export type QuickStartConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type QuickStartConversationResult =
  | { type: 'clarification'; reply: string }
  | {
      type: 'prompt_suggestion'
      reply: string
      optimizedPrompt: string
      warnings: string[]
    }

export interface QuickStartConversationClient {
  respond(
    messages: readonly QuickStartConversationMessage[],
    signal?: AbortSignal,
  ): Promise<QuickStartConversationResult>
}

export interface CreateQuickStartConversationClientOptions {
  baseUrl: string
  fetchFn?: typeof fetch
  getAccessToken: () => string | null | undefined
  recoverUnauthorized?: () => Promise<boolean>
}

const nonEmptyText = v.pipe(v.string(), v.trim(), v.minLength(1))
const responseSchema = v.variant('type', [
  v.object({
    type: v.literal('clarification'),
    reply: nonEmptyText,
  }),
  v.object({
    type: v.literal('prompt_suggestion'),
    reply: nonEmptyText,
    optimizedPrompt: nonEmptyText,
    warnings: v.array(nonEmptyText),
  }),
])

const QUICK_START_SYSTEM_PROMPT = `你是 Windup Quick Start 的角色描述助手，只处理单一角色母版的创作输入。
保留用户明确给出的身份、外观和风格，不擅自增加或删除核心设定。
信息不足、多主体、复杂场景或描述冲突时，每次只追问一个最关键的问题。
信息充分时，将口语描述整理为适合单角色、完整身体和后续动作生成的提示词。
只返回 JSON，不要使用 Markdown。格式只能是：
{"type":"clarification","reply":"一个明确问题"}
或
{"type":"prompt_suggestion","reply":"简短说明","optimizedPrompt":"优化后的提示词","warnings":["必要提醒"]}`

function chatEndpoint(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/u, '')}/ai/chat`
}

function parseDelta(value: string): string {
  let payload: unknown
  try {
    payload = JSON.parse(value)
  } catch (cause) {
    throw new Error('LLM 流包含无效 JSON', { cause })
  }
  const content = (payload as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]
    ?.delta?.content
  if (content === undefined || content === null) return ''
  if (typeof content !== 'string') throw new Error('LLM 文本分片格式无效')
  return content
}

async function readOpenAiEventStream(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`LLM 请求失败（HTTP ${response.status}）`)
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('LLM 响应类型无效')
  }
  if (!response.body) throw new Error('LLM 响应缺少消息流')

  let content = ''
  let completed = false
  let streamError: Error | null = null
  const parser = createParser({
    maxBufferSize: 128 * 1024,
    onError(error) {
      streamError = new Error('LLM 流格式无效', { cause: error })
    },
    onEvent(event) {
      if (completed) return
      if (event.data === '[DONE]') {
        completed = true
        return
      }
      content += parseDelta(event.data)
    },
  })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
      if (streamError) throw streamError
      if (completed) {
        await reader.cancel()
        break
      }
    }
    if (!completed) {
      parser.feed(decoder.decode())
      parser.reset({ consume: true })
      if (streamError) throw streamError
    }
  } finally {
    reader.releaseLock()
  }
  if (!completed) throw new Error('LLM 响应未完成')
  return content
}

async function isBusinessUnauthorized(response: Response): Promise<boolean> {
  if (
    response.status !== 200 ||
    !response.headers.get('content-type')?.includes('application/json')
  ) {
    return false
  }
  try {
    const payload: unknown = await response.clone().json()
    return (
      typeof payload === 'object' &&
      payload !== null &&
      !Array.isArray(payload) &&
      (payload as { code?: unknown }).code === 401
    )
  } catch {
    return false
  }
}

export function createQuickStartConversationClient(
  options: CreateQuickStartConversationClientOptions,
): QuickStartConversationClient {
  const fetchFn = options.fetchFn ?? globalThis.fetch
  return {
    async respond(messages, signal) {
      const body = JSON.stringify({
        system: QUICK_START_SYSTEM_PROMPT,
        messages: messages.slice(-8),
      })
      const request = () => {
        const headers = new Headers({
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        })
        const accessToken = options.getAccessToken()
        if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
        return fetchFn(chatEndpoint(options.baseUrl), {
          method: 'POST',
          headers,
          credentials: 'include',
          signal,
          body,
        })
      }
      let response = await request()
      const unauthorized = response.status === 401 || (await isBusinessUnauthorized(response))
      if (unauthorized && options.recoverUnauthorized) {
        if (await options.recoverUnauthorized()) response = await request()
      }
      const content = await readOpenAiEventStream(response)
      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch (cause) {
        throw new Error('LLM 返回格式无效', { cause })
      }
      const result = v.safeParse(responseSchema, parsed)
      if (!result.success) throw new Error('LLM 返回格式无效', { cause: result.issues })
      return result.output
    },
  }
}
