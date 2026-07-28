import { describe, expect, it } from 'vitest'

import type { GenerateImagesInput, ImageGenerationPort } from './index'
import { createImageGenerationService } from './index'

const input: GenerateImagesInput = {
  projectId: 'project-42',
  prompt: '像素骑士挥剑',
  referenceImageUrls: ['https://img.test/reference.png'],
}

describe('图片生成能力服务', () => {
  it('把业务输入交给注入的 Adapter，并返回它产生的图片', async () => {
    let received: GenerateImagesInput | null = null
    const adapter: ImageGenerationPort = {
      adapterKind: 'mock',
      async generate(candidate) {
        received = candidate
        return [{ url: 'https://img.test/generated.png' }]
      },
    }
    const service = createImageGenerationService({ adapter, runtime: 'development' })

    await expect(service.generate(input)).resolves.toEqual([
      { url: 'https://img.test/generated.png' },
    ])
    expect(received).toEqual(input)
  })

  it('生产 runtime 在执行前拒绝 Mock Adapter', () => {
    const adapter: ImageGenerationPort = {
      adapterKind: 'mock',
      async generate() {
        return [{ url: 'https://img.test/should-not-run.png' }]
      },
    }

    expect(() => createImageGenerationService({ adapter, runtime: 'production' })).toThrow(
      '生产环境禁止使用图片生成 Mock Adapter',
    )
  })

  it('生产 runtime 接受显式 Real Adapter', async () => {
    const adapter: ImageGenerationPort = {
      adapterKind: 'real',
      async generate() {
        return [{ url: 'https://cdn.test/real.png' }]
      },
    }
    const service = createImageGenerationService({ adapter, runtime: 'production' })

    await expect(service.generate(input)).resolves.toEqual([{ url: 'https://cdn.test/real.png' }])
  })
})
