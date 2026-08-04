import { describe, expect, it, vi } from 'vitest'

import { createGenerationApis, GenerationApiError } from '@/entities'

import type { MediaReference } from '../media'

const reference = (url: string) => url as MediaReference
const resolveImageSize = vi.fn(async () => ({ width: 64, height: 96 }))

function success(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function taskData(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    user_id: 7,
    project_id: 42,
    task_type: 'character_image',
    status: 'completed',
    input_payload: { num_images: 4 },
    result: {
      type: 'character_image',
      image_urls: [
        'https://cdn.test/candidate-1.png',
        'https://cdn.test/candidate-2.png',
        'https://cdn.test/candidate-3.png',
        'https://cdn.test/candidate-4.png',
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
  it('固定请求并映射四张角色母版候选', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => success(taskData()))
    const stream = vi.fn(() => vi.fn())
    const apis = createGenerationApis({
      baseUrl: 'https://api.test/',
      userId: '7',
      transport: { request, stream },
      resolveImageSize,
    })

    const generation = await apis.create({
      type: 'character_template',
      projectId: '42',
      referenceMedia: [reference('https://cdn.test/reference.png')],
      prompt: 'pixel hero',
    })

    expect(request).toHaveBeenCalledWith(
      'https://api.test/generation/image',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user_id: 7,
          project_id: 42,
          reference_image_url: 'https://cdn.test/reference.png',
          prompt: 'pixel hero',
          negative_prompt: '',
          width: 64,
          height: 96,
          num_images: 4,
        }),
      }),
    )
    expect(generation.result).toEqual({
      type: 'character_template',
      images: [
        { url: 'https://cdn.test/candidate-1.png' },
        { url: 'https://cdn.test/candidate-2.png' },
        { url: 'https://cdn.test/candidate-3.png' },
        { url: 'https://cdn.test/candidate-4.png' },
      ],
    })
    expect(resolveImageSize).toHaveBeenCalledWith('42')
  })

  it('通过动作生成接口固定请求并映射一帧动作首帧', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) =>
      success(
        taskData({
          task_type: 'character_action',
          input_payload: { num_frames: 1, action_type: 'idle' },
          result: {
            type: 'character_action',
            action_type: 'idle',
            frames: [
              { index: 0, image_url: 'https://cdn.test/first-frame.png', duration_ms: null },
            ],
          },
        }),
      ),
    )
    const apis = createGenerationApis({
      baseUrl: '',
      userId: 7,
      transport: { request, stream: vi.fn(() => vi.fn()) },
      resolveImageSize,
    })

    const generation = await apis.create({
      type: 'first_frame',
      projectId: '42',
      characterId: '5',
      outfitId: 'default',
      actionType: 'idle',
      prompt: 'stand naturally',
      referenceMedia: [reference('https://cdn.test/template.png')],
    })

    expect(request.mock.calls[0]?.[0]).toBe('/generation/action')
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      user_id: 7,
      project_id: 42,
      character_id: 5,
      action_type: 'idle',
      custom_prompt: 'stand naturally',
      reference_video_url: null,
      reference_image_urls: ['https://cdn.test/template.png'],
      num_frames: 1,
    })
    expect(generation.result).toEqual({
      type: 'first_frame',
      image: { url: 'https://cdn.test/first-frame.png' },
    })
  })

  it('以首帧请求完整动画并按后端 index 排序，当前合同固定为十六帧', async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) =>
      success(
        taskData({
          task_type: 'character_action',
          input_payload: { num_frames: 16, action_type: 'walk' },
          result: {
            type: 'character_action',
            action_type: 'walk',
            frames: actionFrames(16),
          },
        }),
      ),
    )
    const apis = createGenerationApis({
      baseUrl: '/api',
      userId: 7,
      transport: { request, stream: vi.fn(() => vi.fn()) },
      resolveImageSize,
    })

    const generation = await apis.create({
      type: 'complete_animation',
      projectId: '42',
      characterId: '5',
      outfitId: 'default',
      actionType: 'walk',
      firstFrameUrl: 'https://cdn.test/frame-1.png',
      prompt: 'move forward',
      referenceMedia: [reference('https://cdn.test/extra.png')],
    })

    expect(request.mock.calls[0]?.[0]).toBe('/api/generation/action')
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      user_id: 7,
      project_id: 42,
      character_id: 5,
      action_type: 'walk',
      custom_prompt: 'move forward',
      reference_video_url: null,
      reference_image_urls: ['https://cdn.test/frame-1.png', 'https://cdn.test/extra.png'],
      num_frames: 16,
    })
    expect(generation.result).toEqual({
      type: 'complete_animation',
      frames: Array.from({ length: 16 }, (_, index) => ({
        url: `https://cdn.test/frame-${index + 1}.png`,
      })),
    })
  })

  it('拒绝未知任务状态而不是默认为 pending', async () => {
    const request = vi.fn(async () => success(taskData({ status: 'queued' })))
    const apis = createGenerationApis({
      userId: 7,
      transport: { request, stream: vi.fn(() => vi.fn()) },
      resolveImageSize,
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
      userId: 7,
      transport: { request, stream: vi.fn(() => vi.fn()) },
      resolveImageSize,
    })

    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(
      '角色图片结果 image_urls 无效',
    )
  })

  it('订阅 task_update，映射终态并把终态关闭信号交给流传输层', () => {
    let subscribedUrl = ''
    let streamOptions:
      | {
          eventName: string
          onEvent(data: string): boolean
          onError(error: Error): void
        }
      | undefined
    const cancel = vi.fn()
    const stream = vi.fn((url: string, options: NonNullable<typeof streamOptions>) => {
      subscribedUrl = url
      streamOptions = options
      return cancel
    })
    const apis = createGenerationApis({
      baseUrl: 'https://api.test',
      userId: 7,
      transport: { request: vi.fn(), stream },
      resolveImageSize,
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
        task_id: 91,
        task_type: 'character_action',
        status: 'completed',
        result: {
          type: 'character_action',
          action_type: 'walk',
          frames: actionFrames(16),
        },
        error_message: null,
      }),
    )

    expect(subscribedUrl).toBe('https://api.test/generation/tasks/91/stream?project_id=42')
    expect(streamOptions?.eventName).toBe('task_update')
    expect(isTerminal).toBe(true)
    expect(onEvent).toHaveBeenCalledWith({
      taskId: '91',
      type: 'complete_animation',
      status: 'completed',
      result: {
        type: 'complete_animation',
        frames: Array.from({ length: 16 }, (_, index) => ({
          url: `https://cdn.test/frame-${index + 1}.png`,
        })),
      },
      error: null,
    })

    unsubscribe()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('拒绝 completed 任务返回错误动作类型', async () => {
    const request = vi.fn(async () =>
      success(
        taskData({
          task_type: 'character_action',
          input_payload: { num_frames: 16, action_type: 'walk' },
          result: {
            type: 'character_action',
            action_type: 'attack',
            frames: actionFrames(16),
          },
        }),
      ),
    )
    const apis = createGenerationApis({
      userId: 7,
      transport: { request, stream: vi.fn(() => vi.fn()) },
      resolveImageSize,
    })

    await expect(
      apis.get('42', '91', { type: 'complete_animation', actionType: 'walk' }),
    ).rejects.toThrow('动作结果类型 attack 与请求的 walk 不一致')
  })

  it('拒绝不足十六帧以及非失败状态携带错误', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        success(
          taskData({
            task_type: 'character_action',
            input_payload: { num_frames: 16, action_type: 'walk' },
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
      userId: 7,
      transport: { request, stream: vi.fn(() => vi.fn()) },
      resolveImageSize,
    })

    await expect(
      apis.get('42', '91', { type: 'complete_animation', actionType: 'walk' }),
    ).rejects.toThrow('完整动画结果必须包含 16 帧')
    await expect(apis.get('42', '91', { type: 'character_template' })).rejects.toThrow(
      'completed 任务不应携带 error_message',
    )
  })
})
