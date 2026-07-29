import type { MediaReference } from '@/entities'
import { HttpRequestError, postMultipart } from '@/shared/api'
import type { ImageUploadPort } from '../model/port'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const MAX_ERROR_DETAIL_LENGTH = 200

function readableDetail(detail: string): string | null {
  const normalized = detail.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return null
  if (normalized.length <= MAX_ERROR_DETAIL_LENGTH) return normalized
  return `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH)}…`
}

function errorDetail(body: unknown): string | null {
  if (typeof body === 'string') return readableDetail(body)
  if (!isRecord(body)) return null
  if (typeof body.message === 'string') {
    const message = readableDetail(body.message)
    if (message) return message
  }
  if (typeof body.detail === 'string') return readableDetail(body.detail)
  if (Array.isArray(body.detail)) {
    const messages = body.detail.flatMap((item) =>
      isRecord(item) && typeof item.msg === 'string' ? [item.msg] : [],
    )
    return readableDetail(messages.join('；'))
  }
  return null
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function createImageUploadAdapter(): ImageUploadPort {
  return {
    async upload(file) {
      if (!file.type.startsWith('image/')) throw new Error('仅支持 image/* 文件')

      const form = new FormData()
      form.append('file', file)
      let response: unknown
      try {
        response = await postMultipart('/media/upload?category=reference-image', form)
      } catch (error) {
        if (!(error instanceof HttpRequestError)) throw error
        const detail = errorDetail(error.responseBody)
        throw new Error(`图片上传请求失败（HTTP ${error.status}）${detail ? `：${detail}` : ''}`, {
          cause: error,
        })
      }

      if (!isRecord(response) || response.code !== 200) {
        const detail = errorDetail(response)
        throw new Error(`图片上传失败${detail ? `：${detail}` : ''}`)
      }

      const data = response.data
      const url = isRecord(data) ? data.url : undefined
      if (!isHttpUrl(url)) throw new Error('图片上传响应缺少有效 URL')
      return url as MediaReference
    },
  }
}
