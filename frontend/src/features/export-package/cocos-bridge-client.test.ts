import { describe, expect, it } from 'vitest'

import {
  COCOS_BRIDGE_PROTOCOL,
  CocosBridgeClient,
  type CocosBridgeClientOptions,
} from './cocos-bridge-client'

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function options(
  fetch: typeof globalThis.fetch,
  storage = new MemoryStorage(),
): CocosBridgeClientOptions {
  return {
    fetch,
    storage,
    baseUrl: 'http://127.0.0.1:17832',
    healthTimeoutMs: 20,
    uploadTimeoutMs: 20,
  }
}

describe('CocosBridgeClient', () => {
  it('reads a compatible Creator health response', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      json({
        protocol: COCOS_BRIDGE_PROTOCOL,
        creatorVersion: '3.8.8',
        projectName: 'WindupCocosTest',
        projectOpen: true,
        paired: true,
      })
    const health = await new CocosBridgeClient(options(fetch)).health()

    expect(health.creatorVersion).toBe('3.8.8')
    expect(health.projectName).toBe('WindupCocosTest')
    expect(health.projectOpen).toBe(true)
  })

  it('accepts the privacy-preserving health response before pairing', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      json({ protocol: COCOS_BRIDGE_PROTOCOL, paired: false })
    await expect(new CocosBridgeClient(options(fetch)).health()).resolves.toEqual({
      protocol: COCOS_BRIDGE_PROTOCOL,
      creatorVersion: null,
      projectName: null,
      projectOpen: false,
      paired: false,
    })
  })

  it('accepts a paired Creator health response without a project name', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      json({
        protocol: COCOS_BRIDGE_PROTOCOL,
        creatorVersion: '3.8.8',
        projectName: null,
        projectOpen: false,
        paired: true,
      })

    await expect(new CocosBridgeClient(options(fetch)).health()).resolves.toMatchObject({
      projectName: null,
      projectOpen: false,
      paired: true,
    })
  })

  it('stores the issued token after a valid one-time pairing code', async () => {
    const storage = new MemoryStorage()
    const fetch: typeof globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:17832/v1/pair')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ code: '123456' })
      return json({ protocol: COCOS_BRIDGE_PROTOCOL, token: 'issued-token' })
    }
    const client = new CocosBridgeClient(options(fetch, storage))

    await client.pair('123456')

    expect(storage.getItem('windup:cocos-bridge:token:v1')).toBe('issued-token')
  })

  it('uploads the raw zip with request id, bearer token and SHA-256', async () => {
    const storage = new MemoryStorage()
    storage.setItem('windup:cocos-bridge:token:v1', 'secret-token')
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer secret-token')
      expect(headers.get('Content-Type')).toBe('application/zip')
      expect(headers.get('X-Windup-Protocol')).toBe(COCOS_BRIDGE_PROTOCOL)
      expect(headers.get('X-Windup-Request-Id')).toBe('11111111-1111-4111-8111-111111111111')
      expect(headers.get('X-Windup-SHA256')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      )
      const requestBody = init?.body
      expect(requestBody).toBeInstanceOf(Blob)
      if (!(requestBody instanceof Blob)) throw new Error('expected Blob request body')
      expect(await requestBody.text()).toBe('abc')
      return json({ protocol: COCOS_BRIDGE_PROTOCOL, jobId: 'job-1' }, 202)
    }
    const client = new CocosBridgeClient(options(fetch, storage))

    const submitted = await client.submit(
      new Blob(['abc'], { type: 'application/zip' }),
      '11111111-1111-4111-8111-111111111111',
    )

    expect(submitted.jobId).toBe('job-1')
  })

  it('returns a completed import job with its summary', async () => {
    const storage = new MemoryStorage()
    storage.setItem('windup:cocos-bridge:token:v1', 'secret-token')
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer secret-token')
      expect(headers.get('X-Windup-Protocol')).toBe(COCOS_BRIDGE_PROTOCOL)
      return json({
        protocol: COCOS_BRIDGE_PROTOCOL,
        jobId: 'job-1',
        status: 'completed',
        phase: 'verifying',
        result: {
          projectName: 'Game',
          dbUrl: 'db://assets/windup-imports/Hero/Ranger/prefabs/Hero-Ranger.prefab',
          animationCount: 2,
          frameCount: 64,
        },
      })
    }
    const job = await new CocosBridgeClient(options(fetch, storage)).getJob('job-1')

    expect(job.status).toBe('completed')
    expect(job.result?.animationCount).toBe(2)
    expect(job.result?.frameCount).toBe(64)
  })

  it('clears an expired token and maps 401 to PAIRING_REQUIRED', async () => {
    const storage = new MemoryStorage()
    storage.setItem('windup:cocos-bridge:token:v1', 'expired-token')
    const client = new CocosBridgeClient(
      options(async () => json({ error: 'TOKEN_INVALID' }, 401), storage),
    )

    await expect(client.getJob('job-1')).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' })
    expect(storage.getItem('windup:cocos-bridge:token:v1')).toBeNull()
  })

  it('requires pairing before authenticated requests without calling localhost', async () => {
    let called = false
    const client = new CocosBridgeClient(
      options(async () => {
        called = true
        return json({})
      }),
    )

    await expect(client.getJob('job-1')).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' })
    expect(called).toBe(false)
  })

  it.each([
    [403, 'ORIGIN_DENIED'],
    [426, 'VERSION_UNSUPPORTED'],
    [500, 'IMPORT_FAILED'],
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    const storage = new MemoryStorage()
    storage.setItem('windup:cocos-bridge:token:v1', 'token')
    const client = new CocosBridgeClient(
      options(async () => json({ message: 'server reason' }, status), storage),
    )

    await expect(client.getJob('job-1')).rejects.toMatchObject({ code, status })
  })

  it('rejects non-JSON plugin responses', async () => {
    const client = new CocosBridgeClient(
      options(
        async () =>
          new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      ),
    )

    await expect(client.health()).rejects.toMatchObject({ code: 'IMPORT_FAILED' })
  })

  it('parses a failed job including rollback state', async () => {
    const storage = new MemoryStorage()
    storage.setItem('windup:cocos-bridge:token:v1', 'token')
    const client = new CocosBridgeClient(
      options(
        async () =>
          json({
            protocol: COCOS_BRIDGE_PROTOCOL,
            jobId: 'job-2',
            status: 'failed',
            phase: 'verifying',
            error: { code: 'IMPORT_UUID_UNRESOLVED', message: '引用不存在', rolledBack: true },
          }),
        storage,
      ),
    )

    const job = await client.getJob('job-2')
    expect(job.error).toEqual({
      code: 'IMPORT_UUID_UNRESOLVED',
      message: '引用不存在',
      rolledBack: true,
    })
  })

  it('rejects malformed job states instead of treating them as completed', async () => {
    const storage = new MemoryStorage()
    storage.setItem('windup:cocos-bridge:token:v1', 'token')
    const client = new CocosBridgeClient(
      options(
        async () =>
          json({
            protocol: COCOS_BRIDGE_PROTOCOL,
            jobId: 'job-3',
            status: 'done-ish',
            phase: 'verifying',
          }),
        storage,
      ),
    )

    await expect(client.getJob('job-3')).rejects.toMatchObject({ code: 'IMPORT_FAILED' })
  })

  it.each([
    {
      name: 'non-object health body',
      body: [] as unknown,
      message: 'health 返回格式错误',
    },
    {
      name: 'empty Creator version',
      body: {
        protocol: COCOS_BRIDGE_PROTOCOL,
        creatorVersion: '',
        projectName: 'Game',
        projectOpen: true,
        paired: true,
      },
      message: 'health.creatorVersion 必须是非空字符串',
    },
    {
      name: 'non-boolean pairing state',
      body: { protocol: COCOS_BRIDGE_PROTOCOL, paired: 'yes' },
      message: 'health.paired 必须是布尔值',
    },
  ])('rejects $name at the health boundary', async ({ body, message }) => {
    const client = new CocosBridgeClient(options(async () => json(body)))

    await expect(client.health()).rejects.toThrow(message)
  })

  it('rejects non-numeric import totals instead of accepting a corrupt result', async () => {
    const storage = new MemoryStorage()
    storage.setItem('windup:cocos-bridge:token:v1', 'token')
    const client = new CocosBridgeClient(
      options(
        async () =>
          json({
            protocol: COCOS_BRIDGE_PROTOCOL,
            jobId: 'job-bad-total',
            status: 'completed',
            phase: 'verifying',
            result: {
              projectName: 'Game',
              dbUrl: 'db://assets/result.prefab',
              animationCount: null,
              frameCount: 64,
            },
          }),
        storage,
      ),
    )

    await expect(client.getJob('job-bad-total')).rejects.toThrow(
      'job.result.animationCount 必须是数字',
    )
  })

  it.each([{ message: '' }, null])(
    'uses a stable fallback when an HTTP error has no usable message: %j',
    async (body) => {
      const storage = new MemoryStorage()
      storage.setItem('windup:cocos-bridge:token:v1', 'token')
      const client = new CocosBridgeClient(options(async () => json(body, 500), storage))

      await expect(client.getJob('job-1')).rejects.toThrow('Cocos 导入失败')
    },
  )

  it('rejects a bridge using another protocol version', async () => {
    const client = new CocosBridgeClient(
      options(async () =>
        json({
          creatorVersion: '3.8.8',
          projectName: 'Game',
          projectOpen: true,
          paired: true,
          protocol: 'other/2',
        }),
      ),
    )

    await expect(client.health()).rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' })
  })

  it('maps refused localhost connections to PLUGIN_UNAVAILABLE', async () => {
    const client = new CocosBridgeClient(
      options(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    await expect(client.health()).rejects.toEqual(
      expect.objectContaining({ code: 'PLUGIN_UNAVAILABLE' }),
    )
  })

  it('aborts a health request that exceeds the configured timeout', async () => {
    const fetch: typeof globalThis.fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })
    const client = new CocosBridgeClient(options(fetch))

    await expect(client.health()).rejects.toMatchObject({ code: 'PLUGIN_UNAVAILABLE' })
  })
})
