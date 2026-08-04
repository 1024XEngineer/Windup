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

  it('loads every character page for a project instead of truncating after 100 items', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        listResponse(
          Array.from({ length: 100 }, (_, index) => character(index + 1)),
          101,
          1,
          100,
        ),
      )
      .mockResolvedValueOnce(listResponse([character(101)], 101, 2, 100))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createCharacterApis().listByProject('3')

    expect(result).toHaveLength(101)
    expect(result[0]?.id).toBe('1')
    expect(result[100]?.id).toBe('101')
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8000/characters?project_id=3&page=1&page_size=100',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/characters?project_id=3&page=2&page_size=100',
      expect.any(Object),
    )
  })
})

function character(id: number) {
  return {
    id,
    project_id: 3,
    description: null,
    reference_image_url: null,
    status: 1,
    character_data: { version: 1, outfits: [] },
  }
}

function listResponse(data: unknown[], total: number, page: number, pageSize: number) {
  return new Response(
    JSON.stringify({ code: 200, message: 'success', data, total, page, page_size: pageSize }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
