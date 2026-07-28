import type { ImageGenerationPort } from './model/port'
import type { GenerateImagesInput, GeneratedImage } from './model/types'

export type FrontendRuntime = 'development' | 'test' | 'production'

export interface ImageGenerationService {
  generate(input: GenerateImagesInput): Promise<GeneratedImage[]>
}

export interface CreateImageGenerationServiceOptions {
  adapter: ImageGenerationPort
  runtime: FrontendRuntime
}

/** 显式组合一个图片生成实现；生产配置在构造阶段拒绝 Mock。 */
export function createImageGenerationService({
  adapter,
  runtime,
}: CreateImageGenerationServiceOptions): ImageGenerationService {
  if (runtime === 'production' && adapter.adapterKind === 'mock') {
    throw new Error('生产环境禁止使用图片生成 Mock Adapter')
  }

  return {
    generate(input) {
      return adapter.generate(input)
    },
  }
}
