export const COCOS_BRIDGE_PROTOCOL = 'windup-cocos-bridge/1.0.0'
export const COCOS_BRIDGE_TOKEN_KEY = 'windup:cocos-bridge:token:v1'

export type CocosBridgeErrorCode =
  | 'PLUGIN_UNAVAILABLE'
  | 'PAIRING_REQUIRED'
  | 'ORIGIN_DENIED'
  | 'VERSION_UNSUPPORTED'
  | 'IMPORT_FAILED'

export interface CocosBridgeErrorDetails {
  jobCode: string
  phase: CocosImportPhase
  rolledBack: boolean
}

export class CocosBridgeError extends Error {
  readonly code: CocosBridgeErrorCode
  readonly status?: number
  readonly jobCode?: string
  readonly phase?: CocosImportPhase
  readonly rolledBack?: boolean

  constructor(
    code: CocosBridgeErrorCode,
    message: string,
    status?: number,
    details?: CocosBridgeErrorDetails,
  ) {
    super(message)
    this.name = 'CocosBridgeError'
    this.code = code
    this.status = status
    this.jobCode = details?.jobCode
    this.phase = details?.phase
    this.rolledBack = details?.rolledBack
  }
}

export interface CocosBridgeHealth {
  protocol: typeof COCOS_BRIDGE_PROTOCOL
  creatorVersion: string | null
  projectName: string | null
  projectOpen: boolean
  paired: boolean
}

export type CocosImportPhase =
  | 'queued'
  | 'validating'
  | 'converting'
  | 'writing'
  | 'refreshing'
  | 'verifying'

export interface CocosImportResult {
  projectName: string
  dbUrl: string
  animationCount: number
  frameCount: number
}

export interface CocosImportJob {
  protocol: typeof COCOS_BRIDGE_PROTOCOL
  jobId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  phase: CocosImportPhase
  result?: CocosImportResult
  error?: { code: string; message: string; rolledBack: boolean }
}

export interface CocosBridgeClientOptions {
  fetch?: typeof globalThis.fetch
  storage?: Storage
  crypto?: Crypto
  baseUrl?: string
  healthTimeoutMs?: number
  uploadTimeoutMs?: number
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:17832'

export class CocosBridgeClient {
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly storage: Storage
  private readonly cryptoImpl: Crypto
  private readonly baseUrl: string
  private readonly healthTimeoutMs: number
  private readonly uploadTimeoutMs: number

  constructor(options: CocosBridgeClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.storage = options.storage ?? globalThis.localStorage
    this.cryptoImpl = options.crypto ?? globalThis.crypto
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.healthTimeoutMs = options.healthTimeoutMs ?? 2_000
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? 30_000
  }

  async health(): Promise<CocosBridgeHealth> {
    const body = await this.request('/v1/health', {}, this.healthTimeoutMs, false)
    const record = expectRecord(body, 'health')
    assertProtocol(record)
    const paired = expectBoolean(record.paired, 'health.paired')
    if (!paired) {
      return {
        protocol: COCOS_BRIDGE_PROTOCOL,
        creatorVersion: null,
        projectName: null,
        projectOpen: false,
        paired: false,
      }
    }
    return {
      protocol: COCOS_BRIDGE_PROTOCOL,
      creatorVersion: expectString(record.creatorVersion, 'health.creatorVersion'),
      projectName:
        record.projectName === null ? null : expectString(record.projectName, 'health.projectName'),
      projectOpen: expectBoolean(record.projectOpen, 'health.projectOpen'),
      paired,
    }
  }

  async pair(code: string): Promise<void> {
    const body = await this.request(
      '/v1/pair',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      },
      this.healthTimeoutMs,
      false,
    )
    const record = expectRecord(body, 'pair')
    assertProtocol(record)
    this.storage.setItem(COCOS_BRIDGE_TOKEN_KEY, expectString(record.token, 'pair.token'))
  }

