import type { MockRoute } from './types'

/**
 * mock 扮演后端，字段与 ProjectOut 严格一致（含 snake_case），不写成 camelCase。
 * 对照 web/api/project.py（PR #57）。
 */
interface ProjectDto {
  id: number
  user_id: number
  workflow_id: number | null
  project_name: string
  character_perspective: number
  directional_movement: number
  sprite_width: number
  sprite_height: number
  game_style: string | null
  sprite_sample_url: string | null
  create_at: string
  update_at: string
}

let nextId = 3
const store: ProjectDto[] = [
  {
    id: 1,
    user_id: 1,
    workflow_id: null,
    project_name: '像素小骑士',
    character_perspective: 1,
    directional_movement: 2,
    sprite_width: 64,
    sprite_height: 64,
    game_style: '16-bit 像素、暖色调',
    sprite_sample_url: null,
    create_at: '2026-07-25T10:00:00Z',
    update_at: '2026-07-25T10:00:00Z',
  },
  {
    id: 2,
    user_id: 1,
    workflow_id: null,
    project_name: '森林精灵',
    character_perspective: 2,
    directional_movement: 1,
    sprite_width: 64,
    sprite_height: 64,
    game_style: null,
    sprite_sample_url: null,
    create_at: '2026-07-26T09:30:00Z',
    update_at: '2026-07-26T09:30:00Z',
  },
]

export const projectMockHandlers: MockRoute[] = [
  {
    method: 'GET',
    pattern: /^\/projects$/,
    handler: (options) => {
      const page = Number(options.query?.page ?? 1)
      const pageSize = Number(options.query?.page_size ?? 20)
      const rawUserId = options.query?.user_id
      const userId = rawUserId === undefined ? null : Number(rawUserId)
      const visible = (userId === null ? store : store.filter((item) => item.user_id === userId))
        // 接口文档：列表按项目 ID 倒序，最新创建的在前
        .slice()
        .sort((a, b) => b.id - a.id)
      const start = (page - 1) * pageSize
      return {
        code: 200,
        message: 'success',
        data: visible.slice(start, start + pageSize),
        total: visible.length,
        page,
        page_size: pageSize,
      }
    },
  },
  {
    method: 'GET',
    pattern: /^\/projects\/(\d+)$/,
    handler: (_options, params) => {
      const found = store.find((item) => item.id === Number(params[0]))
      return found
        ? { code: 200, message: 'success', data: found }
        : { code: 404, message: '项目不存在', data: null }
    },
  },
  {
    method: 'POST',
    pattern: /^\/projects$/,
    handler: (options) => {
      const body = options.body as Partial<ProjectDto>
      const userId = body.user_id ?? 1
      if (
        store.some((item) => item.user_id === userId && item.project_name === body.project_name)
      ) {
        return { code: 400, message: '项目名称已存在', data: null }
      }
      const now = new Date().toISOString()
      const created: ProjectDto = {
        id: nextId++,
        user_id: userId,
        workflow_id: body.workflow_id ?? null,
        project_name: body.project_name ?? '未命名项目',
        character_perspective: body.character_perspective ?? 1,
        directional_movement: body.directional_movement ?? 1,
        sprite_width: body.sprite_width ?? 64,
        sprite_height: body.sprite_height ?? 64,
        game_style: body.game_style ?? null,
        sprite_sample_url: body.sprite_sample_url ?? null,
        create_at: now,
        update_at: now,
      }
      store.push(created)
      return { code: 200, message: '创建成功', data: created }
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/projects\/(\d+)$/,
    handler: (_options, params) => {
      const index = store.findIndex((item) => item.id === Number(params[0]))
      if (index === -1) return { code: 404, message: '项目不存在', data: null }
      store.splice(index, 1)
      return { code: 200, message: '删除成功', data: null }
    },
  },
]
