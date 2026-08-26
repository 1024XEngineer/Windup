import {
  ApiError,
  getApiAccessToken,
  recoverApiUnauthorized,
  resolveApiBaseUrl,
} from '@/shared/api'

import type {
  PixelPerfectApis,
  PixelPerfectMetadata,
  PixelPerfectProcessInput,
  PixelPerfectReconstructInput,
  PixelPerfectReconstructResult,
  PixelPerfectResult,
} from '.'

const PIXEL_PERFECT_PATH = '/tools/pixel-perfect'
const RECONSTRUCT_PATH = `${PIXEL_PERFECT_PATH}/reconstruct`
const OUTPUT_FILENAME = 'pixel-perfect.png'

interface ErrorEnvelope {
  code: number
  message: string
  data: unknown
}

export function createPixelPerfectApis(fetchFn: typeof fetch = globalThis.fetch): PixelPerfectApis {
  return {
    async process({ imageUrl }: PixelPerfectProcessInput): Promise<PixelPerfectResult> {
      const sourceFile = await downloadSourceImage(fetchFn, imageUrl)
      return sendPixelPerfectRequest(fetchFn, sourceFile)
    },
    async reconstruct({
      imageUrl,
      cols,
      rows,
    }: PixelPerfectReconstructInput): Promise<PixelPerfectReconstructResult> {
      const sourceFile = await downloadSourceImage(fetchFn, imageUrl)
      return sendReconstructRequest(fetchFn, sourceFile, cols, rows)
    },
  }
}

async function sendReconstructRequest(
  fetchFn: typeof fetch,
  file: File,
  cols: number,
  rows: number,
  replayed = false,
): Promise<PixelPerfectReconstructResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('cols', String(cols))
  formData.append('rows', String(rows))
  formData.append('structure_colors', '16')
  const headers = new Headers()
  const accessToken = getApiAccessToken()
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)

  let response: Response
  try {
    response = await fetchFn(`${resolveApiBaseUrl()}${RECONSTRUCT_PATH}`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    })
  } catch (cause) {
    throw new ApiError('完美像素请求失败', { kind: 'network', cause })
  }

  const contentType = normalizeContentType(response.headers.get('content-type'))
  if (contentType === 'application/json') {
    const envelope = await readErrorEnvelope(response)
    if (!replayed && envelope.code === 401 && (await recoverApiUnauthorized())) {
      return sendReconstructRequest(fetchFn, file, cols, rows, true)
    }
    throw new ApiError(envelope.message || '完美像素请求失败', {
      kind: response.ok ? 'business' : 'http',
      code: response.ok ? envelope.code : undefined,
      status: response.status,
      data: envelope.data,
    })
  }
  if (!replayed && response.status === 401 && (await recoverApiUnauthorized())) {
    return sendReconstructRequest(fetchFn, file, cols, rows, true)
  }
  if (!response.ok) {
    throw new ApiError(`完美像素请求失败（HTTP ${response.status}）`, {
      kind: 'http',
      status: response.status,
    })
  }
  if (contentType !== 'image/png') {
    throw new ApiError('完美像素接口没有返回 PNG 图片', {
      kind: 'invalid-response',
      status: response.status,
    })
  }

  const metadata = {
    cols: positiveInteger(response.headers.get('x-pixel-cols')),
    rows: positiveInteger(response.headers.get('x-pixel-rows')),
    visibleColors: nonNegativeInteger(response.headers.get('x-pixel-visible-colors')),
  }
  if (metadata.cols === null || metadata.rows === null || metadata.visibleColors === null) {
    throw new ApiError('完美像素接口返回的重建信息无效', {
      kind: 'invalid-response',
      status: response.status,
    })
  }
  return {
    blob: await response.blob(),
    filename: responseFilename(response.headers.get('content-disposition')),
    metadata: {
      cols: metadata.cols,
      rows: metadata.rows,
      visibleColors: metadata.visibleColors,
    },
  }
}

async function downloadSourceImage(fetchFn: typeof fetch, imageUrl: string): Promise<File> {
  let response: Response
  try {
    // 素材地址可能指向第三方对象存储；这里明确不携带 Windup token 或浏览器凭据。
    response = await fetchFn(imageUrl, { credentials: 'omit' })
  } catch (cause) {
    throw new ApiError('源图下载失败', { kind: 'network', cause })
  }

  if (!response.ok) {
    throw new ApiError(`源图下载失败（HTTP ${response.status}）`, {
      kind: 'http',
      status: response.status,
    })
  }

  const contentType = normalizeContentType(response.headers.get('content-type'))
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
    throw new ApiError('源图必须是 PNG 或 JPEG 图片', {
      kind: 'invalid-response',
      status: response.status,
    })
  }

  const blob = await response.blob()
  return new File([blob], sourceFilename(imageUrl, contentType), { type: contentType })
}

