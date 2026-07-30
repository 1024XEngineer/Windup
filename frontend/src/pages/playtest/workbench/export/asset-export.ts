import type {
  PlaytestPreviewModel,
  PreviewAction,
  PreviewFrame,
  PreviewSequence,
} from '../model/types'

export type AssetExportPhase = 'collecting' | 'rendering' | 'packing'

export interface AssetExportResult {
  blob: Blob
  filename: string
  incomplete: boolean
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
  frame: PreviewFrame
  index: number
  filename: string
}

export interface PlannedSequence {
  action: PreviewAction
  sequence: PreviewSequence
  folder: string
  columns: number
  rows: number
  frames: readonly PlannedFrame[]
}

interface LoadedFrame extends PlannedFrame {
  blob: Blob | null
  decoded: DecodedFrame | null
  sourceFilename: string
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

function extensionFromUrl(imageUrl: string): string {
  const match = imageUrl.split(/[?#]/, 1)[0]?.match(/\.([a-zA-Z0-9]{2,5})$/)
  return match?.[1]?.toLowerCase() ?? 'png'
}

function extensionForBlob(blob: Blob, imageUrl: string): string {
  const byMime: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  }
  return byMime[blob.type.toLowerCase()] ?? extensionFromUrl(imageUrl)
}

export function createAssetExportPlan(model: PlaytestPreviewModel): readonly PlannedSequence[] {
  return model.actions.flatMap((action) => {
    const actionFolder = `${safeSegment(action.name, 'action')}-${idSuffix(action.id)}`
    return action.sequences.flatMap((sequence) => {
      if (sequence.frames.length === 0) return []
      const columns = Math.min(8, sequence.frames.length)
      return [
        {
          action,
          sequence,
          folder: `actions/${actionFolder}/${safeSegment(sequence.direction, 'default')}`,
          columns,
          rows: Math.ceil(sequence.frames.length / columns),
          frames: sequence.frames.map((currentFrame, index) => ({
            frame: currentFrame,
            index,
            filename: `${String(index).padStart(3, '0')}.${extensionFromUrl(currentFrame.imageUrl)}`,
          })),
        },
      ]
    })
  })
}

const defaultRuntime: AssetExportRuntime = {
  async fetchFrame(url) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`图片读取失败：${response.status}`)
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
      if (blob === null) reject(new Error('Sprite Sheet 编码失败'))
      else resolve(blob)
    }, 'image/png')
  })
}

async function bytes(data: Blob | string): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return new Uint8Array(await data.arrayBuffer())
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
  const arrayBuffer = new ArrayBuffer(output.length)
  new Uint8Array(arrayBuffer).set(output)
  return new Blob([arrayBuffer], { type: 'application/zip' })
}

export async function exportGameAssets(
  model: PlaytestPreviewModel,
  runtime: AssetExportRuntime = defaultRuntime,
  onPhase?: (phase: AssetExportPhase) => void,
): Promise<AssetExportResult> {
  const plan = createAssetExportPlan(model)
  onPhase?.('collecting')
  const blobCache = new Map<string, Promise<Blob>>()
  let incomplete = false

  const loaded = await Promise.all(
    plan.map(async (item) => ({
      item,
      frames: await Promise.all(
        item.frames.map(async (planned): Promise<LoadedFrame> => {
          try {
            let pending = blobCache.get(planned.frame.imageUrl)
            if (pending === undefined) {
              pending = runtime.fetchFrame(planned.frame.imageUrl)
              blobCache.set(planned.frame.imageUrl, pending)
            }
            const blob = await pending
            const decoded = await runtime.decodeFrame(blob)
            const extension = extensionForBlob(blob, planned.frame.imageUrl)
            return {
              ...planned,
              blob,
              decoded,
              sourceFilename: `${String(planned.index).padStart(3, '0')}.${extension}`,
            }
          } catch {
            incomplete = true
            return { ...planned, blob: null, decoded: null, sourceFilename: planned.filename }
          }
        }),
      ),
    })),
  )

  onPhase?.('rendering')
  const zipEntries: ZipEntry[] = []
  try {
    for (const { item, frames } of loaded) {
      const cellWidth = Math.max(1, ...frames.map((current) => current.decoded?.width ?? 0))
      const cellHeight = Math.max(1, ...frames.map((current) => current.decoded?.height ?? 0))
      const canvas = runtime.createCanvas(cellWidth * item.columns, cellHeight * item.rows)
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('浏览器无法创建 Sprite Sheet')
      context.clearRect(0, 0, canvas.width, canvas.height)

      const animationFrames = frames.map((current) => {
        const column = current.index % item.columns
        const row = Math.floor(current.index / item.columns)
        const width = current.decoded?.width ?? 0
        const height = current.decoded?.height ?? 0
        const offsetX = Math.floor((cellWidth - width) / 2)
        const offsetY = Math.floor((cellHeight - height) / 2)
        if (current.decoded !== null) {
          context.drawImage(
            current.decoded.source,
            column * cellWidth + offsetX,
            row * cellHeight + offsetY,
          )
        }
        return {
          index: current.index,
          source: `frames/${current.sourceFilename}`,
          available: current.blob !== null,
          x: column * cellWidth + offsetX,
          y: row * cellHeight + offsetY,
          width,
          height,
          originalWidth: width,
          originalHeight: height,
          offsetX,
          offsetY,
          durationMs: current.frame.durationMs,
          keyFrame: current.frame.keyFrame,
          rootMotion: current.frame.rootMotion,
        }
      })

      const sheet = await canvasPng(canvas)
      zipEntries.push({ name: `${item.folder}/sprite-sheet.png`, data: await bytes(sheet) })
      for (const current of frames) {
        if (current.blob === null) continue
        zipEntries.push({
          name: `${item.folder}/frames/${current.sourceFilename}`,
          data: await bytes(current.blob),
        })
      }
      zipEntries.push({
        name: `${item.folder}/animation.json`,
        data: await bytes(
          JSON.stringify(
            {
              schemaVersion: 1,
              action: {
                id: item.action.id,
                name: item.action.name,
                type: item.action.type,
              },
              direction: item.sequence.direction,
              fps: item.action.fps,
              spriteSheet: {
                file: 'sprite-sheet.png',
                width: canvas.width,
                height: canvas.height,
                columns: item.columns,
                rows: item.rows,
                cellWidth,
                cellHeight,
              },
              frames: animationFrames,
            },
            null,
            2,
          ),
        ),
      })
    }
  } finally {
    loaded.forEach(({ frames }) => frames.forEach((current) => current.decoded?.close()))
  }

  onPhase?.('packing')
  return {
    blob: storedZip(zipEntries),
    filename: `windup-${safeSegment(model.characterName, 'character')}-${safeSegment(model.outfitName, 'outfit')}.zip`,
    incomplete,
  }
}
