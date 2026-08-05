import { upload as uploadRequest } from '@/shared/api/upload'

import type { MediaApis, MediaCategory, MediaReference } from '.'

/** 后端声称上传成功、但返回数据不符合 /media/upload 契约。 */
export class MediaContractError extends Error {
  constructor(message: string) {
    super(`媒体上传响应格式错误：${message}`)
    this.name = 'MediaContractError'
  }
}

/** /media/upload 成功时 data 字段的后端原始形状。 */
interface BackendMediaUpload {
  url: string
  object_key: string
  filename: string
  content_type: string
  size: number
}

/**
 * 创建真实媒体上传适配器。这里不缓存文件、不生成本地假 URL，也不吞掉错误；
 * 只有服务端确认成功且完整响应通过运行时校验后，才交付 MediaReference。
 */
export function createMediaApis(): MediaApis {
  return {
    async upload(
      file: File,
      category: MediaCategory = 'general',
      signal?: AbortSignal,
    ): Promise<MediaReference> {
      // 与后端的 image/* 规则一致，尽早反馈可避免上传无效文件；后端仍是最终校验者。
      if (!file.type.startsWith('image/')) {
        throw new TypeError('仅支持图片文件')
      }

      const formData = new FormData()
      formData.append('file', file)

      // main 的 FastAPI 路由只把 file 声明为 File；category 未声明 Form，因此属于查询参数。
      const query = new URLSearchParams({ category })
      const result = await uploadRequest<unknown>(`/media/upload?${query}`, formData, signal)
      return parseMediaReference(result)
    },
  }
}

function parseMediaReference(value: unknown): MediaReference {
  assertBackendMediaUpload(value)

  // MediaReference 是不透明引用；当前后端明确约定用已校验的 url 回填业务数据。
  return value.url as MediaReference
}

function assertBackendMediaUpload(value: unknown): asserts value is BackendMediaUpload {
  if (!isRecord(value)) {
    throw new MediaContractError('data 必须是对象')
  }

  assertNonEmptyString(value.url, 'url')
  assertNonEmptyString(value.object_key, 'object_key')
  assertNonEmptyString(value.filename, 'filename')

  if (typeof value.content_type !== 'string' || !value.content_type.startsWith('image/')) {
    throw new MediaContractError('content_type 必须是 image/*')
  }
  if (typeof value.size !== 'number' || !Number.isInteger(value.size) || value.size < 0) {
    throw new MediaContractError('size 必须是非负整数')
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MediaContractError(`${field} 必须是非空字符串`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
