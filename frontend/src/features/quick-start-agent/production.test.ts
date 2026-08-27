import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GenerationApis, WorkflowRunApis } from '@/entities'
import type {
  CreateWorkflowControllerOptions,
  PrepareQuickStartProject,
  WorkflowController,
} from '@/features/workflow-controller'
import {
  createAgentProxyFetch,
  createProductionQuickStartAgentDependencies,
  resolveAgentProxyBaseUrl,
} from './production'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Quick Start Agent composition', () => {
  it('turns the production relative API path into an absolute AI SDK base URL', () => {
    expect(resolveAgentProxyBaseUrl('/api', 'https://windup.test/quick-start')).toBe(
      'https://windup.test/api/ai',
    )
  })

  it('rejects an Agent API address when no browser origin is available', () => {
    expect(() => resolveAgentProxyBaseUrl('/api', '')).toThrow('当前环境无法解析 Agent API 地址')
  })

  it('rejects SDK requests outside the Chat Completions endpoint', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    const proxyFetch = createAgentProxyFetch({ fetchFn })

    await expect(
      proxyFetch('https://windup.test/api/ai/responses', { method: 'POST' }),
    ).rejects.toThrow('AI SDK 请求未命中 Chat Completions 路径')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('rewrites the AI SDK chat path, attaches JWT, and replays only an auth rejection', async () => {
    let token = 'expired-token'
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: 'expired', type: 'authentication_error' } },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ choices: [] }))
    const recoverUnauthorized = vi.fn(async () => {
      token = 'fresh-token'
      return true
    })
    const proxyFetch = createAgentProxyFetch({
      fetchFn,
      getAccessToken: () => token,
      recoverUnauthorized,
    })

    const response = await proxyFetch('https://windup.test/api/ai/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"messages":[]}',
    })

    expect(response.status).toBe(200)
    expect(recoverUnauthorized).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    const [firstRequest] = fetchFn.mock.calls[0] as [Request]
    const [secondRequest] = fetchFn.mock.calls[1] as [Request]
    expect(firstRequest.url).toBe('https://windup.test/api/ai/chat')
    expect(firstRequest.headers.get('authorization')).toBe('Bearer expired-token')
    expect(secondRequest.headers.get('authorization')).toBe('Bearer fresh-token')
  })

  it('logs status and request id when the Agent proxy is not ok', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchFn = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { message: 'AI 服务暂时不可用' } }), {
          status: 502,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req-agent-1' },
        }),
    )
    const proxyFetch = createAgentProxyFetch({ fetchFn })

    const response = await proxyFetch('https://windup.test/api/ai/chat/completions', {
      method: 'POST',
    })

    expect(response.status).toBe(502)
    expect(consoleError).toHaveBeenCalledWith('[quick-start-agent] /ai/chat 失败', {
      status: 502,
      requestId: 'req-agent-1',
    })
  })

  it('turns a content-policy rejection into actionable safe guidance', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            message: '请求包含不允许的内容',
            type: 'invalid_request_error',
            code: 'content_policy_violation',
          },
        },
        { status: 400 },
      ),
    )
    const proxyFetch = createAgentProxyFetch({ fetchFn })

    const response = await proxyFetch('https://windup.test/api/ai/chat/completions', {
      method: 'POST',
    })
    const body = (await response.json()) as { error: { code: string; message: string } }

    expect(body).toMatchObject({
      error: {
        code: 'content_policy_violation',
        message: expect.stringContaining('已被安全检查拦截'),
      },
    })
    expect(body.error.message).toContain('只保留角色外观或一个明确动作')
  })

  it('forwards a tokenless GET response without invoking auth recovery', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ choices: [] }))
    const recoverUnauthorized = vi.fn(async () => true)
    const proxyFetch = createAgentProxyFetch({
      fetchFn,
      getAccessToken: () => null,
      recoverUnauthorized,
    })

    const response = await proxyFetch('https://windup.test/api/ai/chat/completions', {
      method: 'GET',
    })

    expect(response.status).toBe(200)
    expect(recoverUnauthorized).not.toHaveBeenCalled()
    const [request] = fetchFn.mock.calls[0] as [Request]
    expect(request.headers.has('authorization')).toBe(false)
    expect(await request.text()).toBe('')
  })

  it('returns an auth rejection without replay when session recovery declines', async () => {
    const unauthorized = Response.json(
      { error: { message: 'expired', type: 'authentication_error' } },
      { status: 401 },
    )
    const fetchFn = vi.fn<typeof fetch>(async () => unauthorized)
    const recoverUnauthorized = vi.fn(async () => false)
    const proxyFetch = createAgentProxyFetch({ fetchFn, recoverUnauthorized })

    await expect(
      proxyFetch('https://windup.test/api/ai/chat/completions', { method: 'POST' }),
    ).resolves.toBe(unauthorized)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(recoverUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('loads the production AI SDK Planner once and reuses it across turns', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('location', { origin: 'https://app.windup.test' })
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      expect(request.url).toBe('https://api.windup.test/ai/chat')
      const payload = (await request.clone().json()) as Record<string, unknown>
      expect(payload).toMatchObject({ model: 'quick-start-planner' })
      expect(payload.stream).toBeUndefined()
      return Response.json({
        id: 'chatcmpl-planner',
        object: 'chat.completion',
        created: 1,
        model: 'planner-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '请补充角色风格。' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      })
    })
    vi.stubGlobal('fetch', fetchFn)
    const dependencies = createProductionQuickStartAgentDependencies()
    const input = {
      messages: [{ role: 'user' as const, content: '一个骑士' }],
      clarificationUsed: false,
    }

    await expect(dependencies.planner(input)).resolves.toMatchObject({
      text: '请补充角色风格。',
      finishReason: 'stop',
      toolCalls: [],
    })
    await expect(dependencies.planner(input)).resolves.toMatchObject({
      text: '请补充角色风格。',
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('creates an injected Planner once and reuses it across turns', async () => {
    const planner = vi.fn(async () => ({
      text: '请补充角色风格。',
      finishReason: 'stop',
      toolCalls: [],
    }))
    const createPlanner = vi.fn(() => planner)
    const dependencies = createProductionQuickStartAgentDependencies({ createPlanner })
    const input = {
      messages: [{ role: 'user' as const, content: '一个骑士' }],
      clarificationUsed: false,
    }

    await dependencies.planner(input)
    await dependencies.planner(input)

    expect(createPlanner).toHaveBeenCalledTimes(1)
    expect(planner).toHaveBeenCalledTimes(2)
  })

  it('binds the Agent write action directly to one existing WorkflowController command', async () => {
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-agent' }))
    const dispose = vi.fn()
    const controller = {
      startCharacterGeneration,
      dispose,
    } as unknown as WorkflowController
    const createController = vi.fn((_options: CreateWorkflowControllerOptions) => controller)
    const planner = vi.fn(async () => ({
      text: 'not used',
      finishReason: 'stop',
      toolCalls: [],
    }))
    const prepareProject = vi.fn<PrepareQuickStartProject>()
    const dependencies = createProductionQuickStartAgentDependencies({
      createPlanner: () => planner,
      createController,
      prepareProject,
      workflowRunApis: {} as WorkflowRunApis,
      generationApis: {} as GenerationApis,
    })

    const input = {
      prompt: '银发像素骑士',
      actionPrompt: '向前行走',
      actionType: 'walk' as const,
      locomotion: true as const,
      directionalMovement: 'single' as const,
      automaticDelivery: true,
      suggestPixelPerfect: true,
      referenceMedia: ['https://cdn.windup.test/hero.png'],
    }
    await expect(dependencies.startCharacterGeneration(input)).resolves.toEqual({
      runId: 'run-agent',
    })

    expect(createController).toHaveBeenCalledWith(
      expect.objectContaining({
        prepareProject,
        workflowRunApis: expect.anything(),
        generationApis: expect.anything(),
      }),
    )
    expect(startCharacterGeneration).toHaveBeenCalledWith({
      prompt: '银发像素骑士',
      directionalMovement: 'single',
      gameStyle: undefined,
      automaticDelivery: { actionPrompt: '向前行走', actionType: 'walk', locomotion: true },
      suggestPixelPerfect: true,
      referenceMedia: ['https://cdn.windup.test/hero.png'],
    })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes the Controller when its write command fails', async () => {
    const failure = new Error('generation failed')
    const dispose = vi.fn()
    const controller = {
      startCharacterGeneration: vi.fn(async () => Promise.reject(failure)),
      dispose,
    } as unknown as WorkflowController
    const dependencies = createProductionQuickStartAgentDependencies({
      createPlanner: () => vi.fn(),
      createController: () => controller,
      prepareProject: vi.fn<PrepareQuickStartProject>(),
      workflowRunApis: {} as WorkflowRunApis,
      generationApis: {} as GenerationApis,
    })

    await expect(dependencies.startCharacterGeneration({ prompt: '银发像素骑士' })).rejects.toBe(
      failure,
    )
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('surfaces background Controller failures through the default error reporter', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let controllerOptions: CreateWorkflowControllerOptions | undefined
    const controller = {
      startCharacterGeneration: vi.fn(async () => ({ runId: 'run-agent' })),
      dispose: vi.fn(),
    } as unknown as WorkflowController
    const dependencies = createProductionQuickStartAgentDependencies({
      createPlanner: () => vi.fn(),
      createController: (options) => {
        controllerOptions = options
        return controller
      },
      prepareProject: vi.fn<PrepareQuickStartProject>(),
      workflowRunApis: {} as WorkflowRunApis,
      generationApis: {} as GenerationApis,
    })
    const failure = new Error('subscription failed')

    await dependencies.startCharacterGeneration({ prompt: '银发像素骑士' })
    controllerOptions?.onAsyncError?.(failure)

    expect(consoleError).toHaveBeenCalledWith('[quick-start-agent] 工作流错误', failure)
  })
})
