import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MediaReference } from '../media'
import { createGenerationApis } from './api'

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
      type: 'first_frame',
      projectId: '7',
      characterId: '9',
      outfitId: 'outfit-9-default',
      actionType: 'walk',
      prompt: null,
      referenceMedia: [],
    })
    await api.create({
      type: 'complete_animation',
      projectId: '7',
      characterId: '9',
      outfitId: 'outfit-9-default',
      actionType: 'walk',
      firstFrameUrl: 'https://cdn.example.com/first-frame.png',
      prompt: null,
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
    expect(completeAnimationPayload.num_frames).toBe(32)
  })
})
