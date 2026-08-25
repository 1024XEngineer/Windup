import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPixelPerfectApis } from '@/entities'
import { registerApiAccessTokenProvider, registerApiUnauthorizedRecovery } from '@/shared/api'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('PixelPerfectApis.process', () => {
  it('匿名读取源图，只把文件交给带当前登录态的完美像素接口', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === 'https://cdn.example.com/characters/scout.png') {
        return imageResponse(['source'], 'image/png')
      }
      return processedResponse()
    }) as typeof fetch
    const unregister = registerApiAccessTokenProvider(() => 'access-token')

    try {
      const result = await createPixelPerfectApis(fetchFn).process({
        imageUrl: 'https://cdn.example.com/characters/scout.png',
      })

      expect(await result.blob.text()).toBe('processed')
      expect(result.filename).toBe('pixel-perfect.png')
      expect(result.metadata).toEqual({
        cols: 24,
        rows: 32,
        stepX: 4.5,
        stepY: 4,
        consensus: 'arbitrated',
        confidence: 'high',
      })
    } finally {
      unregister()
    }

    expect(calls).toHaveLength(2)
    const sourceRequest = new Request(calls[0]!.url, calls[0]!.init)
    expect(sourceRequest.headers.has('authorization')).toBe(false)
    expect(sourceRequest.credentials).toBe('omit')

    expect(calls[1]!.url).toBe('http://127.0.0.1:8000/tools/pixel-perfect')
    const apiRequest = new Request(calls[1]!.url, calls[1]!.init)
    expect(apiRequest.method).toBe('POST')
    expect(apiRequest.credentials).toBe('include')
    expect(apiRequest.headers.get('authorization')).toBe('Bearer access-token')
    expect(new Headers(calls[1]!.init?.headers).has('content-type')).toBe(false)

    const formData = calls[1]!.init?.body as FormData
    expect([...formData.keys()]).toEqual(['file'])
    const file = formData.get('file')
    expect(file).toBeInstanceOf(File)
    expect(file).toMatchObject({ name: 'scout.png', type: 'image/png' })
    expect(await (file as File).text()).toBe('source')
  })

  it('登录态过期时恢复会话并以新 token 重放二进制请求', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    let accessToken = 'expired-token'
    const apiAuthorizations: Array<string | null> = []
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://cdn.example.com/scout.png') {
        return imageResponse(['source'], 'image/png')
      }
      apiAuthorizations.push(new Headers(init?.headers).get('authorization'))
      if (apiAuthorizations.length === 1) {
        return businessResponse(401, '登录状态已过期')
      }
      return processedResponse()
    }) as typeof fetch
    const unregisterToken = registerApiAccessTokenProvider(() => accessToken)
    const unregisterRecovery = registerApiUnauthorizedRecovery(async () => {
      accessToken = 'renewed-token'
      return true
    })

    try {
      await expect(
        createPixelPerfectApis(fetchFn).process({
          imageUrl: 'https://cdn.example.com/scout.png',
        }),
      ).resolves.toMatchObject({ filename: 'pixel-perfect.png' })
    } finally {
      unregisterRecovery()
      unregisterToken()
    }

    expect(apiAuthorizations).toEqual(['Bearer expired-token', 'Bearer renewed-token'])
  })

  it('把 HTTP 200 JSON 中的业务失败作为用户可读错误抛出', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(imageResponse(['source'], 'image/png'))
      .mockResolvedValueOnce(businessResponse(400, '图片不能超过 10 MB')) as typeof fetch

    await expect(
      createPixelPerfectApis(fetchFn).process({ imageUrl: 'https://cdn.example.com/large.png' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'business',
      code: 400,
      status: 200,
      message: '图片不能超过 10 MB',
    })
  })

  it('拒绝伪装成成功的非 PNG 响应', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(imageResponse(['source'], 'image/png'))
      .mockResolvedValueOnce(
        new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
      ) as typeof fetch

    await expect(
      createPixelPerfectApis(fetchFn).process({ imageUrl: 'https://cdn.example.com/scout.png' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
      message: '完美像素接口没有返回 PNG 图片',
    })
  })

  it('拒绝缺少检测元数据的 PNG 响应', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(imageResponse(['source'], 'image/png'))
      .mockResolvedValueOnce(imageResponse(['processed'], 'image/png')) as typeof fetch

    await expect(
      createPixelPerfectApis(fetchFn).process({ imageUrl: 'https://cdn.example.com/scout.png' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
      message: '完美像素接口返回的检测信息无效',
    })
  })

  it('源图无法下载时不调用完美像素接口', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch

    await expect(
      createPixelPerfectApis(fetchFn).process({ imageUrl: 'https://cdn.example.com/missing.png' }),
    ).rejects.toThrow('源图下载失败（HTTP 404）')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('PixelPerfectApis.reconstruct', () => {
  it('sends the project sprite size as the explicit reconstruction grid', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === 'https://cdn.example.com/actions/dance-0.png') {
        return imageResponse(['source'], 'image/png')
      }
      return new Response(new Blob(['reconstructed'], { type: 'image/png' }), {
        headers: {
          'content-type': 'image/png',
          'content-disposition': 'attachment; filename="pixel-perfect.png"',
          'x-pixel-cols': '64',
          'x-pixel-rows': '64',
          'x-pixel-visible-colors': '12',
        },
      })
    }) as typeof fetch

    const result = await createPixelPerfectApis(fetchFn).reconstruct({
      imageUrl: 'https://cdn.example.com/actions/dance-0.png',
      cols: 64,
      rows: 64,
    })

    expect(await result.blob.text()).toBe('reconstructed')
    expect(result.metadata).toEqual({ cols: 64, rows: 64, visibleColors: 12 })
    expect(calls[1]!.url).toBe('http://127.0.0.1:8000/tools/pixel-perfect/reconstruct')
    const form = calls[1]!.init?.body as FormData
    expect([...form.keys()]).toEqual(['file', 'cols', 'rows', 'structure_colors'])
    expect(form.get('cols')).toBe('64')
    expect(form.get('rows')).toBe('64')
    expect(form.get('structure_colors')).toBe('16')
  })

  it('accepts a transparent reconstruction with no visible colors', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const fetchFn = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('https://cdn.example.com/')
        ? imageResponse(['source'], 'image/png')
        : new Response(new Blob(['transparent'], { type: 'image/png' }), {
            headers: {
              'content-type': 'image/png',
              'x-pixel-cols': '64',
              'x-pixel-rows': '64',
              'x-pixel-visible-colors': '0',
            },
          }),
    ) as typeof fetch

    await expect(
      createPixelPerfectApis(fetchFn).reconstruct({
        imageUrl: 'https://cdn.example.com/transparent.png',
        cols: 64,
        rows: 64,
      }),
    ).resolves.toMatchObject({ metadata: { visibleColors: 0 } })
  })
})

function imageResponse(parts: BlobPart[], type: string): Response {
  return new Response(new Blob(parts, { type }), {
    status: 200,
    headers: { 'content-type': type },
  })
}

function businessResponse(code: number, message: string): Response {
  return new Response(JSON.stringify({ code, message, data: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function processedResponse(): Response {
  return new Response(new Blob(['processed'], { type: 'image/png' }), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-disposition': 'attachment; filename="pixel-perfect.png"',
      'x-pixel-cols': '24',
      'x-pixel-rows': '32',
      'x-pixel-step-x': '4.5',
      'x-pixel-step-y': '4',
      'x-pixel-consensus': 'arbitrated',
      'x-pixel-confidence': 'high',
    },
  })
}
