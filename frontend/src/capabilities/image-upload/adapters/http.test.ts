// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const uploadFileMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/api', () => ({
  ApiError: class ApiError extends Error {
    readonly code: number

    constructor(message: string, code: number) {
      super(message)
      this.code = code
    }
  },
  uploadFile: uploadFileMock,
}))

import { httpImageUploadAdapter } from './http'

beforeEach(() => {
  uploadFileMock.mockReset()
})

describe('HTTP 图片上传 Adapter', () => {
  it('在发请求前拒绝后端不支持的图片格式', async () => {
    const file = new File(['image'], 'reference.svg', { type: 'image/svg+xml' })

    await expect(httpImageUploadAdapter.upload(file)).rejects.toThrow(
      '仅支持 jpg/png/webp/gif 图片',
    )
    expect(uploadFileMock).not.toHaveBeenCalled()
  })

  it('在发请求前拒绝超过后端上限的图片', async () => {
    const file = new File(['image'], 'large.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 })

    await expect(httpImageUploadAdapter.upload(file)).rejects.toThrow(
      '文件超过大小上限(10485760 字节)',
    )
    expect(uploadFileMock).not.toHaveBeenCalled()
  })

  it('通过 multipart 端点上传并只向业务层返回 URL', async () => {
    const file = new File(['image'], 'reference.webp', { type: 'image/webp' })
    uploadFileMock.mockResolvedValue({ url: 'https://cdn.test/reference.webp' })

    await expect(httpImageUploadAdapter.upload(file)).resolves.toBe(
      'https://cdn.test/reference.webp',
    )
    expect(uploadFileMock).toHaveBeenCalledWith('/upload/image', file)
  })
})