async function sendPixelPerfectRequest(
  fetchFn: typeof fetch,
  file: File,
  replayed = false,
): Promise<PixelPerfectResult> {
  const formData = new FormData()
  formData.append('file', file)
  const headers = new Headers()
  const accessToken = getApiAccessToken()
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)

  let response: Response
  try {
    response = await fetchFn(`${resolveApiBaseUrl()}${PIXEL_PERFECT_PATH}`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    })
  } catch (cause) {
    throw new ApiError('完美像素请求失败', { kind: 'network', cause })
  }

  const contentType = normalizeContentType(response.headers.get('content-type'))
  if (contentType === 'application/json') {
    const envelope = await readErrorEnvelope(response)
    if (!replayed && envelope.code === 401 && (await recoverApiUnauthorized())) {
      return sendPixelPerfectRequest(fetchFn, file, true)
    }
    if (!response.ok) {
      throw new ApiError(envelope.message || '完美像素请求失败', {
        kind: 'http',
        status: response.status,
        data: envelope.data,
      })
    }
    throw new ApiError(envelope.message, {
      kind: 'business',
      code: envelope.code,
      status: response.status,
      data: envelope.data,
    })
  }

  if (!replayed && response.status === 401 && (await recoverApiUnauthorized())) {
    return sendPixelPerfectRequest(fetchFn, file, true)
  }
  if (!response.ok) {
    throw new ApiError(`完美像素请求失败（HTTP ${response.status}）`, {
      kind: 'http',
      status: response.status,
    })
  }
  if (contentType !== 'image/png') {
    throw new ApiError('完美像素接口没有返回 PNG 图片', {
      kind: 'invalid-response',
      status: response.status,
    })
  }

  const metadata = parseMetadata(response.headers, response.status)
  return {
    blob: await response.blob(),
    filename: responseFilename(response.headers.get('content-disposition')),
    metadata,
  }
}

async function readErrorEnvelope(response: Response): Promise<ErrorEnvelope> {
  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    throw new ApiError('完美像素接口返回的错误信息无效', {
      kind: 'invalid-response',
      status: response.status,
      cause,
    })
  }
  if (
    !isRecord(value) ||
    typeof value.code !== 'number' ||
    typeof value.message !== 'string' ||
    !Object.hasOwn(value, 'data')
  ) {
    throw new ApiError('完美像素接口返回的错误信息无效', {
      kind: 'invalid-response',
      status: response.status,
      data: value,
    })
  }
  return value as unknown as ErrorEnvelope
}

function parseMetadata(headers: Headers, status: number): PixelPerfectMetadata {
  const cols = positiveInteger(headers.get('x-pixel-cols'))
  const rows = positiveInteger(headers.get('x-pixel-rows'))
  const stepX = positiveNumber(headers.get('x-pixel-step-x'))
  const stepY = positiveNumber(headers.get('x-pixel-step-y'))
  const consensus = nonEmptyHeader(headers.get('x-pixel-consensus'))
  const confidence = nonEmptyHeader(headers.get('x-pixel-confidence'))
  if (
    cols === null ||
    rows === null ||
    stepX === null ||
    stepY === null ||
    consensus === null ||
    confidence === null
  ) {
    throw new ApiError('完美像素接口返回的检测信息无效', {
      kind: 'invalid-response',
      status,
    })
  }
  return { cols, rows, stepX, stepY, consensus, confidence }
}

function normalizeContentType(value: string | null): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function positiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function nonNegativeInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function positiveNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function nonEmptyHeader(value: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function sourceFilename(imageUrl: string, contentType: 'image/png' | 'image/jpeg'): string {
  let name = ''
  try {
    name = decodeURIComponent(
      new URL(imageUrl, 'http://windup.local').pathname.split('/').at(-1) ?? '',
    )
  } catch {
    // URL 无法解析时仍可按已验证的媒体类型生成安全文件名。
  }
  const stem = name.replace(/\.(?:png|jpe?g)$/iu, '').replace(/[^\w.-]+/gu, '-') || 'source'
  return `${stem}${contentType === 'image/png' ? '.png' : '.jpg'}`
}

function responseFilename(contentDisposition: string | null): string {
  const match = contentDisposition?.match(/filename\s*=\s*"?([^";]+)"?/iu)
  const name = match?.[1]?.trim().split(/[\\/]/u).at(-1)
  return name || OUTPUT_FILENAME
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const pixelPerfectApis: PixelPerfectApis = {
  process: (input) => createPixelPerfectApis().process(input),
  reconstruct: (input) => createPixelPerfectApis().reconstruct(input),
}
