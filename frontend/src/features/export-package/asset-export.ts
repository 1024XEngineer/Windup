import { GIFEncoder, applyPalette, quantize } from 'gifenc'

import {
  EXPORT_PACKAGE_JSON_SCHEMA_TEXT,
  EXPORT_PACKAGE_SCHEMA_VERSION,
  type GenericExportMetadata,
  validateExportPackageModel,
} from './contract'
import type { ExportAction, ExportFrame, ExportPackageModel, ExportSequence } from './model'

export type AssetExportPhase = 'validating' | 'collecting' | 'rendering' | 'packing'

export interface AssetExportResult {
  blob: Blob
  filename: string
}

export interface DecodedFrame {
  source: CanvasImageSource
  width: number
  height: number
  close(): void
}

export interface AssetExportRuntime {
  fetchFrame(url: string): Promise<Blob>
  decodeFrame(blob: Blob): Promise<DecodedFrame>
  createCanvas(width: number, height: number): HTMLCanvasElement
}

export interface PlannedFrame {
  frame: ExportFrame
  index: number
  filename: string
  relativeFile: string
}

export interface PlannedSequence {
  action: ExportAction
  sequence: ExportSequence
  exportName: string
  framesFolder: string
  atlasFile: string
  previewFile: string
  columns: number
  rows: number
  frames: readonly PlannedFrame[]
}

export interface AssetExportTargetFile {
  /** 相对于 targets/<target-id>/ 的路径。 */
  path: string
  data: Blob | string | Uint8Array
}

export interface AssetExportTargetContext {
  model: ExportPackageModel
  metadata: GenericExportMetadata
  plan: readonly PlannedSequence[]
}

/** 新引擎只实现 target，不应修改通用 meta.json、frames、atlas 与 preview。 */
export interface AssetExportTarget {
  id: string
  createFiles(context: AssetExportTargetContext): Promise<readonly AssetExportTargetFile[]>
}

export interface ExportGameAssetsOptions {
  runtime?: AssetExportRuntime
  targets?: readonly AssetExportTarget[]
  onPhase?: (phase: AssetExportPhase) => void
}

interface LoadedFrame extends PlannedFrame {
  data: Uint8Array
  decoded: DecodedFrame
}

interface LoadedSequence {
  item: PlannedSequence
  frames: readonly LoadedFrame[]
}

interface ZipEntry {
  name: string
  data: Uint8Array
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function idSuffix(id: string): string {
  return safeSegment(id, 'id').slice(-8) || 'id'
}

function packageRoot(model: ExportPackageModel): string {
  return `${safeSegment(model.characterName, 'character')}-${safeSegment(model.characterId, 'id')}`
}

function uniqueActionName(
  action: ExportAction,
  sequence: ExportSequence,
  usedNames: Set<string>,
): string {
  const baseName = safeSegment(action.name, 'action')
  const direction = safeSegment(sequence.direction, 'default')
  const candidate = direction === 'default' ? baseName : `${baseName}-${direction}`
  const unique = usedNames.has(candidate) ? `${candidate}-${idSuffix(action.id)}` : candidate
  if (usedNames.has(unique)) throw new Error(`actions.name: 导出动作名重复：${unique}`)
  usedNames.add(unique)
  return unique
}

export function createAssetExportPlan(model: ExportPackageModel): readonly PlannedSequence[] {
  const usedNames = new Set<string>()
  return model.actions.flatMap((action) =>
    action.sequences.flatMap((sequence) => {
      if (sequence.frames.length === 0) return []
      const exportName = uniqueActionName(action, sequence, usedNames)
      const columns = Math.min(8, sequence.frames.length)
      return [
        {
          action,
          sequence,
          exportName,
          framesFolder: `frames/${exportName}`,
          atlasFile: `atlas/${exportName}.png`,
          previewFile: `preview/${exportName}.gif`,
          columns,
          rows: Math.ceil(sequence.frames.length / columns),
          frames: sequence.frames.map((currentFrame, index) => {
            const filename = `${exportName}_${String(index).padStart(3, '0')}.png`
            return {
              frame: currentFrame,
              index,
              filename,
              relativeFile: `frames/${exportName}/${filename}`,
            }
          }),
        },
      ]
    }),
  )
}

const defaultRuntime: AssetExportRuntime = {
  async fetchFrame(url) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.blob()
  },
  async decodeFrame(blob) {
    const bitmap = await createImageBitmap(blob)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }
  },
  createCanvas(width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  },
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('atlas: PNG 编码失败'))
      else resolve(blob)
    }, 'image/png')
  })
}

