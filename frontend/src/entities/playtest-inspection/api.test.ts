import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPlaytestInspectionApis } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Playtest inspection API adapter', () => {
  it('treats the backend business 404 as an empty current inspection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 404, message: '尚未核验', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(
      createPlaytestInspectionApis().get({
        characterId: '25',
        outfitId: 'default',
        actionId: 'idle',
      }),
    ).resolves.toBeNull()
  })

  it('sends stable target IDs and maps the saved inspection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          message: '核验已保存',
          data: {
            id: 9,
            character_id: 25,
            outfit_id: 'default',
            action_id: 'idle',
            status: 'issues_found',
            create_at: '2026-08-04T00:00:00Z',
            update_at: '2026-08-04T00:01:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const saved = await createPlaytestInspectionApis().save({
      characterId: '25',
      outfitId: 'default',
      actionId: 'idle',
      status: 'issues_found',
    })

    expect(saved).toMatchObject({ id: '9', characterId: '25', status: 'issues_found' })
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      character_id: 25,
      outfit_id: 'default',
      action_id: 'idle',
      status: 'issues_found',
    })
  })
})
