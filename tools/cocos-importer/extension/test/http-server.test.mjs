import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

import { startServer } from '../source/http-server.js'
import { PairingStore } from '../source/pairing-store.js'
import { PROTOCOL } from '../source/protocol.js'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

function dependencies() {
  const profile = {
    value: null,
    async load() {
      return this.value
    },
    async save(value) {
      this.value = value
    },
  }
  const pairing = new PairingStore({
    profile,
    randomCode: () => '123456',
    randomToken: () => 'a'.repeat(64),
  })
  const submitted = []
  const jobs = {
    async submit(request) {
      submitted.push(request)
      return { jobId: 'job-1' }
    },
    async get(jobId) {
      return {
        protocol: PROTOCOL,
        jobId,
        status: 'completed',
        phase: 'verifying',
        result: { projectName: 'Game', dbUrl: 'db://assets/p.prefab', animationCount: 2, frameCount: 64 },
      }
    },
  }
  return { pairing, jobs, submitted }
}

async function running(options = {}) {
  const deps = dependencies()
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    pairing: deps.pairing,
    jobs: deps.jobs,
    health: async () => ({ creatorVersion: '3.8.8', projectName: 'Game', projectOpen: true }),
    ...options,
  })
  servers.push(server)
  const address = server.address()
  assert.equal(address.address, '127.0.0.1')
  return { ...deps, server, baseUrl: `http://127.0.0.1:${address.port}` }
}

async function pair(baseUrl, pairing, origin = 'https://windup.example') {
  pairing.createCode()
  const response = await fetch(`${baseUrl}/v1/pair`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '123456' }),
  })
  assert.equal(response.status, 200)
  return (await response.json()).token
}

test('server exposes only protocol and pairing state before the origin is paired', async () => {
  const { baseUrl } = await running()
  const response = await fetch(`${baseUrl}/v1/health`, { headers: { Origin: 'https://windup.example' } })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://windup.example')
  assert.deepEqual(body, { protocol: PROTOCOL, paired: false })
  assert.equal(JSON.stringify(body).includes('projectPath'), false)
})

test('server exposes project health only to the paired origin', async () => {
  const { baseUrl, pairing } = await running()
  await pair(baseUrl, pairing)
  const response = await fetch(`${baseUrl}/v1/health`, {
    headers: { Origin: 'https://windup.example' },
  })
  assert.deepEqual(await response.json(), {
    protocol: PROTOCOL,
    creatorVersion: '3.8.8',
    projectName: 'Game',
    projectOpen: true,
    paired: true,
  })
})

test('server pairs once and accepts an authenticated ZIP import from the exact origin', async () => {
  const { baseUrl, pairing, submitted } = await running()
  const origin = 'https://windup.example'
  const token = await pair(baseUrl, pairing, origin)
  const bytes = new TextEncoder().encode('zip')
  const response = await fetch(`${baseUrl}/v1/imports`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/zip',
      'X-Windup-Protocol': PROTOCOL,
      'X-Windup-Request-Id': '11111111-1111-4111-8111-111111111111',
      'X-Windup-SHA256': '4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2',
    },
    body: bytes,
  })

  assert.equal(response.status, 202)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin)
  assert.deepEqual(await response.json(), { protocol: PROTOCOL, jobId: 'job-1' })
  assert.equal(submitted.length, 1)
  assert.equal(new TextDecoder().decode(submitted[0].zipBytes), 'zip')
})

test('server rejects wrong origins and missing bearer tokens', async () => {
  const { baseUrl, pairing } = await running()
  const token = await pair(baseUrl, pairing)
  const headers = {
    Origin: 'https://evil.example',
    Authorization: `Bearer ${token}`,
    'X-Windup-Protocol': PROTOCOL,
  }
  const wrongOrigin = await fetch(`${baseUrl}/v1/imports/job-1`, { headers })
  assert.equal(wrongOrigin.status, 403)

  const missingToken = await fetch(`${baseUrl}/v1/imports/job-1`, {
    headers: { Origin: 'https://windup.example', 'X-Windup-Protocol': PROTOCOL },
  })
  assert.equal(missingToken.status, 401)
})

test('server handles an authorized CORS preflight with the fixed header allowlist', async () => {
  const { baseUrl, pairing } = await running()
  await pair(baseUrl, pairing)
  const response = await fetch(`${baseUrl}/v1/imports`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://windup.example',
      'Access-Control-Request-Method': 'POST',
    },
  })

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://windup.example')
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /Authorization/)
})

test('server handles pairing and job polling preflights', async () => {
  const { baseUrl, pairing } = await running()
  const origin = 'https://windup.example'
  const pairingPreflight = await fetch(`${baseUrl}/v1/pair`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  })
  assert.equal(pairingPreflight.status, 204)
  assert.equal(pairingPreflight.headers.get('Access-Control-Allow-Origin'), origin)
  assert.match(pairingPreflight.headers.get('Access-Control-Allow-Methods'), /POST/)
  assert.match(pairingPreflight.headers.get('Access-Control-Allow-Headers'), /Content-Type/)

  await pair(baseUrl, pairing, origin)
  const pollingPreflight = await fetch(`${baseUrl}/v1/imports/job-1`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  })
  assert.equal(pollingPreflight.status, 204)
  assert.equal(pollingPreflight.headers.get('Access-Control-Allow-Origin'), origin)
  assert.match(pollingPreflight.headers.get('Access-Control-Allow-Methods'), /GET/)
  assert.match(pollingPreflight.headers.get('Access-Control-Allow-Headers'), /Authorization/)
})

test('server rejects non-loopback binding and oversized uploads', async () => {
  await assert.rejects(
    () => running({ host: '0.0.0.0' }),
    /BRIDGE_HOST_FORBIDDEN/,
  )
  const { baseUrl, pairing, submitted } = await running({ maxUploadBytes: 2 })
  const token = await pair(baseUrl, pairing)
  const response = await fetch(`${baseUrl}/v1/imports`, {
    method: 'POST',
    headers: {
      Origin: 'https://windup.example',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/zip',
      'X-Windup-Protocol': PROTOCOL,
      'X-Windup-Request-Id': '11111111-1111-4111-8111-111111111111',
      'X-Windup-SHA256': '4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2',
    },
    body: 'zip',
  })
  assert.equal(response.status, 413)
  assert.equal(submitted.length, 0)
})

test('server rejects a 36-character request id that is not a UUID', async () => {
  const { baseUrl, pairing, submitted } = await running()
  const token = await pair(baseUrl, pairing)
  const bytes = new TextEncoder().encode('zip')
  const response = await fetch(`${baseUrl}/v1/imports`, {
    method: 'POST',
    headers: {
      Origin: 'https://windup.example',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/zip',
      'X-Windup-Protocol': PROTOCOL,
      'X-Windup-Request-Id': '------------------------------------',
      'X-Windup-SHA256': '4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2',
    },
    body: bytes,
  })

  assert.equal(response.status, 400)
  assert.equal(submitted.length, 0)
})

test('server returns 426 for incompatible protocol versions', async () => {
  const { baseUrl, pairing } = await running()
  const token = await pair(baseUrl, pairing)
  const response = await fetch(`${baseUrl}/v1/imports/job-1`, {
    headers: {
      Origin: 'https://windup.example',
      Authorization: `Bearer ${token}`,
      'X-Windup-Protocol': 'windup-cocos-bridge/2.0.0',
    },
  })
  assert.equal(response.status, 426)
})