  async submit(blob: Blob, requestId: string): Promise<{ jobId: string }> {
    const digest = await this.cryptoImpl.subtle.digest('SHA-256', await blob.arrayBuffer())
    const sha256 = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
    const body = await this.request(
      '/v1/imports',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          'X-Windup-Protocol': COCOS_BRIDGE_PROTOCOL,
          'X-Windup-Request-Id': requestId,
          'X-Windup-SHA256': sha256,
        },
        body: blob,
      },
      this.uploadTimeoutMs,
      true,
    )
    const record = expectRecord(body, 'submit')
    assertProtocol(record)
    return { jobId: expectString(record.jobId, 'submit.jobId') }
  }

  async getJob(jobId: string): Promise<CocosImportJob> {
    const body = await this.request(
      `/v1/imports/${encodeURIComponent(jobId)}`,
      { headers: { 'X-Windup-Protocol': COCOS_BRIDGE_PROTOCOL } },
      this.healthTimeoutMs,
      true,
    )
    const record = expectRecord(body, 'job')
    assertProtocol(record)
    const status = expectEnum(
      record.status,
      ['queued', 'running', 'completed', 'failed'],
      'job.status',
    )
    const phase = expectEnum(
      record.phase,
      ['queued', 'validating', 'converting', 'writing', 'refreshing', 'verifying'],
      'job.phase',
    )
    const job: CocosImportJob = {
      protocol: COCOS_BRIDGE_PROTOCOL,
      jobId: expectString(record.jobId, 'job.jobId'),
      status,
      phase,
    }
    if (record.result !== undefined) job.result = parseResult(record.result)
    if (record.error !== undefined) job.error = parseJobError(record.error)
    return job
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    authenticated: boolean,
  ): Promise<unknown> {
    const headers = new Headers(init.headers)
    if (authenticated) {
      const token = this.storage.getItem(COCOS_BRIDGE_TOKEN_KEY)
      if (!token) throw new CocosBridgeError('PAIRING_REQUIRED', '请先与 Cocos Creator 插件配对')
      headers.set('Authorization', `Bearer ${token}`)
    }
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      })
      const body = await readJson(response)
      if (!response.ok) {
        if (response.status === 401) {
          this.storage.removeItem(COCOS_BRIDGE_TOKEN_KEY)
          throw new CocosBridgeError('PAIRING_REQUIRED', '连接已失效，请重新配对', response.status)
        }
        if (response.status === 403) {
          throw new CocosBridgeError(
            'ORIGIN_DENIED',
            '当前网页来源未获 Creator 插件授权',
            response.status,
          )
        }
        if (response.status === 426) {
          throw new CocosBridgeError(
            'VERSION_UNSUPPORTED',
            'Creator 插件协议版本不兼容',
            response.status,
          )
        }
        throw new CocosBridgeError('IMPORT_FAILED', errorMessage(body), response.status)
      }
      return body
    } catch (error) {
      if (error instanceof CocosBridgeError) throw error
      throw new CocosBridgeError(
        'PLUGIN_UNAVAILABLE',
        error instanceof DOMException && error.name === 'AbortError'
          ? '连接 Cocos Creator 插件超时'
          : '未检测到 Cocos Creator 插件',
      )
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new CocosBridgeError('IMPORT_FAILED', 'Creator 插件返回了无法解析的数据', response.status)
  }
}

function assertProtocol(record: Record<string, unknown>): void {
  if (record.protocol !== COCOS_BRIDGE_PROTOCOL) {
    throw new CocosBridgeError('VERSION_UNSUPPORTED', 'Creator 插件协议版本不兼容')
  }
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CocosBridgeError('IMPORT_FAILED', `${field} 返回格式错误`)
  }
  return value as Record<string, unknown>
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CocosBridgeError('IMPORT_FAILED', `${field} 必须是非空字符串`)
  }
  return value
}

function expectBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean')
    throw new CocosBridgeError('IMPORT_FAILED', `${field} 必须是布尔值`)
  return value
}

function expectNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CocosBridgeError('IMPORT_FAILED', `${field} 必须是数字`)
  }
  return value
}

function expectEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new CocosBridgeError('IMPORT_FAILED', `${field} 非法`)
  }
  return value as T[number]
}

function parseResult(value: unknown): CocosImportResult {
  const record = expectRecord(value, 'job.result')
  return {
    projectName: expectString(record.projectName, 'job.result.projectName'),
    dbUrl: expectString(record.dbUrl, 'job.result.dbUrl'),
    animationCount: expectNumber(record.animationCount, 'job.result.animationCount'),
    frameCount: expectNumber(record.frameCount, 'job.result.frameCount'),
  }
}

function parseJobError(value: unknown): CocosImportJob['error'] {
  const record = expectRecord(value, 'job.error')
  return {
    code: expectString(record.code, 'job.error.code'),
    message: expectString(record.message, 'job.error.message'),
    rolledBack: expectBoolean(record.rolledBack, 'job.error.rolledBack'),
  }
}

function errorMessage(value: unknown): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const message = (value as Record<string, unknown>).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return 'Cocos 导入失败'
}
