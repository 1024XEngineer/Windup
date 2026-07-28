import type { GenerateImagesInput, GeneratedImage } from './types'

/** 图片生成 Adapter 来源，用于阻止生产配置误接开发 Mock。 */
export type ImageGenerationAdapterKind = 'real' | 'mock'

/**
 * 图片生成的业务能力端口。
 * Real Adapter 将来负责 HTTP DTO 映射，调用方只依赖这里的业务形状。
 */
export interface ImageGenerationPort {
  readonly adapterKind: ImageGenerationAdapterKind
  generate(input: GenerateImagesInput): Promise<GeneratedImage[]>
}
