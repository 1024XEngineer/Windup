import { describe, expect, it } from 'vitest'

import type { RequestOptions } from '../types'
import { projectMockHandlers } from './project-handlers'

function dispatch(method: string, path: string, options: RequestOptions = {}): unknown {
  for (const route of projectMockHandlers) {
    if (route.method !== method) continue
    const matched = route.pattern.exec(path)
    if (matched) return route.handler(options, matched.slice(1))
  }
  throw new Error(`未找到 Mock 路由：${method} ${path}`)
}

describe('project mock contract', () => {
  it('列表按 user_id 过滤，并返回过滤后的 total', () => {
    const result = dispatch('GET', '/projects', {
      query: { page: 1, page_size: 20, user_id: 999_001 },
    }) as { data: unknown[]; total: number }

    expect(result.data).toEqual([])
    expect(result.total).toBe(0)
  })

  it('项目名称只在同一用户下判重', () => {
    const name = '用户级唯一名称测试'
    const create = (userId: number) =>
      dispatch('POST', '/projects', {
        method: 'POST',
        body: {
          user_id: userId,
          project_name: name,
          character_perspective: 1,
          directional_movement: 1,
          sprite_width: 64,
          sprite_height: 64,
        },
      }) as { code: number }

    expect(create(999_001).code).toBe(200)
    expect(create(999_002).code).toBe(200)
    expect(create(999_001).code).toBe(400)
  })
})
