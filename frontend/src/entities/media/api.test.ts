import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMediaApis } from '@/entities'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('MediaApis.upload', () => {
  it('把图片和默认查询分类交给后端，并返回经过校验的媒体引用', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        url: 'https://cdn.example.com/media/reference.png',
        object_key: 'media/general/reference.png',
        filename: 'reference.png',
        content_type: 'image/png',
        size: 4,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const file = imageFile()

    const result = await createMediaApis().upload(file)

    expect(result).toBe('https://cdn.example.com/media/reference.png')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8000/media/upload?category=general')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)

    const body = init.body as FormData
    expect(body.get('file')).toBe(file)
    expect(body.has('category')).toBe(false)
  })

  it('传递调用方选择的图片用途和取消信号', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        url: 'https://cdn.example.com/media/reference.png',
        object_key: 'media/reference-image/reference.png',
        filename: 'reference.png',
        content_type: 'image/png',
        size: 4,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await createMediaApis().upload(imageFile(), 'reference-image', controller.signal)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8000/media/upload?category=reference-image',
    )
    expect((init.body as FormData).has('category')).toBe(false)
    expect(init.signal).toBe(controller.signal)
  })

  it('在请求发出前拒绝非图片文件', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' })

    await expect(createMediaApis().upload(file)).rejects.toThrow('仅支持图片文件')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('后端地址未配置时明确失败，不把文件发送到访问者本机', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_BASE_URL', '')

    await expect(createMediaApis().upload(imageFile())).rejects.toMatchObject({
      name: 'UploadConfigurationError',
      message: '媒体上传不可用：请配置 VITE_API_BASE_URL',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('把 HTTP 200 中的后端业务失败作为真实错误抛出', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 400, message: '仅支持图片文件', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(createMediaApis().upload(imageFile())).rejects.toMatchObject({
      name: 'UploadRequestError',
      status: 200,
      code: 400,
      message: '仅支持图片文件',
    })
  })

  it('保留非成功 HTTP 响应的状态和后端错误信息', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 503, message: '对象存储暂不可用', data: null }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(createMediaApis().upload(imageFile())).rejects.toMatchObject({
      name: 'UploadRequestError',
      status: 503,
      code: 503,
      message: '对象存储暂不可用',
    })
  })

  it('拒绝无法解析的 JSON 响应', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not json', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      ),
    )

    await expect(createMediaApis().upload(imageFile())).rejects.toThrow(
      '上传响应格式错误，无法解析 JSON',
    )
  })

  it.each([
    ['url 为空', { url: '' }],
    ['object_key 缺失', { object_key: undefined }],
    ['content_type 不是图片', { content_type: 'text/plain' }],
    ['size 不是非负整数', { size: -1 }],
  ])('拒绝不符合后端契约的成功数据：%s', async (_caseName, override) => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          url: 'https://cdn.example.com/media/reference.png',
          object_key: 'media/general/reference.png',
          filename: 'reference.png',
          content_type: 'image/png',
          size: 4,
          ...override,
        }),
      ),
    )

    await expect(createMediaApis().upload(imageFile())).rejects.toMatchObject({
      name: 'MediaContractError',
    })
  })

  it('不包装浏览器抛出的取消错误', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const abortError = new DOMException('This operation was aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    const controller = new AbortController()
    controller.abort()

    await expect(
      createMediaApis().upload(imageFile(), 'reference-image', controller.signal),
    ).rejects.toBe(abortError)
  })
})

function imageFile(): File {
  return new File(['wind'], 'reference.png', { type: 'image/png' })
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
