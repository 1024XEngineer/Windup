import { afterEach, describe, expect, it, vi } from 'vitest'

const projectDto = {
  id: 42,
  workflow_id: 9,
  project_name: '点灯人',
  character_perspective: 3,
  directional_movement: 2,
  sprite_width: 64,
  sprite_height: 96,
  game_style: null,
  sprite_sample_url: 'https://cdn.windup.test/style.png',
  create_at: '2026-08-01T08:00:00Z',
  update_at: '2026-08-02T09:30:00Z',
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadProjectApis(fetchFn: typeof fetch) {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', fetchFn)
  return import('./index')
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('projectApis', () => {
  it('maps the paged Project response and pagination query', async () => {
    let request: Request | undefined
    const { projectApis } = await loadProjectApis(async (input, init) => {
      request = new Request(input, init)
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: [projectDto],
          total: 21,
          page: 2,
          page_size: 10,
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })

    await expect(projectApis.list({ page: 2, pageSize: 10 })).resolves.toEqual({
      items: [
        {
          id: '42',
          workflowId: '9',
          name: '点灯人',
          perspective: 'isometric',
          directionalMovement: 'four-way',
          spriteSize: { width: 64, height: 96 },
          gameStyle: null,
          sampleImageUrl: 'https://cdn.windup.test/style.png',
          createdAt: '2026-08-01T08:00:00Z',
          updatedAt: '2026-08-02T09:30:00Z',
        },
      ],
      total: 21,
      page: 2,
      pageSize: 10,
    })
    expect(request?.url).toBe('https://api.windup.test/projects?page=2&page_size=10')
  })

  it('serializes CreateProjectInput to the backend request body', async () => {
    let request: Request | undefined
    const { projectApis } = await loadProjectApis(async (input, init) => {
      request = new Request(input, init)
      return jsonResponse(projectDto)
    })

    await projectApis.create({
      workflowId: '9',
      name: '点灯人',
      perspective: 'isometric',
      directionalMovement: 'four-way',
      spriteSize: { width: 64, height: 96 },
      gameStyle: null,
      sampleImageUrl: 'https://cdn.windup.test/style.png',
    })

    expect(request?.method).toBe('POST')
    // 请求体不含 user_id：归属由后端从 access token 取，见 CreateProjectInput 的注释。
    await expect(request?.json()).resolves.toEqual({
      workflow_id: 9,
      project_name: '点灯人',
      character_perspective: 3,
      directional_movement: 2,
      sprite_width: 64,
      sprite_height: 96,
      game_style: null,
      sprite_sample_url: 'https://cdn.windup.test/style.png',
    })
  })

  it('requests one Project by its backend resource path', async () => {
    let requestUrl = ''
    const { projectApis } = await loadProjectApis(async (input) => {
      requestUrl = String(input)
      return jsonResponse(projectDto)
    })

    await projectApis.get('42')

    expect(requestUrl).toBe('https://api.windup.test/projects/42')
  })

  it('uses the access-token provider registered at the shared HTTP boundary', async () => {
    let authorization: string | null = null
    const { projectApis } = await loadProjectApis(async (input, init) => {
      authorization = new Request(input, init).headers.get('authorization')
      return jsonResponse(projectDto)
    })
    const { registerApiAccessTokenProvider } = await import('@/shared/api')
    const unregister = registerApiAccessTokenProvider(() => 'project-access-token')

    await projectApis.get('42')
    unregister()

    expect(authorization).toBe('Bearer project-access-token')
  })

  it('deletes one Project through the backend resource path', async () => {
    let request: Request | undefined
    const { projectApis } = await loadProjectApis(async (input, init) => {
      request = new Request(input, init)
      return jsonResponse(null)
    })

    await expect(projectApis.remove('42')).resolves.toBeUndefined()
    expect(request?.url).toBe('https://api.windup.test/projects/42')
    expect(request?.method).toBe('DELETE')
  })

  it('maps the backend project-name conflict contract to a stable domain error', async () => {
    const { ProjectNameConflictError, projectApis } = await loadProjectApis(
      async () =>
        new Response(JSON.stringify({ code: 400, message: '项目名称已存在', data: null }), {
          headers: { 'content-type': 'application/json' },
        }),
    )

    await expect(
      projectApis.create({
        name: '点灯人',
        perspective: 'side',
        directionalMovement: 'single',
        spriteSize: { width: 256, height: 256 },
      }),
    ).rejects.toBeInstanceOf(ProjectNameConflictError)
  })

  it('maps the backend in-use project contract to a stable domain error', async () => {
    const { ProjectHasCharactersError, projectApis } = await loadProjectApis(
      async () =>
        new Response(
          JSON.stringify({ code: 400, message: '项目下仍有角色，无法删除', data: null }),
          { headers: { 'content-type': 'application/json' } },
        ),
    )

    await expect(projectApis.remove('42')).rejects.toBeInstanceOf(ProjectHasCharactersError)
  })
})
