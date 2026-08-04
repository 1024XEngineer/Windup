import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProjectApis } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('project API adapter', () => {
  it('maps backend projects without losing server pagination metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: [
            {
              id: 3,
              user_id: 7,
              project_name: '像素冒险',
              character_perspective: 1,
              directional_movement: 2,
              sprite_width: 64,
              sprite_height: 96,
              workflow_id: null,
              game_style: '明亮像素风',
              sprite_sample_url: null,
              create_at: '2026-08-01T00:00:00Z',
              update_at: '2026-08-02T00:00:00Z',
            },
          ],
          total: 21,
          page: 2,
          page_size: 10,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createProjectApis().list({ page: 2, pageSize: 10 })

    expect(result).toMatchObject({ total: 21, page: 2, pageSize: 10 })
    expect(result.items[0]).toMatchObject({
      id: '3',
      ownerId: '7',
      name: '像素冒险',
      perspective: 'side',
      directionalMovement: 'four-way',
      spriteSize: { width: 64, height: 96 },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/projects?page=2&page_size=10',
      expect.any(Object),
    )
  })
})
