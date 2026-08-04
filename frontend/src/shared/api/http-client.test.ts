import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, del, get, getPage, post } from './http-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('http client request headers', () => {
  it('does not force a CORS preflight for a bodyless GET request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await get('/projects')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)
  })

  it('marks a JSON request body with the correct content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await post('/projects', { name: 'Windup' })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('accepts a successful delete with no response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(del('/characters/25')).resolves.toBeUndefined()
  })

  it('accepts a successful delete envelope whose data is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null)))

    await expect(del('/projects/3')).resolves.toBeUndefined()
  })

  it('rejects an HTTP 200 delete envelope whose business code reports failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 404, message: '角色不存在', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(del('/characters/404')).rejects.toMatchObject({
      status: 200,
      code: 404,
      message: '角色不存在',
    })
  })

  it('preserves backend pagination metadata for list responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: [{ id: 1 }],
            total: 23,
            page: 2,
            page_size: 10,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(getPage<{ id: number }>('/projects?page=2')).resolves.toEqual({
      items: [{ id: 1 }],
      total: 23,
      page: 2,
      pageSize: 10,
    })
  })

  it('rejects a malformed list response instead of inventing pagination values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])))

    await expect(getPage('/projects')).rejects.toBeInstanceOf(ApiError)
  })

  it('accepts page_size zero as the backend full-list marker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: [{ id: 1 }, { id: 2 }],
            total: 2,
            page: 1,
            page_size: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(getPage<{ id: number }>('/projects')).resolves.toEqual({
      items: [{ id: 1 }, { id: 2 }],
      total: 2,
      page: 1,
      pageSize: 0,
    })
  })
})

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
