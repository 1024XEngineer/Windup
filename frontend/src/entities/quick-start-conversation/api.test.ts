import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

function envelope(data: unknown, code = 200, message = 'success') {
  return new Response(JSON.stringify({ code, message, data }), {
    headers: { 'content-type': 'application/json' },
  })
}

async function loadApis(fetchFn: typeof fetch) {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', fetchFn)
  return import('./api')
}

describe('quickStartConversationApis', () => {
  it('loads a server snapshot and maps transport field names', async () => {
    const { quickStartConversationApis } = await loadApis(async () =>
      envelope({
        run_id: 18,
        turns: [{ role: 'user', content: '像素骑士' }],
        schema_version: 2,
        version: 3,
        updated_at: '2026-08-27T10:00:00Z',
      }),
    )

    await expect(quickStartConversationApis.get('18')).resolves.toEqual({
      runId: '18',
      turns: [{ role: 'user', content: '像素骑士' }],
      schemaVersion: 2,
      version: 3,
      updatedAt: '2026-08-27T10:00:00Z',
    })
  })

  it('saves a complete snapshot with an independently replayable PUT', async () => {
    let request: Request | undefined
    const { quickStartConversationApis } = await loadApis(async (input, init) => {
      request = new Request(input, init)
      return envelope({
        run_id: 18,
        turns: [{ role: 'user', content: '像素骑士' }],
        schema_version: 2,
        version: 1,
        updated_at: '2026-08-27T10:00:00Z',
      })
    })

    await quickStartConversationApis.save('18', {
      turns: [{ role: 'user', content: '像素骑士' }],
      version: 0,
    })

    expect(request?.url).toBe('https://api.windup.test/workflow-runs/18/agent-conversation')
    expect(request?.method).toBe('PUT')
    await expect(request?.json()).resolves.toEqual({
      turns: [{ role: 'user', content: '像素骑士' }],
      schema_version: 2,
      version: 0,
    })
  })

  it('turns a 409 business response into a typed conflict', async () => {
    const { quickStartConversationApis, QuickStartConversationConflictError } = await loadApis(
      async () => envelope(null, 409, 'Agent 对话版本冲突'),
    )

    await expect(
      quickStartConversationApis.save('18', { turns: [], version: 0 }),
    ).rejects.toBeInstanceOf(QuickStartConversationConflictError)
  })
})
