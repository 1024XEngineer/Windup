import { describe, expect, it } from 'vitest'

import { fetchProject } from './api'

describe('Project DTO mapper', () => {
  it('把后端数字枚举转换成前端字符串领域值', async () => {
    const project = await fetchProject('1')

    expect(project.perspective).toBe('side')
    expect(project.directionalMovement).toBe('four-way')
  })
})
