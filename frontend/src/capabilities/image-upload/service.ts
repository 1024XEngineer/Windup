import type { ImageUploadPort } from './model/port'

export type ImageUploadRuntime = 'development' | 'test' | 'production'

export interface ImageUploadService {
  upload(file: File): Promise<string>
}

export interface CreateImageUploadServiceOptions {
  adapter: ImageUploadPort
  runtime: ImageUploadRuntime
}

/** 显式组合一个图片上传实现；生产配置在构造阶段拒绝 Mock。 */
export function createImageUploadService({
  adapter,
  runtime,
}: CreateImageUploadServiceOptions): ImageUploadService {
  if (runtime === 'production' && adapter.adapterKind === 'mock') {
    throw new Error('生产环境禁止使用图片上传 Mock Adapter')
  }

  return {
    upload(file) {
      return adapter.upload(file)
    },
  }
}
