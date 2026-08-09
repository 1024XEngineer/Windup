import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MediaReference } from '../media'
import { createGenerationApis } from './api'
import { EventStreamError, type EventStreamOptions } from '@/shared/api/stream'

afterEach(() => {
  vi.unstubAllGlobals()
})

function generationTaskResponse() {
  return new Response(
    JSON.stringify({
      code: 200,
      message: 'success',
      data: {
        id: 11,
        user_id: 1,
        project_id: 7,
        task_type: 'character_action',
        status: 'pending',
        input_payload: {},
        result: null,
        error_message: null,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('generation API adapter', () => {
  it('requests 32 frames for a complete animation while keeping first-frame generation at one frame', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => generationTaskResponse())
    vi.stubGlobal('fetch', fetchMock)
    const api = createGenerationApis()

    await api.create({
      type: 'character_action',
      projectId: '7',
      characterId: '9',
      outfitId: 'outfit-9-default',
      actionType: 'walk',
      prompt: null,
      firstFrameUrl: null,
      numFrames: 1,
      referenceMedia: [],
    })
    await api.create({
      type: 'character_action',
      projectId: '7',
      characterId: '9',
      outfitId: 'outfit-9-default',
      actionType: 'walk',
      firstFrameUrl: 'https://cdn.example.com/first-frame.png',
      prompt: null,
      numFrames: 32,
      referenceMedia: ['media-reference-1' as MediaReference],
    })

    const firstFramePayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >
    const completeAnimationPayload = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as Record<string, unknown>
    expect(firstFramePayload.num_frames).toBe(1)
    expect(firstFramePayload).not.toHaveProperty('user_id')
    expect(completeAnimationPayload.num_frames).toBe(32)
    expect(completeAnimationPayload.reference_video_url).toBeNull()
    expect(completeAnimationPayload.reference_image_urls).toEqual([
      'https://cdn.example.com/first-frame.png',
      'media-reference-1',
    ])
  })

  it('maps the SSE id field to the frontend taskId', () => {
    let streamOptions: EventStreamOptions | undefined
    const close = vi.fn()
    const stream = vi.fn((_url: string, options: EventStreamOptions) => {
      streamOptions = options
      return close
    })
    const onEvent = vi.fn()
    createGenerationApis({ stream }).subscribe('7', '11', onEvent)

    streamOptions?.onEvent(
      JSON.stringify({
        id: 11,
        task_type: 'character_action',
        status: 'running',
        result: null,
        error_message: null,
      }),
    )

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: '11',
        type: 'character_action',
        status: 'running',
      }),
    )
    expect(close).not.toHaveBeenCalled()
  })

  it('falls back to task polling when the SSE route is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(generationTaskResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: {
              id: 11,
              user_id: 1,
              project_id: 7,
              task_type: 'character_action',
              status: 'completed',
              input_payload: {},
              result: {
                action_type: 'walk',
                frames: [{ index: 0, image_url: 'https://cdn.test/frame.png', duration_ms: 100 }],
              },
              error_message: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const stream = vi.fn((_url: string, options: EventStreamOptions) => {
      queueMicrotask(() =>
        options.onError(new EventStreamError('SSE 请求失败（HTTP 404）', false, undefined, 404)),
      )
      return vi.fn()
    })
    const onEvent = vi.fn()
    const onError = vi.fn()

    createGenerationApis({ stream, pollIntervalMs: 0 }).subscribe('7', '11', onEvent, onError)

    await vi.waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: '11', status: 'completed' }),
      ),
    )
    expect(onError).not.toHaveBeenCalled()
  })
})
