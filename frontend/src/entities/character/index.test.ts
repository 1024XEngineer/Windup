import { afterEach, describe, expect, it, vi } from 'vitest'

const characterDto = {
  id: 51,
  project_id: 42,
  workflow_run_id: 77,
  name: '轻装信使',
  description: null,
  reference_image_url: 'https://cdn.windup.test/reference.png',
  character_data: {
    version: 2,
    outfits: [
      {
        id: 'outfit-default',
        name: '常态造型',
        description: '旅行装束',
        preview_url: 'https://cdn.windup.test/outfit.png',
        model_3d_url: 'https://cdn.windup.test/outfit.glb',
        actions: [
          {
            id: 'walk',
            type: 'walk',
            name: '行走',
            loop: true,
            fps: 10,
            frame_count: 2,
            frames: [
              {
                index: 1,
                image_url: 'https://cdn.windup.test/walk-02.png',
                duration_ms: 120,
              },
              {
                index: 0,
                image_url: 'https://cdn.windup.test/walk-01.png',
                duration_ms: null,
              },
            ],
          },
        ],
      },
    ],
  },
  status: 1,
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadCharacterApis(fetchFn: typeof fetch) {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', fetchFn)
  return (await import('./index')).characterApis
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('characterApis', () => {
  it('maps an explicit draft publication status', async () => {
    const characterApis = await loadCharacterApis(async () =>
      jsonResponse({ ...characterDto, status: 0 }),
    )

    await expect(characterApis.get('51')).resolves.toMatchObject({ status: 0 })
  })

  it('preserves the Character page when the backend adds an unknown publication status', async () => {
    const characterApis = await loadCharacterApis(async () =>
      jsonResponse({ ...characterDto, status: 2 }),
    )

    await expect(characterApis.get('51')).resolves.toMatchObject({ status: 'unknown' })
  })

  it('maps the paged Character tree and sends the publication status query', async () => {
    let requestUrl = ''
    const characterApis = await loadCharacterApis(async (input) => {
      requestUrl = String(input)
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: [characterDto],
          total: 1,
          page: 1,
          page_size: 20,
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })

    const page = await characterApis.listByProject('42', { page: 1, pageSize: 20, status: 1 })

    expect(requestUrl).toBe(
      'https://api.windup.test/characters?project_id=42&page=1&page_size=20&status=1',
    )
    expect(page).toEqual({
      items: [
        {
          id: '51',
          projectId: '42',
          workflowRunId: '77',
          name: '轻装信使',
          description: null,
          referenceImageUrl: 'https://cdn.windup.test/reference.png',
          dataVersion: 2,
          status: 1,
          outfits: [
            {
              id: 'outfit-default',
              characterId: '51',
              name: '常态造型',
              description: '旅行装束',
              previewUrl: 'https://cdn.windup.test/outfit.png',
              model3dUrl: 'https://cdn.windup.test/outfit.glb',
              actions: [
                {
                  id: 'walk',
                  outfitId: 'outfit-default',
                  type: 'walk',
                  name: '行走',
                  loop: true,
                  fps: 10,
                  frameCount: 2,
                  frames: [
                    {
                      index: 1,
                      imageUrl: 'https://cdn.windup.test/walk-02.png',
                      durationMs: 120,
                    },
                    {
                      index: 0,
                      imageUrl: 'https://cdn.windup.test/walk-01.png',
                      durationMs: null,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
  })

  it('forwards a cancellation signal for project character pages', async () => {
    let requestSignal: AbortSignal | null | undefined
    const characterApis = await loadCharacterApis(async (_input, init) => {
      requestSignal = init?.signal
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: [],
          total: 0,
          page: 1,
          page_size: 6,
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    const controller = new AbortController()

    await characterApis.listByProject('42', {
      page: 1,
      pageSize: 6,
      signal: controller.signal,
    })

    expect(requestSignal).toBe(controller.signal)
  })

  it('serializes CreateCharacterInput without inventing generated assets', async () => {
    let request: Request | undefined
    const characterApis = await loadCharacterApis(async (input, init) => {
      request = new Request(input, init)
      return jsonResponse(characterDto)
    })

    await characterApis.create({
      projectId: '42',
      workflowRunId: '77',
      name: '轻装信使',
      description: '项目角色',
      referenceImageUrl: null,
    })

    expect(request?.method).toBe('POST')
    await expect(request?.json()).resolves.toEqual({
      project_id: 42,
      workflow_run_id: 77,
      name: '轻装信使',
      description: '项目角色',
      reference_image_url: null,
    })
  })

  it('requests one Character by its backend resource path', async () => {
    let requestUrl = ''
    const characterApis = await loadCharacterApis(async (input) => {
      requestUrl = String(input)
      return jsonResponse(characterDto)
    })

    await characterApis.get('51')

    expect(requestUrl).toBe('https://api.windup.test/characters/51')
  })

  it('uses the access-token provider registered at the shared HTTP boundary', async () => {
    let authorization: string | null = null
    const characterApis = await loadCharacterApis(async (input, init) => {
      authorization = new Request(input, init).headers.get('authorization')
      return jsonResponse(characterDto)
    })
    const { registerApiAccessTokenProvider } = await import('@/shared/api')
    const unregister = registerApiAccessTokenProvider(() => 'character-access-token')

    await characterApis.get('51')
    unregister()

    expect(authorization).toBe('Bearer character-access-token')
  })

  it('serializes a complete Character tree for PATCH', async () => {
    let request: Request | undefined
    const characterApis = await loadCharacterApis(async (input, init) => {
      request = new Request(input, init)
      return jsonResponse(characterDto)
    })
    const character = await characterApis.get('51')

    await characterApis.update(character)

    expect(request?.method).toBe('PATCH')
    expect(request?.url).toBe('https://api.windup.test/characters/51')
    await expect(request?.json()).resolves.toEqual({
      name: '轻装信使',
      description: null,
      reference_image_url: 'https://cdn.windup.test/reference.png',
      character_data: {
        version: 2,
        outfits: characterDto.character_data.outfits,
      },
    })
  })

  it('defaults model3dUrl to null when the outfit has no 3D asset yet', async () => {
    const characterApis = await loadCharacterApis(async () =>
      jsonResponse({
        ...characterDto,
        character_data: {
          version: 2,
          outfits: [{ ...characterDto.character_data.outfits[0], model_3d_url: undefined }],
        },
      }),
    )

    const character = await characterApis.get('51')

    expect(character.outfits[0]?.model3dUrl).toBeNull()
  })

  it('deletes one Character through the backend resource path', async () => {
    let request: Request | undefined
    const characterApis = await loadCharacterApis(async (input, init) => {
      request = new Request(input, init)
      return jsonResponse(null)
    })

    await expect(characterApis.remove('51')).resolves.toBeUndefined()
    expect(request?.url).toBe('https://api.windup.test/characters/51')
    expect(request?.method).toBe('DELETE')
  })
})