async function bytes(data: Blob | string | Uint8Array): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  return new Uint8Array(await data.arrayBuffer())
}

function hasPngSignature(data: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  return signature.every((value, index) => data[index] === value)
}

/**
 * MIME 只能说明“服务端声称是 PNG”，不能证明文件真的可用或带透明信息。
 * 因此这里读取 PNG 头，并兼容 RGBA、灰度 Alpha 与带 tRNS 块的索引 PNG。
 */
function assertPngWithAlpha(data: Uint8Array, field: string): void {
  if (data.length < 33 || !hasPngSignature(data)) throw new Error(`${field}: 必须是有效 PNG`)
  const colorType = data[25]
  if (colorType === 4 || colorType === 6) return

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  while (offset + 12 <= data.length) {
    const chunkLength = view.getUint32(offset, false)
    const chunkEnd = offset + 12 + chunkLength
    if (chunkEnd > data.length) break
    const chunkName = String.fromCharCode(...data.slice(offset + 4, offset + 8))
    if (chunkName === 'tRNS') return
    if (chunkName === 'IEND') break
    offset = chunkEnd
  }
  throw new Error(`${field}: PNG 必须包含 Alpha 透明通道`)
}

async function loadFrame(
  planned: PlannedFrame,
  runtime: AssetExportRuntime,
  cache: Map<string, Promise<Blob>>,
): Promise<LoadedFrame> {
  const field = `${planned.relativeFile}`
  let pending = cache.get(planned.frame.imageUrl)
  if (pending === undefined) {
    pending = runtime.fetchFrame(planned.frame.imageUrl)
    cache.set(planned.frame.imageUrl, pending)
  }

  let blob: Blob
  try {
    blob = await pending
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误'
    throw new Error(`${field}: 图片读取失败（${reason}）`)
  }
  if (blob.type.toLowerCase() !== 'image/png') throw new Error(`${field}: 文件类型必须是 image/png`)
  const data = await bytes(blob)
  assertPngWithAlpha(data, field)

  let decoded: DecodedFrame
  try {
    decoded = await runtime.decodeFrame(blob)
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误'
    throw new Error(`${field}: PNG 解码失败（${reason}）`)
  }
  return { ...planned, data, decoded }
}

async function loadAllFrames(
  plan: readonly PlannedSequence[],
  model: ExportPackageModel,
  runtime: AssetExportRuntime,
): Promise<readonly LoadedSequence[]> {
  const cache = new Map<string, Promise<Blob>>()
  const references = plan.flatMap((item) => item.frames.map((frame) => ({ item, frame })))
  const settled = await Promise.allSettled(
    references.map(async ({ item, frame }) => {
      const loaded = await loadFrame(frame, runtime, cache)
      if (
        loaded.decoded.width !== model.canvas.width ||
        loaded.decoded.height !== model.canvas.height
      ) {
        loaded.decoded.close()
        throw new Error(
          `${frame.relativeFile}: 画布应为 ${model.canvas.width}x${model.canvas.height}，实际为 ${loaded.decoded.width}x${loaded.decoded.height}`,
        )
      }
      return { item, loaded }
    }),
  )

  const fulfilled = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
  const failure = settled.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    fulfilled.forEach(({ loaded }) => loaded.decoded.close())
    throw failure.reason
  }

  return plan.map((item) => ({
    item,
    frames: fulfilled.filter((result) => result.item === item).map((result) => result.loaded),
  }))
}

