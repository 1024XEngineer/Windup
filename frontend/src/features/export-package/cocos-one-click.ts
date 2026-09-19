import { exportGameAssets, type AssetExportPhase, type AssetExportResult } from './asset-export'
import {
  CocosBridgeError,
  type CocosBridgeHealth,
  type CocosImportJob,
  type CocosImportResult,
} from './cocos-bridge-client'
import { cocosCreatorTarget } from './cocos-target'
import type { ExportPackageModel } from './model'

export type CocosOneClickPhase =
  | 'detecting'
  | 'validating'
  | 'packing'
  | 'uploading'
  | 'queued'
  | 'converting'
  | 'writing'
  | 'refreshing'
  | 'verifying'

export interface CocosBridgeApi {
  health(): Promise<CocosBridgeHealth>
  submit(blob: Blob, requestId: string): Promise<{ jobId: string }>
  getJob(jobId: string): Promise<CocosImportJob>
}

export interface CocosImportCache {
  model?: ExportPackageModel
  package?: AssetExportResult
}

export type CocosPackageExporter = (
  model: ExportPackageModel,
  onPhase?: (phase: AssetExportPhase) => void,
) => Promise<AssetExportResult>

export interface ImportIntoCocosOptions {
  exporter?: CocosPackageExporter
  cache?: CocosImportCache
  createRequestId?: () => string
  pollDelay?: () => Promise<void>
  maxPolls?: number
}

const defaultExporter: CocosPackageExporter = (model, onPhase) =>
  exportGameAssets(model, { targets: [cocosCreatorTarget], onPhase })

export async function importIntoCocos(
  model: ExportPackageModel,
  client: CocosBridgeApi,
  onPhase: (phase: CocosOneClickPhase) => void = () => undefined,
  options: ImportIntoCocosOptions = {},
): Promise<CocosImportResult> {
  onPhase('detecting')
  const health = await client.health()
  if (!health.paired) {
    throw new CocosBridgeError('PAIRING_REQUIRED', '请先输入 Creator 插件显示的连接码')
  }
  if (!supportsCreatorVersion(health.creatorVersion)) {
    throw new CocosBridgeError('VERSION_UNSUPPORTED', '一键导入仅支持 Cocos Creator 3.8.8 至 3.8.x')
  }
  if (!health.projectOpen) {
    throw new CocosBridgeError('IMPORT_FAILED', '请先在 Cocos Creator 中打开目标工程')
  }

  const cache = options.cache ?? {}
  let packageResult = cache.model === model ? cache.package : undefined
  if (!packageResult) {
    const exporter = options.exporter ?? defaultExporter
    packageResult = await exporter(model, (phase) => onPhase(mapExportPhase(phase)))
    cache.model = model
    cache.package = packageResult
  }

  onPhase('uploading')
  const requestId = (options.createRequestId ?? (() => crypto.randomUUID()))()
  const submitted = await client.submit(packageResult.blob, requestId)
  const delay =
    options.pollDelay ?? (() => new Promise((resolve) => globalThis.setTimeout(resolve, 500)))
  const maxPolls = options.maxPolls ?? 240

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const job = await client.getJob(submitted.jobId)
    onPhase(mapJobPhase(job))
    if (job.status === 'completed') {
      if (!job.result) throw new CocosBridgeError('IMPORT_FAILED', 'Creator 插件未返回导入结果')
      return job.result
    }
    if (job.status === 'failed') {
      const detail = job.error?.message ?? 'Cocos 导入失败'
      const rollback = job.error?.rolledBack ? '（已回滚本次写入）' : ''
      throw new CocosBridgeError('IMPORT_FAILED', `${detail}${rollback}`, undefined, {
        jobCode: job.error?.code ?? 'IMPORT_FAILED',
        phase: job.phase,
        rolledBack: job.error?.rolledBack ?? false,
      })
    }
    await delay()
  }
  throw new CocosBridgeError('IMPORT_FAILED', '等待 Cocos 导入完成超时')
}

function supportsCreatorVersion(version: string | null): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version ?? '')
  if (!match) return false
  const [, major, minor, patch] = match.map(Number)
  return major === 3 && minor === 8 && patch >= 8
}

function mapExportPhase(phase: AssetExportPhase): CocosOneClickPhase {
  return phase === 'validating' ? 'validating' : 'packing'
}

function mapJobPhase(job: CocosImportJob): CocosOneClickPhase {
  if (job.phase === 'validating') return 'validating'
  if (job.phase === 'converting') return 'converting'
  if (job.phase === 'writing') return 'writing'
  if (job.phase === 'refreshing') return 'refreshing'
  if (job.phase === 'verifying') return 'verifying'
  return 'queued'
}
