import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQuickStartConversationClient } from './api'

afterEach(() => vi.unstubAllGlobals())

function sseResponse(records: readonly string[], init: ResponseInit = {}) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const record of records) controller.enqueue(encoder.encode(record))
        controller.close()
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      ...init,
    },
  )
}

describe('Quick Start conversation client', () => {
  it('sends bounded chat history and parses a fragmented prompt suggestion', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"prompt_"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"suggestion\\",\\"reply\\":\\"整理好了\\",\\"optimizedPrompt\\":\\"单一角色，红衣金毛\\",\\"warnings\\":[]}"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn,
      getAccessToken: () => 'access-token',
    })

    await expect(
      client.respond([
        { role: 'user', content: '一群奔跑的大狗' },
        { role: 'assistant', content: '请只保留一个角色。' },
        { role: 'user', content: '一只穿红色飞行夹克的金毛' },
      ]),
    ).resolves.toEqual({
      type: 'prompt_suggestion',
      reply: '整理好了',
      optimizedPrompt: '单一角色，红衣金毛',
      warnings: [],
    })

    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, request] = fetchFn.mock.calls[0]!
    expect(url).toBe('/api/ai/chat')
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer access-token')
    expect(JSON.parse(String(request?.body))).toMatchObject({
      messages: [
        { role: 'user', content: '一群奔跑的大狗' },
        { role: 'assistant', content: '请只保留一个角色。' },
        { role: 'user', content: '一只穿红色飞行夹克的金毛' },
      ],
    })
    expect(JSON.parse(String(request?.body))).not.toHaveProperty('tools')
  })

  it('uses the global fetch implementation when no transport override is provided', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"clarification\\",\\"reply\\":\\"请补充角色外观\\"}"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchFn)
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      getAccessToken: () => null,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).resolves.toEqual({
      type: 'clarification',
      reply: '请补充角色外观',
    })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('rejects model output that does not match the conversation schema', async () => {
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn: async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"随便生成一个就好"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      getAccessToken: () => null,
    })

    await expect(client.respond([{ role: 'user', content: '随便画一个' }])).rejects.toThrow(
      'LLM 返回格式无效',
    )
  })

  it('rejects malformed JSON inside an SSE data event', async () => {
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn: async () => sseResponse(['data: not-json\n\n']),
      getAccessToken: () => null,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).rejects.toThrow(
      'LLM 流包含无效 JSON',
    )
  })

  it('rejects a non-string content delta', async () => {
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn: async () => sseResponse(['data: {"choices":[{"delta":{"content":42}}]}\n\n']),
      getAccessToken: () => null,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).rejects.toThrow(
      'LLM 文本分片格式无效',
    )
  })

  it('ignores metadata-only and null-content deltas', async () => {
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn: async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":null}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"clarification\\",\\"reply\\":\\"请补充角色外观\\"}"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      getAccessToken: () => null,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).resolves.toEqual({
      type: 'clarification',
      reply: '请补充角色外观',
    })
  })

  it('rejects malformed SSE fields received before the stream closes', async () => {
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn: async () => sseResponse(['retry: nope\n\n']),
      getAccessToken: () => null,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).rejects.toThrow(
      'LLM 流格式无效',
    )
  })

  it('rejects a malformed pending SSE field when the stream closes', async () => {
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn: async () => sseResponse(['retry: nope']),
      getAccessToken: () => null,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).rejects.toThrow(
      'LLM 流格式无效',
    )
  })

  it.each([
    {
      name: 'HTTP failure',
      response: () => new Response(null, { status: 503 }),
      message: 'LLM 请求失败（HTTP 503）',
    },
    {
      name: 'missing response body',
      response: () =>
        new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      message: 'LLM 响应缺少消息流',
    },
    {
      name: 'invalid JSON business response',
      response: () =>
        new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
      message: 'LLM 响应类型无效',
    },
  ])('rejects $name', async ({ response, message }) => {
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn: async () => response(),
      getAccessToken: () => null,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).rejects.toThrow(message)
  })

  it('rejects an unterminated stream instead of accepting partial output', async () => {
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn: async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"clarification\\",\\"reply\\":\\"请补充外观"}}]}\n\n',
        ]),
      getAccessToken: () => null,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).rejects.toThrow(
      'LLM 响应未完成',
    )
  })

  it('replays the chat request once after the existing session recovers a 401', async () => {
    let accessToken = 'expired-token'
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"clarification\\",\\"reply\\":\\"请补充角色外观\\"}"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      )
    const recoverUnauthorized = vi.fn(async () => {
      accessToken = 'fresh-token'
      return true
    })
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn,
      getAccessToken: () => accessToken,
      recoverUnauthorized,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).resolves.toEqual({
      type: 'clarification',
      reply: '请补充角色外观',
    })
    expect(recoverUnauthorized).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(new Headers(fetchFn.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      'Bearer fresh-token',
    )
  })

  it('does not replay an unauthorized request when session recovery declines', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }))
    const recoverUnauthorized = vi.fn(async () => false)
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn,
      getAccessToken: () => 'expired-token',
      recoverUnauthorized,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).rejects.toThrow(
      'LLM 请求失败（HTTP 401）',
    )
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(recoverUnauthorized).toHaveBeenCalledOnce()
  })

  it('recovers the backend HTTP 200 business 401 before reading the event stream', async () => {
    let accessToken = 'expired-token'
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ code: 401, message: '登录已过期', data: null }, { status: 200 }),
      )
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"clarification\\",\\"reply\\":\\"请补充角色外观\\"}"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      )
    const recoverUnauthorized = vi.fn(async () => {
      accessToken = 'fresh-token'
      return true
    })
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn,
      getAccessToken: () => accessToken,
      recoverUnauthorized,
    })

    await expect(client.respond([{ role: 'user', content: '一个角色' }])).resolves.toEqual({
      type: 'clarification',
      reply: '请补充角色外观',
    })
    expect(recoverUnauthorized).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('finishes as soon as the stream emits DONE even if the connection remains open', async () => {
    const encoder = new TextEncoder()
    let streamCancelled = false
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"clarification\\",\\"reply\\":\\"请补充角色外观\\"}"}}]}\n\ndata: [DONE]\n\ndata: not-json\n\n',
            ),
          )
        },
        cancel() {
          streamCancelled = true
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    )
    const client = createQuickStartConversationClient({
      baseUrl: '/api',
      fetchFn: async () => response,
      getAccessToken: () => null,
    })

    await expect(
      Promise.race([
        client.respond([{ role: 'user', content: '一个角色' }]),
        new Promise((resolve) => setTimeout(() => resolve('still pending'), 50)),
      ]),
    ).resolves.toEqual({ type: 'clarification', reply: '请补充角色外观' })
    expect(streamCancelled).toBe(true)
  })
})
