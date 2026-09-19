import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

import { PROTOCOL } from './protocol.js'

const DEFAULT_MAX_UPLOAD_BYTES = 256 * 1024 * 1024
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Windup-Protocol',
  'X-Windup-Request-Id',
  'X-Windup-SHA256',
].join(', ')

function cors(origin) {
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(body))
}

function error(response, status, code, headers = {}) {
  json(response, status, { protocol: PROTOCOL, error: { code } }, headers)
}

async function readBody(request, maxBytes) {
  const contentLength = request.headers['content-length']
  if (contentLength !== undefined && Number(contentLength) > maxBytes) {
    throw new Error('UPLOAD_TOO_LARGE')
  }
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw new Error('UPLOAD_TOO_LARGE')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function bearer(request) {
  const value = request.headers.authorization
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : null
}

function requestPath(request) {
  return new URL(request.url, 'http://127.0.0.1').pathname
}

async function authenticate(request, response, pairing) {
  const origin = request.headers.origin
  if (!(await pairing.isOriginAllowed(origin))) {
    error(response, 403, 'ORIGIN_FORBIDDEN')
    return null
  }
  const headers = cors(origin)
  const token = bearer(request)
  if (!token || !(await pairing.authorize(origin, token))) {
    error(response, 401, 'UNAUTHORIZED', headers)
    return null
  }
  if (request.headers['x-windup-protocol'] !== PROTOCOL) {
    error(response, 426, 'PROTOCOL_INCOMPATIBLE', headers)
    return null
  }
  return { origin, headers }
}

export async function startServer({
  host = '127.0.0.1',
  port = 17_832,
  pairing,
  jobs,
  health,
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
}) {
  if (host !== '127.0.0.1') throw new Error('BRIDGE_HOST_FORBIDDEN')

  const nodeServer = createServer(async (request, response) => {
    try {
      const path = requestPath(request)
      const origin = request.headers.origin

      if (request.method === 'GET' && path === '/v1/health') {
        const paired = await pairing.isOriginAllowed(origin)
        const body = paired
          ? { protocol: PROTOCOL, ...(await health()), paired: true }
          : { protocol: PROTOCOL, paired: false }
        json(response, 200, body, cors(origin))
        return
      }

      if (request.method === 'OPTIONS' && path === '/v1/pair') {
        response.writeHead(204, {
          ...cors(origin),
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        })
        response.end()
        return
      }

      if (request.method === 'POST' && path === '/v1/pair') {
        const headers = cors(origin)
        let payload
        try {
          payload = JSON.parse((await readBody(request, 1024)).toString('utf8'))
        } catch (cause) {
          error(response, cause.message === 'UPLOAD_TOO_LARGE' ? 413 : 400, 'PAIR_REQUEST_INVALID', headers)
          return
        }
        try {
          const token = await pairing.pair(payload.code, origin)
          json(response, 200, { protocol: PROTOCOL, token }, headers)
        } catch (cause) {
          const locked = cause.message === 'PAIR_CODE_LOCKED'
          error(response, locked ? 429 : 400, cause.message, headers)
        }
        return
      }

      const importPreflight = path === '/v1/imports' || /^\/v1\/imports\/[^/]+$/.test(path)
      if (request.method === 'OPTIONS' && importPreflight) {
        if (!(await pairing.isOriginAllowed(origin))) {
          error(response, 403, 'ORIGIN_FORBIDDEN')
          return
        }
        const methods = path === '/v1/imports' ? 'POST, OPTIONS' : 'GET, OPTIONS'
        response.writeHead(204, {
          ...cors(origin),
          'Access-Control-Allow-Methods': methods,
          'Access-Control-Allow-Headers': ALLOWED_HEADERS,
          'Access-Control-Max-Age': '600',
        })
        response.end()
        return
      }

      const jobMatch = path.match(/^\/v1\/imports\/([^/]+)$/)
      if (request.method === 'GET' && jobMatch) {
        const auth = await authenticate(request, response, pairing)
        if (!auth) return
        const job = await jobs.get(decodeURIComponent(jobMatch[1]))
        if (!job) {
          error(response, 404, 'IMPORT_JOB_NOT_FOUND', auth.headers)
          return
        }
        json(response, 200, job, auth.headers)
        return
      }

      if (request.method === 'POST' && path === '/v1/imports') {
        const auth = await authenticate(request, response, pairing)
        if (!auth) return
        if (request.headers['content-type'] !== 'application/zip') {
          error(response, 415, 'CONTENT_TYPE_UNSUPPORTED', auth.headers)
          return
        }
        const requestId = request.headers['x-windup-request-id']
        const expectedSha = request.headers['x-windup-sha256']
        if (!/^[0-9a-f]{64}$/.test(expectedSha ?? '') || !REQUEST_ID.test(requestId ?? '')) {
          error(response, 400, 'IMPORT_HEADERS_INVALID', auth.headers)
          return
        }

        let zipBytes
        try {
          zipBytes = await readBody(request, maxUploadBytes)
        } catch {
          error(response, 413, 'UPLOAD_TOO_LARGE', auth.headers)
          return
        }
        const actualSha = createHash('sha256').update(zipBytes).digest('hex')
        if (actualSha !== expectedSha) {
          error(response, 400, 'UPLOAD_DIGEST_MISMATCH', auth.headers)
          return
        }
        const { jobId } = await jobs.submit({ requestId, zipBytes, sha256: actualSha })
        json(response, 202, { protocol: PROTOCOL, jobId }, auth.headers)
        return
      }

      error(response, 404, 'NOT_FOUND')
    } catch {
      if (!response.headersSent) error(response, 500, 'BRIDGE_INTERNAL_ERROR')
      else response.destroy()
    }
  })

  try {
    await new Promise((resolve, reject) => {
      nodeServer.once('error', reject)
      nodeServer.listen(port, host, resolve)
    })
  } catch (cause) {
    if (cause?.code === 'EADDRINUSE') throw new Error('BRIDGE_PORT_IN_USE')
    throw cause
  }

  return {
    address: () => nodeServer.address(),
    close: () => new Promise((resolve, reject) => nodeServer.close((error) => (error ? reject(error) : resolve()))),
  }
}