function context2d(canvas: HTMLCanvasElement, field: string): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error(`${field}: 浏览器无法创建 2D 画布`)
  return context
}

async function renderAtlas(
  loaded: LoadedSequence,
  model: ExportPackageModel,
  runtime: AssetExportRuntime,
): Promise<Blob> {
  const canvas = runtime.createCanvas(
    model.canvas.width * loaded.item.columns,
    model.canvas.height * loaded.item.rows,
  )
  const context = context2d(canvas, loaded.item.atlasFile)
  context.clearRect(0, 0, canvas.width, canvas.height)
  loaded.frames.forEach((frame) => {
    const column = frame.index % loaded.item.columns
    const row = Math.floor(frame.index / loaded.item.columns)
    context.drawImage(frame.decoded.source, column * model.canvas.width, row * model.canvas.height)
  })
  return canvasPng(canvas)
}

function renderGif(
  loaded: LoadedSequence,
  model: ExportPackageModel,
  runtime: AssetExportRuntime,
): Blob {
  const canvas = runtime.createCanvas(model.canvas.width, model.canvas.height)
  const context = context2d(canvas, loaded.item.previewFile)
  const gif = GIFEncoder()

  loaded.frames.forEach((frame) => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(frame.decoded.source, 0, 0)
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
    const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true })
    const indexed = applyPalette(rgba, palette, 'rgba4444')
    const transparentIndex = palette.findIndex((color) => color[3] === 0)
    gif.writeFrame(indexed, canvas.width, canvas.height, {
      palette,
      delay: frame.frame.durationMs,
      repeat: loaded.item.sequence.loop ? 0 : -1,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
    })
  })
  gif.finish()
  const output = gif.bytes()
  const buffer = new ArrayBuffer(output.length)
  new Uint8Array(buffer).set(output)
  return new Blob([buffer], { type: 'image/gif' })
}

function createMetadata(
  model: ExportPackageModel,
  plan: readonly PlannedSequence[],
): GenericExportMetadata {
  return {
    schema_version: EXPORT_PACKAGE_SCHEMA_VERSION,
    character: { id: model.characterId, name: model.characterName },
    canvas: { w: model.canvas.width, h: model.canvas.height },
    actions: plan.map((item) => ({
      name: item.exportName,
      fps: item.action.fps,
      loop: item.sequence.loop,
      frames: item.frames.map((frame) => ({ index: frame.index, file: frame.filename })),
      anchor: { ...item.sequence.anchor },
      foot_y: item.sequence.footY,
      atlas: {
        file: item.atlasFile,
        cols: item.columns,
        rows: item.rows,
        cell: { w: model.canvas.width, h: model.canvas.height },
      },
      preview: item.previewFile,
    })),
    source: {
      workflow_run_id: model.source.workflowRunId,
      generation_ids: [...model.source.generationIds],
    },
  }
}

function createReadme(model: ExportPackageModel): string {
  return `# ${model.characterName} 导出包

这是 Windup 通用资产包，契约版本为 ${EXPORT_PACKAGE_SCHEMA_VERSION}。

## 内容

- \`meta.json\`: 动作、帧率、循环、画布、锚点、脚底线、图集与生成记录。
- \`frames/<action>/\`: 连续编号的透明 PNG 原始帧。
- \`atlas/<action>.png\`: 按 \`meta.json\` 中 cols、rows 和 cell 切分的图集。
- \`preview/<action>.gif\`: 动作预览。
- \`schema.json\`: 校验 \`meta.json\` 的 JSON Schema。
- \`targets/<target>/\`: 可选引擎适配器产生的原生文件。

## 坐标

通用层原点在画布左上角，y 轴向下；anchor 的 x/y 都是 0 到 1。
引擎 target 负责坐标换算。例如 Cocos Creator 使用左下角原点，需要换算为 (x, 1-y)。

## Cocos Creator 状态

本包没有伪造 .anim 或 .meta。Issue #94 要求先在真实 Creator 3.x 中确认图集切分、UUID 和版本格式；
验证完成前只能使用通用 frames、atlas 和 meta.json，不能声称“拖入即播放”。
`
}

