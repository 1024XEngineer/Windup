const projectDtos = [
  {
    id: 42,
    user_id: 7,
    workflow_id: null,
    project_name: '点灯人 · MVP',
    character_perspective: 1,
    directional_movement: 2,
    sprite_width: 64,
    sprite_height: 64,
    game_style: '低饱和像素绘本',
    sprite_sample_url: null,
    create_at: '2026-08-01T08:00:00Z',
    update_at: '2026-08-04T10:30:00Z',
  },
  {
    id: 99,
    user_id: 7,
    workflow_id: null,
    project_name: '空白海岸',
    character_perspective: 2,
    directional_movement: 3,
    sprite_width: 128,
    sprite_height: 128,
    game_style: null,
    sprite_sample_url: null,
    create_at: '2026-08-02T08:00:00Z',
    update_at: '2026-08-03T09:00:00Z',
  },
]

const characterDtos = [
  {
    id: 51,
    project_id: 42,
    name: '轻装信使',
    description: '负责远途投递的年轻信使',
    reference_image_url: 'https://cdn.windup.test/messenger-reference.png',
    character_data: {
      version: 1,
      outfits: [
        {
          id: 'outfit-default',
          name: '常态造型',
          description: '旅行装束',
          preview_url: 'https://cdn.windup.test/messenger-outfit.png',
          actions: [
            {
              id: 'idle',
              type: 'idle',
              name: '呼吸待机',
              loop: true,
              fps: 8,
              frame_count: 2,
              frames: [
                {
                  index: 0,
                  image_url: 'https://cdn.windup.test/idle-01.png',
                  duration_ms: null,
                },
                {
                  index: 1,
                  image_url: 'https://cdn.windup.test/idle-02.png',
                  duration_ms: 125,
                },
              ],
            },
            {
              id: 'walk',
              type: 'walk',
              name: '行走',
              loop: true,
              fps: 10,
              frame_count: 3,
              frames: [
                {
                  index: 2,
                  image_url: 'https://cdn.windup.test/walk-03.png',
                  duration_ms: 100,
                },
                {
                  index: 0,
                  image_url: 'https://cdn.windup.test/walk-01.png',
                  duration_ms: null,
                },
                {
                  index: 1,
                  image_url: 'https://cdn.windup.test/walk-02.png',
                  duration_ms: 100,
                },
              ],
            },
          ],
        },
      ],
    },
    status: 1,
  },
  {
    id: 52,
    project_id: 42,
    name: '待定角色',
    description: null,
    reference_image_url: null,
    character_data: {
      version: 1,
      outfits: [
        {
          id: 'outfit-draft',
          name: '未命名造型',
          description: null,
          preview_url: null,
          actions: [],
        },
      ],
    },
    status: 1,
  },
]

function response(data: unknown, message = 'success') {
  return new Response(JSON.stringify({ code: 200, message, data }), {
    headers: { 'content-type': 'application/json' },
  })
}

function listResponse(data: unknown[], page: number, pageSize: number, total: number) {
  return new Response(
    JSON.stringify({
      code: 200,
      message: 'success',
      data,
      total,
      page,
      page_size: pageSize,
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

/** 测试环境中的 HTTP 服务替身；生产代码和生产包不会导入这里。 */
export interface ProjectAssetsBackendOptions {
  projectCount?: number
  characterCount?: number
}

function projectFixtures(count: number) {
  const fixtures = structuredClone(projectDtos.slice(0, count))
  for (let index = fixtures.length; index < count; index += 1) {
    fixtures.push({
      ...structuredClone(projectDtos[0]),
      id: 1_000 + index,
      project_name: `分页项目 ${index + 1}`,
    })
  }
  return fixtures
}

function characterFixtures(count: number) {
  const fixtures = structuredClone(characterDtos.slice(0, count))
  for (let index = fixtures.length; index < count; index += 1) {
    fixtures.push({
      ...structuredClone(characterDtos[0]),
      id: 2_000 + index,
      name: `分页角色 ${index + 1}`,
    })
  }
  return fixtures
}

export function createProjectAssetsBackend({
  projectCount = projectDtos.length,
  characterCount = characterDtos.length,
}: ProjectAssetsBackendOptions = {}) {
  let projects = projectFixtures(projectCount)
  const characters = characterFixtures(characterCount)
  const requests: Request[] = []

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    requests.push(request.clone())
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/projects') {
      const page = Number(url.searchParams.get('page') ?? 1)
      const pageSize = Number(url.searchParams.get('page_size') ?? 20)
      const start = (page - 1) * pageSize
      return listResponse(projects.slice(start, start + pageSize), page, pageSize, projects.length)
    }

    if (url.pathname.startsWith('/projects/')) {
      const projectId = Number(url.pathname.split('/').at(-1))
      const project = projects.find((item) => item.id === projectId)
      if (request.method === 'GET' && project) return response(project)
      if (request.method === 'DELETE' && project) {
        projects = projects.filter((item) => item.id !== projectId)
        return response(null, '删除成功')
      }
      return new Response(JSON.stringify({ code: 404, message: '项目不存在', data: null }))
    }

    if (request.method === 'GET' && url.pathname === '/characters') {
      const projectId = Number(url.searchParams.get('project_id'))
      const page = Number(url.searchParams.get('page') ?? 1)
      const pageSize = Number(url.searchParams.get('page_size') ?? 20)
      const projectCharacters = characters.filter((item) => item.project_id === projectId)
      const start = (page - 1) * pageSize
      return listResponse(
        projectCharacters.slice(start, start + pageSize),
        page,
        pageSize,
        projectCharacters.length,
      )
    }

    if (request.method === 'GET' && url.pathname.startsWith('/characters/')) {
      const characterId = Number(url.pathname.split('/').at(-1))
      const character = characters.find((item) => item.id === characterId)
      if (character) return response(character)
      return new Response(JSON.stringify({ code: 404, message: '角色不存在', data: null }))
    }

    throw new Error(`测试后端未处理 ${request.method} ${url.pathname}`)
  }

  return { fetch, requests }
}
