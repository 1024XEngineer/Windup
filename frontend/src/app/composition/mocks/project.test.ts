import { describe, expect, it } from 'vitest'

import { createMemoryProjectRepository } from './project'

const projectInput = {
  name: '新建项目',
  perspective: 'side',
  directionalMovement: 'four-way',
  spriteSize: { width: 64, height: 64 },
  gameStyle: null,
  sampleImageUrl: null,
} as const

describe('开发环境 Project Repository', () => {
  it('创建结果可由同一个 Repository 异步读回', async () => {
    const repository = createMemoryProjectRepository()

    const created = await repository.create(projectInput)

    await expect(repository.get(created.id)).resolves.toEqual(created)
    await expect(repository.list({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      items: expect.arrayContaining([created]),
      total: 3,
      page: 1,
      pageSize: 20,
    })
  })

  it('每次应用组合得到独立存储，不在测试或会话之间泄漏', async () => {
    const first = createMemoryProjectRepository()
    const second = createMemoryProjectRepository()

    await first.create(projectInput)

    await expect(first.list()).resolves.toMatchObject({ total: 3 })
    await expect(second.list()).resolves.toMatchObject({ total: 2 })
  })

  it('删除后同一 Repository 不再返回该项目', async () => {
    const repository = createMemoryProjectRepository()
    const created = await repository.create(projectInput)

    await repository.remove(created.id)

    await expect(repository.get(created.id)).rejects.toThrow('项目不存在')
  })
})
