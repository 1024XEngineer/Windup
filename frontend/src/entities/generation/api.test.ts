import { describe, expect, it, vi } from 'vitest'

import {
  createAuthenticatedGenerationApis,
  createGenerationApis,
  GenerationApiError,
} from '@/entities'
import { EventStreamError, type EventStreamOptions } from '@/shared/api/stream'

import type { MediaReference } from '../media'

const reference = (url: string) => url as MediaReference

function success(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function taskData(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    project_id: 42,
    task_type: 'character_image',
    status: 'completed',
    input_payload: { num_images: 3 },
    result: {
      type: 'character_image',
      image_urls: [
        'https://cdn.test/candidate-1.png',
        'https://cdn.test/candidate-2.png',
        'https://cdn.test/candidate-3.png',
      ],
    },
    error_message: null,
    ...overrides,
  }
}

function actionFrames(count: number) {
  return Array.from({ length: count }, (_, offset) => {
    const index = count - offset - 1
    return {
      index,
      image_url: `https://cdn.test/frame-${index + 1}.png`,
      duration_ms: index % 2 === 0 ? 100 : null,
    }
  })
}

describe('createGenerationApis', () => {
  it('生产适配器把 SSE 订阅接到配置的 API 地址', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    const fetchFn = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          `event: failed\ndata: ${JSON.stringify({
            ...taskData({ status: 'failed', result: null, error_message: 'provider unavailable' }),
          })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const apis = createAuthenticatedGenerationApis(fetchFn as typeof fetch)
    const onEvent = vi.fn()

    const stop = apis.subscribe('42', '91', { type: 'character_template' }, onEvent, vi.fn())

    try {
      await vi.waitFor(() => expect(onEvent).toHaveBeenCalled())
      expect(String(fetchFn.mock.calls[0]?.[0])).toBe(
        'https://api.windup.test/generation/tasks/91/stream?project_id=42',
      )
    } finally {
      stop()
      vi.unstubAllEnvs()
    }
  })

  it('固定请求并映射三张角色母版候选', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => success(taskData()))
    const stream = vi.fn(() => vi.fn())
    const apis = createGenerationApis({
      baseUrl: 'https://api.test/',
      transport: { request, stream },
    })

    const generation = await apis.create({
      type: 'character_template',
      projectId: '42',
      referenceMedia: [reference('https://cdn.test/reference.png')],
      prompt: 'pixel hero',
      spriteWidth: 64,
      spriteHeight: 96,
    })

    expect(request).toHaveBeenCalledWith(
      'https://api.test/generation/image',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: 42,
          reference_image_url: 'https://cdn.test/reference.png',
          prompt: 'pixel hero',
          negative_prompt: '',
          width: 64,
          height: 96,
          num_images: 3,
        }),
      }),
    )
    expect(generation.result).toEqual({
      type: 'character_template',
      images: [
        { url: 'https://cdn.test/candidate-1.png' },
        { url: 'https://cdn.test/candidate-2.png' },
        { url: 'https://cdn.test/candidate-3.png' },
      ],
    })
  })

  it('根据角色母版和动作提示词生成三张动作首帧候选', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => success(taskData()))
    const apis = createGenerationApis({
      baseUrl: '',
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    const generation = await apis.create({
      type: 'first_frame',
      projectId: '42',
      actionType: 'idle',
      prompt: 'stand naturally',
      referenceMedia: [reference('https://cdn.test/template.png')],
      spriteWidth: 64,
      spriteHeight: 96,
    })

    expect(request.mock.calls[0]?.[0]).toBe('/generation/image')
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      project_id: 42,
      reference_image_url: 'https://cdn.test/template.png',
      prompt: 'stand naturally',
      negative_prompt: '',
      width: 64,
      height: 96,
      num_images: 3,
    })
    expect(generation.result).toEqual({
      type: 'first_frame',
      images: [
        { url: 'https://cdn.test/candidate-1.png' },
        { url: 'https://cdn.test/candidate-2.png' },
        { url: 'https://cdn.test/candidate-3.png' },
      ],
    })
  })

  it('没有角色母版时拒绝创建动作首帧任务', async () => {
    const apis = createGenerationApis({
      transport: { request: vi.fn(), stream: vi.fn(() => vi.fn()) },
    })

    await expect(
      apis.create({
        type: 'first_frame',
        projectId: '42',
        actionType: 'walk',
        prompt: 'walk',
        referenceMedia: [],
        spriteWidth: 64,
        spriteHeight: 96,
      }),
    ).rejects.toThrow('动作首帧生成必须提供已确认的角色母版')
  })

  it('以首帧请求完整动画并按后端 index 排序，当前合同固定为三十二帧', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) =>
      success(
        taskData({
          task_type: 'character_action',
          input_payload: { num_frames: 32, action_type: 'walk' },
          result: {
            type: 'character_action',
            action_type: 'walk',
            frames: actionFrames(32),
          },
        }),
      ),
    )
    const apis = createGenerationApis({
      baseUrl: '/api',
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    const generation = await apis.create({
      type: 'complete_animation',
      projectId: '42',
      characterId: '5',
      outfitId: 'default',
      method: '3d-to-2d',
      actionType: 'walk',
      firstFrameUrl: 'https://cdn.test/frame-1.png',
      prompt: 'move forward',
      referenceMedia: [reference('https://cdn.test/extra.png')],
    })

    expect(request.mock.calls[0]?.[0]).toBe('/api/generation/action')
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      project_id: 42,
      character_id: 5,
      action_type: 'walk',
      custom_prompt: 'move forward',
      reference_video_url: null,
      reference_image_urls: ['https://cdn.test/frame-1.png', 'https://cdn.test/extra.png'],
      num_frames: 32,
      outfit_id: 'default',
    })
    expect(generation.result).toEqual({
      type: 'complete_animation',
      frames: Array.from({ length: 32 }, (_, index) => ({
        index,
        url: `https://cdn.test/frame-${index + 1}.png`,
        durationMs: index % 2 === 0 ? 100 : null,
      })),
    })
  })

  it('选视频裁剪时不发 outfit_id——后端拿它在场与否当三渲二的唯一判据', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) =>
      success(
        taskData({
          task_type: 'character_action',
          input_payload: { num_frames: 32, action_type: 'walk' },
          result: {
            type: 'character_action',
            action_type: 'walk',
            frames: actionFrames(32),
          },
        }),
      ),
    )
    const apis = createGenerationApis({
      baseUrl: '/api',
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    // 这个造型建过 3D 资产（outfitId 有值），但用户选的是视频裁剪。带上 outfit_id
    // 的话后端会查到 model_3d_url 并静默改走三渲二。
    await apis.create({
      type: 'complete_animation',
      projectId: '42',
      characterId: '5',
      outfitId: 'default',
      method: 'video-cropping',
      actionType: 'walk',
      firstFrameUrl: 'https://cdn.test/frame-1.png',
      prompt: 'move forward',
      referenceMedia: [],
    })

    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body))
    expect('outfit_id' in body).toBe(false)
  })

  it('自定义动作缺描述时不发请求，错误说清该填什么', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => success(taskData()))
    const apis = createGenerationApis({
      baseUrl: '/api',
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    for (const prompt of ['', '   ', null]) {
      await expect(
        apis.create({
          type: 'complete_animation',
          method: 'video-cropping',
          projectId: '42',
          characterId: '5',
          outfitId: 'default',
          actionType: 'custom',
          firstFrameUrl: 'https://cdn.test/frame-1.png',
          prompt,
          referenceMedia: [],
        }),
      ).rejects.toThrow('自定义动作必须填写动作描述')
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('没有母版时不提交动作生成，并指向定妆', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => success(taskData()))
    const apis = createGenerationApis({
      baseUrl: '/api',
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    await expect(
      apis.create({
        type: 'complete_animation',
        method: 'video-cropping',
        projectId: '42',
        characterId: '5',
        outfitId: 'default',
        actionType: 'walk',
        firstFrameUrl: '   ',
        prompt: null,
        referenceMedia: [],
      }),
    ).rejects.toThrow('请先完成定妆')
    expect(request).not.toHaveBeenCalled()
  })

  it('拒绝未知任务状态而不是默认为 pending', async () => {
    const request = vi.fn(async () => success(taskData({ status: 'queued' })))
    const apis = createGenerationApis({
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toBeInstanceOf(
      GenerationApiError,
    )
    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(
      '生成任务状态无效',
    )
  })

  it('拒绝结果字段不完整的 completed DTO', async () => {
    const request = vi.fn(async () =>
      success(taskData({ result: { type: 'character_image', image_urls: [null] } })),
    )
    const apis = createGenerationApis({
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(
      '角色图片结果 image_urls 无效',
    )
  })

  it('订阅 task_update，映射终态并把终态关闭信号交给流传输层', () => {
    let subscribedUrl = ''
    let streamOptions: EventStreamOptions | undefined
    const cancel = vi.fn()
    const stream = vi.fn((url: string, options: NonNullable<typeof streamOptions>) => {
      subscribedUrl = url
      streamOptions = options
      return cancel
    })
    const apis = createGenerationApis({
      baseUrl: 'https://api.test',
      transport: { request: vi.fn(), stream },
    })
    const onEvent = vi.fn()
    const onError = vi.fn()

    const unsubscribe = apis.subscribe(
      '42',
      '91',
      { type: 'complete_animation', actionType: 'walk' },
      onEvent,
      onError,
    )
    const isTerminal = streamOptions?.onEvent(
      JSON.stringify({
        id: 91,
        project_id: 42,
        task_type: 'character_action',
        status: 'completed',
        input_payload: { num_frames: 32, action_type: 'walk' },
        result: {
          type: 'character_action',
          action_type: 'walk',
          frames: actionFrames(32),
        },
        error_message: null,
      }),
      'task_update',
    )

    expect(subscribedUrl).toBe('https://api.test/generation/tasks/91/stream?project_id=42')
    expect(streamOptions?.eventName).toEqual(['task_update', 'progress', 'completed', 'failed'])
    expect(isTerminal).toBe(true)
    expect(onEvent).toHaveBeenCalledWith({
      taskId: '91',
      type: 'complete_animation',
      status: 'completed',
      result: {
        type: 'complete_animation',
        frames: Array.from({ length: 32 }, (_, index) => ({
          index,
          url: `https://cdn.test/frame-${index + 1}.png`,
          durationMs: index % 2 === 0 ? 100 : null,
        })),
      },
      error: null,
    })

    unsubscribe()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('从查询结果推断前端阶段，并允许现有三参数订阅继续使用', async () => {
    let streamOptions: EventStreamOptions | undefined
    const task = taskData({
      task_type: 'character_action',
      input_payload: { num_frames: 32, action_type: 'walk' },
      result: {
        type: 'character_action',
        action_type: 'walk',
        frames: actionFrames(32),
      },
    })
    const stream = vi.fn((_url: string, options: NonNullable<typeof streamOptions>) => {
      streamOptions = options
      return vi.fn()
    })
    const apis = createGenerationApis({
      transport: { request: vi.fn(async () => success(task)), stream },
    })

    const generation = await apis.get('42', '91')
    const onEvent = vi.fn()
    apis.subscribe('42', '91', onEvent)
    streamOptions?.onEvent(JSON.stringify(task), 'task_update')

    expect(generation.type).toBe('complete_animation')
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: '91',
        type: 'complete_animation',
        status: 'completed',
      }),
    )
  })

  it('拒绝 completed 任务返回错误动作类型', async () => {
    const request = vi.fn(async () =>
      success(
        taskData({
          task_type: 'character_action',
          input_payload: { num_frames: 32, action_type: 'walk' },
          result: {
            type: 'character_action',
            action_type: 'attack',
            frames: actionFrames(32),
          },
        }),
      ),
    )
    const apis = createGenerationApis({
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    await expect(
      apis.get('42', '91', { type: 'complete_animation', actionType: 'walk' }),
    ).rejects.toThrow('动作结果类型 attack 与请求的 walk 不一致')
  })

  it('拒绝不足三十二帧以及非失败状态携带错误', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        success(
          taskData({
            task_type: 'character_action',
            input_payload: { num_frames: 32, action_type: 'walk' },
            result: {
              type: 'character_action',
              action_type: 'walk',
              frames: actionFrames(3),
            },
          }),
        ),
      )
      .mockResolvedValueOnce(success(taskData({ error_message: 'provider failed' })))
    const apis = createGenerationApis({
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    await expect(
      apis.get('42', '91', { type: 'complete_animation', actionType: 'walk' }),
    ).rejects.toThrow('完整动画结果必须包含 32 帧')
    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(
      'completed 任务不应携带 error_message',
    )
  })

  it.each([
    ['非对象任务', success([]), '生成任务响应不是对象'],
    [
      '无效业务码',
      new Response(JSON.stringify({ code: '200', message: 'ok', data: taskData() })),
      '生成接口响应缺少有效的 code',
    ],
    [
      '业务失败',
      new Response(
        JSON.stringify({
          code: 503,
          message: 'provider unavailable',
          data: null,
        }),
      ),
      'provider unavailable',
    ],
    [
      '缺少数据',
      new Response(JSON.stringify({ code: 200, message: 'ok', data: null })),
      '生成接口成功响应缺少 data',
    ],
    ['非 JSON 响应', new Response('not-json', { status: 502 }), '无法解析的响应'],
  ])('拒绝%s', async (_label, response, message) => {
    const apis = createGenerationApis({
      transport: {
        request: vi.fn(async () => response),
        stream: vi.fn(() => vi.fn()),
      },
    })

    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(message)
  })

  it.each([
    ['任务 id', { id: 0 }, '生成任务 id 无效'],
    ['任务类型', { task_type: 'video' }, '生成任务 task_type 无效'],
    ['项目归属', { project_id: 43 }, '生成任务未归属请求中的项目 42'],
    ['请求任务 id', { id: 92 }, '生成任务 ID 与请求的 91 不一致'],
    ['输入对象', { input_payload: [] }, '生成任务 input_payload 无效'],
    ['结果对象', { result: [] }, '生成任务 result 无效'],
    ['错误字段', { error_message: 1 }, '生成任务 error_message 无效'],
    ['任务输入', { input_payload: { num_images: 4 } }, 'num_images 必须为 3'],
    [
      '图片结果类型',
      { result: { type: 'video', image_urls: ['a', 'b', 'c'] } },
      '角色图片结果 type 无效',
    ],
    ['图片数量', { result: { type: 'character_image', image_urls: ['a'] } }, '必须包含 3 个候选'],
    ['完成结果', { result: null }, '完成任务缺少 result'],
  ])('校验%s', async (_label, overrides, message) => {
    const apis = createGenerationApis({
      transport: {
        request: vi.fn(async () => success(taskData(overrides))),
        stream: vi.fn(() => vi.fn()),
      },
    })

    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(message)
  })

  it.each([
    [
      '非动作结果',
      { type: 'video', action_type: 'walk', frames: actionFrames(32) },
      '完整动画结果 type 无效',
    ],
    [
      '未知动作',
      {
        type: 'character_action',
        action_type: 'dance',
        frames: actionFrames(32),
      },
      '完整动画结果 action_type 无效',
    ],
    [
      '空帧',
      { type: 'character_action', action_type: 'walk', frames: [] },
      '完整动画结果 frames 无效',
    ],
    [
      '非对象帧',
      { type: 'character_action', action_type: 'walk', frames: [null] },
      '动作帧不是对象',
    ],
    [
      '无效索引',
      {
        type: 'character_action',
        action_type: 'walk',
        frames: [{ index: -1, image_url: 'a', duration_ms: 1 }],
      },
      '动作帧 index 无效',
    ],
    [
      '重复索引',
      {
        type: 'character_action',
        action_type: 'walk',
        frames: [
          { index: 0, image_url: 'a', duration_ms: 1 },
          { index: 0, image_url: 'b', duration_ms: 1 },
        ],
      },
      '动作帧 index 重复',
    ],
    [
      '空地址',
      {
        type: 'character_action',
        action_type: 'walk',
        frames: [{ index: 0, image_url: '', duration_ms: 1 }],
      },
      '动作帧 image_url 无效',
    ],
    [
      '无效时长',
      {
        type: 'character_action',
        action_type: 'walk',
        frames: [{ index: 0, image_url: 'a', duration_ms: -1 }],
      },
      '动作帧 duration_ms 无效',
    ],
  ])('拒绝%s', async (_label, result, message) => {
    const apis = createGenerationApis({
      transport: {
        request: vi.fn(async () =>
          success(
            taskData({
              task_type: 'character_action',
              input_payload: { num_frames: 32, action_type: 'walk' },
              result,
            }),
          ),
        ),
        stream: vi.fn(() => vi.fn()),
      },
    })

    await expect(
      apis.get('42', '91', { type: 'complete_animation', actionType: 'walk' }),
    ).rejects.toThrow(message)
  })

  it('映射运行中和失败任务，并拒绝缺失的失败原因', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(success(taskData({ status: 'running', result: null })))
      .mockResolvedValueOnce(
        success(
          taskData({
            status: 'failed',
            result: null,
            error_message: 'provider failed',
          }),
        ),
      )
      .mockResolvedValueOnce(success(taskData({ status: 'failed', result: null })))
    const apis = createGenerationApis({
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    await expect(apis.get('42', '91', { type: 'character_template' })).resolves.toMatchObject({
      status: 'running',
      result: null,
    })
    await expect(apis.get('42', '91', { type: 'character_template' })).resolves.toMatchObject({
      status: 'failed',
      error: 'provider failed',
    })
    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(
      '失败任务缺少 error_message',
    )
  })

  it('拒绝无缓存阶段的简写订阅并转发显式订阅错误', () => {
    let onStreamError: ((error: Error) => void) | undefined
    const apis = createGenerationApis({
      transport: {
        request: vi.fn(),
        stream: vi.fn((_url, options) => {
          onStreamError = options.onError
          return vi.fn()
        }),
      },
    })
    expect(() => apis.subscribe('42', '91', vi.fn())).toThrow('订阅前必须先创建或查询生成任务')

    const onError = vi.fn()
    apis.subscribe('42', '91', { type: 'character_template' }, vi.fn(), onError)
    const error = new Error('stream failed')
    onStreamError?.(error)
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('校验调用参数、原始响应和任务类型边界', async () => {
    const apis = createGenerationApis({
      transport: {
        request: vi
          .fn()
          .mockResolvedValueOnce(new Response(JSON.stringify([])))
          .mockResolvedValueOnce(success(taskData({ task_type: 'character_action' }))),
        stream: vi.fn(() => vi.fn()),
      },
    })

    await expect(apis.get('invalid', '91', { type: 'character_template' })).rejects.toThrow(
      'projectId 必须是正整数',
    )
    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(
      '生成接口响应不是对象',
    )
    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(
      '生成任务类型与 character_template 不匹配',
    )
  })

  it('按显式阶段恢复图片任务为三张动作首帧候选', async () => {
    const request = vi.fn().mockResolvedValueOnce(success(taskData()))
    const apis = createGenerationApis({
      transport: { request, stream: vi.fn(() => vi.fn()) },
    })

    await expect(
      apis.get('42', '91', { type: 'first_frame', actionType: 'idle' }),
    ).resolves.toMatchObject({
      type: 'first_frame',
      result: {
        type: 'first_frame',
        images: [
          { url: 'https://cdn.test/candidate-1.png' },
          { url: 'https://cdn.test/candidate-2.png' },
          { url: 'https://cdn.test/candidate-3.png' },
        ],
      },
    })
  })

  it('订阅图片任务时按首帧阶段映射三张候选', () => {
    let streamOptions: EventStreamOptions | undefined
    const onEvent = vi.fn()
    const apis = createGenerationApis({
      transport: {
        request: vi.fn(),
        stream: vi.fn((_url, options) => {
          streamOptions = options
          return vi.fn()
        }),
      },
    })

    apis.subscribe('42', '91', { type: 'first_frame', actionType: 'walk' }, onEvent, vi.fn())
    streamOptions?.onEvent(JSON.stringify(taskData()), 'completed')

    expect(onEvent).toHaveBeenCalledWith({
      taskId: '91',
      type: 'first_frame',
      status: 'completed',
      result: {
        type: 'first_frame',
        images: [
          { url: 'https://cdn.test/candidate-1.png' },
          { url: 'https://cdn.test/candidate-2.png' },
          { url: 'https://cdn.test/candidate-3.png' },
        ],
      },
      error: null,
    })
  })

  it.each([
    ['not-json', 'task_update 不是有效 JSON'],
    [JSON.stringify({ ...taskData(), id: 92 }), 'task_update ID 与订阅的 91 不一致'],
    [
      JSON.stringify({ ...taskData(), task_type: 'character_action' }),
      'task_update 类型与 character_template 不匹配',
    ],
    [JSON.stringify({ ...taskData(), project_id: 43 }), 'task_update 不属于当前项目'],
  ])('拒绝非法订阅事件', (payload, message) => {
    let onStreamEvent: ((data: string) => boolean) | undefined
    const apis = createGenerationApis({
      transport: {
        request: vi.fn(),
        stream: vi.fn((_url, options) => {
          onStreamEvent = options.onEvent
          return vi.fn()
        }),
      },
    })
    apis.subscribe('42', '91', { type: 'character_template' }, vi.fn(), vi.fn())

    expect(() => onStreamEvent?.(payload)).toThrow(message)
  })

  it('接受只含 task_id 的精简终态事件并保留动作帧元数据', () => {
    let onStreamEvent: ((data: string, eventName?: string) => boolean) | undefined
    const onEvent = vi.fn()
    const apis = createGenerationApis({
      transport: {
        request: vi.fn(),
        stream: vi.fn((_url, options) => {
          onStreamEvent = options.onEvent
          return vi.fn()
        }),
      },
    })
    apis.subscribe('42', '91', { type: 'complete_animation', actionType: 'walk' }, onEvent, vi.fn())

    const terminal = onStreamEvent?.(
      JSON.stringify({
        task_id: 91,
        task_type: 'character_action',
        status: 'completed',
        result: {
          type: 'character_action',
          action_type: 'walk',
          frames: actionFrames(32),
        },
      }),
      'task_update',
    )

    expect(terminal).toBe(true)
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: '91',
        status: 'completed',
        result: expect.objectContaining({
          frames: expect.arrayContaining([
            { index: 0, url: 'https://cdn.test/frame-1.png', durationMs: 100 },
          ]),
        }),
      }),
    )
  })

  it('拒绝同时存在但不一致的 task_id 与 id', () => {
    let onStreamEvent: ((data: string, eventName?: string) => boolean) | undefined
    const apis = createGenerationApis({
      transport: {
        request: vi.fn(),
        stream: vi.fn((_url, options) => {
          onStreamEvent = options.onEvent
          return vi.fn()
        }),
      },
    })
    apis.subscribe('42', '91', { type: 'character_template' }, vi.fn(), vi.fn())

    expect(() =>
      onStreamEvent?.(JSON.stringify({ ...taskData(), task_id: 91, id: 92 }), 'task_update'),
    ).toThrow('task_update 的 task_id 与 id 不一致')
  })

  it('根据 completed 事件名补全精简 payload 的终态', () => {
    let onStreamEvent: ((data: string, eventName?: string) => boolean) | undefined
    const onEvent = vi.fn()
    const apis = createGenerationApis({
      transport: {
        request: vi.fn(),
        stream: vi.fn((_url, options) => {
          onStreamEvent = options.onEvent
          return vi.fn()
        }),
      },
    })
    apis.subscribe('42', '91', { type: 'character_template' }, onEvent, vi.fn())

    expect(
      onStreamEvent?.(
        JSON.stringify({
          task_id: 91,
          task_type: 'character_image',
          result: taskData().result,
        }),
        'completed',
      ),
    ).toBe(true)
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('SSE 路由缺失时轮询任务查询直到终态', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(success(taskData({ status: 'running', result: null })))
      .mockResolvedValueOnce(success(taskData()))
    const onEvent = vi.fn()
    const apis = createGenerationApis({
      pollIntervalMs: 1,
      transport: {
        request,
        stream: vi.fn((_url, options) => {
          queueMicrotask(() =>
            options.onError(
              new EventStreamError('SSE 请求失败（HTTP 404）', false, undefined, 404),
            ),
          )
          return vi.fn()
        }),
      },
    })

    apis.subscribe('42', '91', { type: 'character_template' }, onEvent, vi.fn())

    await vi.waitFor(() =>
      expect(onEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ taskId: '91', status: 'completed' }),
      ),
    )
    expect(request).toHaveBeenCalledTimes(2)
  })
})
