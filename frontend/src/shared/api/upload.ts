import { ApiError } from './client/mappers'

/**
 * 文件上传 transport。业务层只负责校验业务允许的文件类型，
 * URL、multipart 和响应错误统一由 shared 处理。
 */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}${path}`, {
    method: 'POST',
    body: form,
  })
  const payload = (await response.json()) as {
    code: number
    message: string
    data: T | null
  }
  if (!response.ok || payload.code !== 200 || payload.data === null) {
    throw new ApiError(
      payload.message || `上传失败：HTTP ${response.status}`,
      payload.code || response.status,
    )
  }
  return payload.data
}