function safeTargetPath(targetId: string, path: string, index: number): string {
  const normalized = path.replace(/\\/g, '/')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error(`targets.${targetId}.files[${index}].path: 必须是安全的相对路径`)
  }
  return `targets/${safeSegment(targetId, 'target')}/${normalized}`
}

function uint32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let value = 0; value < 256; value += 1) {
    let current = value
    for (let bit = 0; bit < 8; bit += 1) {
      current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
    }
    table[value] = current >>> 0
  }
  return table
}

const CRC32_TABLE = uint32Table()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const value of data) crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ value) & 0xff] ?? 0)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function storedZip(entries: readonly ZipEntry[]): Blob {
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  const encoder = new TextEncoder()
  const timestamp = dosDateTime(new Date())
  let localOffset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const checksum = crc32(entry.data)
    const local = new Uint8Array(30 + name.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, timestamp.time, true)
    localView.setUint16(12, timestamp.date, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, entry.data.length, true)
    localView.setUint32(22, entry.data.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    localChunks.push(local, entry.data)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, timestamp.time, true)
    centralView.setUint16(14, timestamp.date, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, entry.data.length, true)
    centralView.setUint32(24, entry.data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, localOffset, true)
    central.set(name, 46)
    centralChunks.push(central)
    localOffset += local.length + entry.data.length
  }

  const centralDirectory = concat(centralChunks)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralDirectory.length, true)
  endView.setUint32(16, localOffset, true)
  const output = concat([...localChunks, centralDirectory, end])
  const buffer = new ArrayBuffer(output.length)
  new Uint8Array(buffer).set(output)
  return new Blob([buffer], { type: 'application/zip' })
}

export async function exportGameAssets(
  model: ExportPackageModel,
  options: ExportGameAssetsOptions = {},
): Promise<AssetExportResult> {
  const runtime = options.runtime ?? defaultRuntime
  options.onPhase?.('validating')
  validateExportPackageModel(model)
  const plan = createAssetExportPlan(model)
  const metadata = createMetadata(model, plan)

  options.onPhase?.('collecting')
  const loaded = await loadAllFrames(plan, model, runtime)
  const root = packageRoot(model)
  const entries: ZipEntry[] = []

  try {
    options.onPhase?.('rendering')
    for (const current of loaded) {
      for (const frame of current.frames) {
        entries.push({ name: `${root}/${frame.relativeFile}`, data: frame.data })
      }
      entries.push({
        name: `${root}/${current.item.atlasFile}`,
        data: await bytes(await renderAtlas(current, model, runtime)),
      })
      entries.push({
        name: `${root}/${current.item.previewFile}`,
        data: await bytes(renderGif(current, model, runtime)),
      })
    }

    entries.push(
      {
        name: `${root}/meta.json`,
        data: await bytes(JSON.stringify(metadata, null, 2)),
      },
      { name: `${root}/schema.json`, data: await bytes(EXPORT_PACKAGE_JSON_SCHEMA_TEXT) },
      { name: `${root}/README.md`, data: await bytes(createReadme(model)) },
    )

    for (const target of options.targets ?? []) {
      const targetId = safeSegment(target.id, 'target')
      const files = await target.createFiles({ model, metadata, plan })
      for (const [index, file] of files.entries()) {
        entries.push({
          name: `${root}/${safeTargetPath(targetId, file.path, index)}`,
          data: await bytes(file.data),
        })
      }
    }
  } finally {
    loaded.forEach(({ frames }) => frames.forEach((frame) => frame.decoded.close()))
  }

  const duplicate = entries.find(
    (entry, index) => entries.findIndex((item) => item.name === entry.name) !== index,
  )
  if (duplicate !== undefined) throw new Error(`package.files: 文件路径重复：${duplicate.name}`)

  options.onPhase?.('packing')
  return {
    blob: storedZip(entries),
    filename: `windup-${root}.zip`,
  }
}
