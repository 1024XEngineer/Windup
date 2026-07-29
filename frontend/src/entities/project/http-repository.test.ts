import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())
const requestListMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/api', () => ({
  request: requestMock,
  requestList: requestListMock,
}))

import { createHttpProjectRepository } from './http-repository'

const dto = {
  id: 42,
  user_id: 7,
  workflow_id: null,
  project_name: '像素项目',
  character_perspective: 1,
  directional_movement: 2,
  sprite_width: 64,
  sprite_height: 64,
  game_style: null,
  sprite_sample_url: null,
  create_at: '2026-07-28T08:00:00.000Z',
  update_at: '2026-07-28T08:00:00.000Z',
}

beforeEach(() => {
  requestMock.mockReset()
  requestListMock.mockReset()
})

describe('Project HTTP Repository', () => {
  it('把后端数字枚举转换成前端领域值', async () => {
    requestMock.mockResolvedValue(dto)
    const repository = createHttpProjectRepository({ currentUserId: 7 })

    expect(repository.adapterKind).toBe('candidate')
    await expect(repository.get('42')).resolves.toMatchObject({
      id: '42',
      perspective: 'side',
      directionalMovement: 'four-way',
    })
    expect(requestMock).toHaveBeenCalledWith('/projects/42')
  })

  it('由应用组合提供当前用户，并映射分页字段', async () => {
    requestListMock.mockResolvedValue({
      items: [dto],
      total: 1,
      page: 2,
      pageSize: 5,
    })
    const repository = createHttpProjectRepository({ currentUserId: 7 })

    await expect(repository.list({ page: 2, pageSize: 5 })).resolves.toMatchObject({
      items: [{ id: '42' }],
      total: 1,
    })
    expect(requestListMock).toHaveBeenCalledWith('/projects', {
      query: { page: 2, page_size: 5, user_id: 7 },
    })
  })
})
