import type { MediaReference } from '@/entities'

import { upload as uploadRequest } from './http-client'

/* ─── 后端 DTO ─── */

interface BackendMediaUpload {
  url: string
  object_key: string
  filename: string
  content_type: string
  size: number
}

/* ─── 前端接口 ─── */

export type MediaCategory =
  | 'reference-image'
  | 'outfit-preview'
  | 'action-frame'
  | 'general'

export interface MediaApis {
  upload(file: File, category?: MediaCategory): Promise<MediaReference>
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
