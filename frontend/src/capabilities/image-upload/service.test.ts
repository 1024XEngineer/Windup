import { describe, expect, it } from 'vitest'

import type { ImageUploadPort } from './index'
import { createImageUploadService } from './index'

describe('图片上传能力服务', () => {
  it('把文件交给注入的 Adapter，并返回上传后的 URL', async () => {
    const file = new File(['image'], 'reference.png', { type: 'image/png' })
    let received: File | null = null
    const adapter: ImageUploadPort = {
      adapterKind: 'mock',
      async upload(candidate) {
        received = candidate
        return 'https://img.test/reference.png'
      },
    }
    const service = createImageUploadService({ adapter, runtime: 'development' })

    await expect(service.upload(file)).resolves.toBe('https://img.test/reference.png')
    expect(received).toBe(file)
  })

  it('生产 runtime 在执行前拒绝 Mock Adapter', () => {
    const adapter: ImageUploadPort = {
      adapterKind: 'mock',
      async upload() {
        return 'https://img.test/should-not-run.png'
      },
    }

    expect(() => createImageUploadService({ adapter, runtime: 'production' })).toThrow(
      '生产环境禁止使用图片上传 Mock Adapter',
    )
  })

  it('生产 runtime 接受显式 Real Adapter', async () => {
    const file = new File(['image'], 'reference.png', { type: 'image/png' })
    const adapter: ImageUploadPort = {
      adapterKind: 'real',
      async upload() {
        return 'https://cdn.test/reference.png'
      },
    }
    const service = createImageUploadService({ adapter, runtime: 'production' })

    await expect(service.upload(file)).resolves.toBe('https://cdn.test/reference.png')
  })
})
