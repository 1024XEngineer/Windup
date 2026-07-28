import { ApiError, uploadFile } from '@/shared/api'
import type { ImageUploadPort } from '../model/port'

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * 后端 POST /upload/image Adapter。
 * 不手动设置 Content-Type；底层会让浏览器为 multipart 自动补 boundary。
 */
export const httpImageUploadAdapter: ImageUploadPort = {
  adapterKind: 'real',
  async upload(file) {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      throw new ApiError('仅支持 jpg/png/webp/gif 图片', 400)
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new ApiError(`文件超过大小上限(${MAX_IMAGE_UPLOAD_BYTES} 字节)`, 400)
    }

    const payload = await uploadFile<{ url: string }>('/upload/image', file)
    return payload.url
  },
}
