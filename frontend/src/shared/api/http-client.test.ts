import { afterEach, describe, expect, it, vi } from 'vitest'

import { get, post } from './http-client'

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
})

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
