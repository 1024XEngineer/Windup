import { afterEach, describe, expect, it, vi } from 'vitest'

import * as imageUpload from '..'

describe('真实图片上传 Adapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('通过 Capability 公开入口提供生产 Adapter 工厂', () => {
    expect(imageUpload).toHaveProperty('createImageUploadAdapter')
  })

  it('把图片作为 file 字段上传到 reference-image 路由并只返回 URL 引用', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test/')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: {
              url: 'https://media.windup.test/reference/reference.png',
              object_key: 'reference-image/uuid.png',
              filename: 'reference.png',
              content_type: 'image/png',
              size: 5,
            },
            timestamp: '2026-07-29T08:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['image'], 'reference.png', { type: 'image/png' })

    const result = await imageUpload.createImageUploadAdapter().upload(file)

    expect(result).toBe('https://media.windup.test/reference/reference.png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0] ?? []
    expect(input).toBe('https://api.windup.test/media/upload?category=reference-image')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    expect(init?.headers).toBeUndefined()
    const body = init?.body
    expect(body).toBeInstanceOf(FormData)
    if (!(body instanceof FormData)) throw new Error('请求体不是 FormData')
    expect(body.get('file')).toBe(file)
    expect([...body.keys()]).toEqual(['file'])
  })

  it('base URL 为空时使用同源上传路径，不补默认 /api 前缀', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: {
              url: 'https://media.windup.test/reference/reference.png',
              object_key: 'reference-image/uuid.png',
              filename: 'reference.png',
              content_type: 'image/png',
              size: 5,
            },
          }),
          { status: 200 },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await imageUpload
      .createImageUploadAdapter()
      .upload(new File(['image'], 'reference.png', { type: 'image/png' }))

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/media/upload?category=reference-image')
  })

  it('HTTP 非 2xx 且响应不是统一错误壳时抛出带状态码的错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream unavailable', { status: 502 })),
    )

    await expect(
      imageUpload
        .createImageUploadAdapter()
        .upload(new File(['image'], 'reference.png', { type: 'image/png' })),
    ).rejects.toThrow('图片上传请求失败（HTTP 502）：upstream unavailable')
  })

  it('HTTP 成功但业务 code 不是 200 时抛出后端业务错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 400,
              message: 'unsupported media category',
              data: null,
            }),
            { status: 200 },
          ),
      ),
    )

    await expect(
      imageUpload
        .createImageUploadAdapter()
        .upload(new File(['image'], 'reference.png', { type: 'image/png' })),
    ).rejects.toThrow('图片上传失败：unsupported media category')
  })

  it.each([
    ['detail 字符串', { detail: 'Uploaded file is not an image' }, 'Uploaded file is not an image'],
    [
      '空 message 后的 detail 字符串',
      { message: '  ', detail: 'Uploaded file is not an image' },
      'Uploaded file is not an image',
    ],
    [
      '422 detail 数组',
      {
        detail: [
          { type: 'value_error', loc: ['body', 'file'], msg: 'Input should be an image' },
          { type: 'value_error', loc: ['query', 'category'], msg: 'Invalid category' },
        ],
      },
      'Input should be an image；Invalid category',
    ],
  ])('读取 FastAPI %s 作为可读错误', async (_case, body, detail) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 422 })),
    )

    await expect(
      imageUpload
        .createImageUploadAdapter()
        .upload(new File(['image'], 'reference.png', { type: 'image/png' })),
    ).rejects.toThrow(`图片上传请求失败（HTTP 422）：${detail}`)
  })

  it('截断超长后端错误详情', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x'.repeat(500), { status: 502 })),
    )

    await expect(
      imageUpload
        .createImageUploadAdapter()
        .upload(new File(['image'], 'reference.png', { type: 'image/png' })),
    ).rejects.toThrow(`图片上传请求失败（HTTP 502）：${'x'.repeat(200)}…`)
  })

  it('非图片文件在发请求前立即失败', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      imageUpload
        .createImageUploadAdapter()
        .upload(new File(['text'], 'notes.txt', { type: 'text/plain' })),
    ).rejects.toThrow('仅支持 image/* 文件')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['相对地址', 'api.windup.test'],
    ['非 HTTP 协议', 'ftp://api.windup.test'],
    ['包含账号密码', 'https://user:secret@api.windup.test'],
    ['包含 query', 'https://api.windup.test/base?tenant=1'],
    ['包含 hash', 'https://api.windup.test/base#fragment'],
  ])('VITE_API_BASE_URL 为%s时在请求前明确失败', async (_case, baseUrl) => {
    vi.stubEnv('VITE_API_BASE_URL', baseUrl)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      imageUpload
        .createImageUploadAdapter()
        .upload(new File(['image'], 'reference.png', { type: 'image/png' })),
    ).rejects.toThrow('VITE_API_BASE_URL 配置无效')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['data 缺失', { code: 200, message: 'success', data: null }],
    [
      'URL 非法',
      {
        code: 200,
        message: 'success',
        data: {
          url: 'not-a-url',
          object_key: 'reference-image/uuid.png',
          filename: 'reference.png',
          content_type: 'image/png',
          size: 5,
        },
      },
    ],
  ])('拒绝成功响应中的%s', async (_case, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    )

    await expect(
      imageUpload
        .createImageUploadAdapter()
        .upload(new File(['image'], 'reference.png', { type: 'image/png' })),
    ).rejects.toThrow('图片上传响应缺少有效 URL')
  })
})
