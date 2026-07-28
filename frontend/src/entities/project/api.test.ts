// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchProject, uploadImage } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadImage', () => {
  it('rejects images larger than the backend upload limit before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', {
      type: 'image/png',
    })

    await expect(uploadImage(file)).rejects.toThrow('文件超过大小上限(10485760 字节)')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Project DTO mapper', () => {
  it('把后端数字枚举转换成前端字符串领域值', async () => {
    const project = await fetchProject('1')

    expect(project.perspective).toBe('side')
    expect(project.directionalMovement).toBe('four-way')
  })
})
