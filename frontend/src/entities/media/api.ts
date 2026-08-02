import type { MediaApis, MediaCategory, MediaReference } from '.'

import { upload as uploadRequest } from '@/shared/api'

/* ─── 后端 DTO ─── */

interface BackendMediaUpload {
  url: string
  object_key: string
  filename: string
  content_type: string
  size: number
}

/* ─── 适配器 ─── */

export function createMediaApis(): MediaApis {
  return {
    async upload(file: File, category: MediaCategory = 'general'): Promise<MediaReference> {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', category)

      const result = await uploadRequest<BackendMediaUpload>('/media/upload', formData)
      return result.url as MediaReference
    },
  }
}
