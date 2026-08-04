import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCharacterApis } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('character API adapter', () => {
  it('preserves an action loop flag when saving the complete character tree', async () => {
    const backendCharacter = {
      id: 25,
      project_id: 3,
      description: null,
      reference_image_url: null,
      status: 1,
      character_data: {
        version: 1,
        outfits: [
          {
            id: 'outfit-default',
            name: 'Default',
            description: null,
            preview_url: null,
            actions: [
              {
                id: 'idle',
                type: 'idle',
                name: 'Idle',
                loop: true,
                fps: 8,
                frame_count: 1,
                frames: [
                  { index: 0, image_url: '/idle-0.png', duration_ms: 125, root_motion: null },
                ],
              },
            ],
          },
        ],
      },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(backendCharacter))
      .mockResolvedValueOnce(jsonResponse(backendCharacter))
    vi.stubGlobal('fetch', fetchMock)

    const apis = createCharacterApis()
    const character = await apis.get('25')
    await apis.update(character)

    expect(character.outfits[0]?.actions[0]?.loop).toBe(true)
    const updateRequest = fetchMock.mock.calls[1]?.[1] as RequestInit
    const updateBody = JSON.parse(String(updateRequest.body)) as {
      character_data: { outfits: Array<{ actions: Array<{ loop: boolean }> }> }
    }
    expect(updateBody.character_data.outfits[0]?.actions[0]?.loop).toBe(true)
  })
})

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
