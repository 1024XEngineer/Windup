/** @vitest-environment jsdom */
// Vitest needs the @vitest-environment jsdom header so createElement('canvas') exists.
// This is an end-to-end probe: actually runs `exportGameAssets` with the cocos target,
// decompresses the resulting ZIP in plain Node, and asserts every expected file is there
// with valid contents (manifest json, README, frames PNG, atlas PNG, schema, meta).

import { afterAll, describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'

import { cocosCreatorTarget } from './cocos-target'
import {
  createAssetExportPlan,
  exportGameAssets,
  type AssetExportRuntime,
  type DecodedFrame,
  type PlannedSequence,
} from './asset-export'
import type { ExportPackageModel } from './model'

// ── Tiny RGBA PNG encoder ────────────────────────────────────────────────
function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    c = c ^ data[i]!
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, payload: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(payload.length, 0)
  const typeBytes = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 0)
  return Buffer.concat([len, typeBytes, payload, crc])
}

function makePng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // RGBA
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)
  // 4 bytes per pixel + 1 filter byte per scanline
  const rowBytes = width * 4 + 1
  const raw = Buffer.alloc(rowBytes * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0 // filter: None
    for (let x = 0; x < width; x += 1) {
      const off = y * rowBytes + 1 + x * 4
      raw[off] = 0 // R
      raw[off + 1] = 0 // G
      raw[off + 2] = 0 // B
      raw[off + 3] = 0 // A (transparent)
    }
  }
  const idat = deflateSync(raw)
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Tiny ZIP reader ───────────────────────────────────────────────────────
interface ZipEntry {
  name: string
  data: Buffer
}

function readZip(buffer: Buffer): ZipEntry[] {
  // End of Central Directory record: signature 0x06054b50
  let eocdOffset = -1
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new Error('ZIP: 找不到 EOCD')

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < totalEntries; i += 1) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error(`ZIP: CDFH 签名错 @${p}`)
    const compressedSize = buffer.readUInt32LE(p + 20)
    const uncompressedSize = buffer.readUInt32LE(p + 24)
    const filenameLength = buffer.readUInt16LE(p + 28)
    const extraLength = buffer.readUInt16LE(p + 30)
    const commentLength = buffer.readUInt16LE(p + 32)
    const localHeaderOffset = buffer.readUInt32LE(p + 42)
    const name = buffer.subarray(p + 46, p + 46 + filenameLength).toString('utf8')
    p += 46 + filenameLength + extraLength + commentLength

    // Local file header
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`ZIP: 本地头签名错 @${localHeaderOffset}`)
    }
    const lhFilenameLen = buffer.readUInt16LE(localHeaderOffset + 26)
    const lhExtraLen = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + lhFilenameLen + lhExtraLen
    const compressionMethod = buffer.readUInt16LE(localHeaderOffset + 8)
    if (compressionMethod !== 0) {
      // 全部用 stored,简化路径;若以后需要 deflate 再加
      throw new Error(`ZIP: 不支持压缩方法 ${compressionMethod} for ${name}`)
    }
    const data = buffer.subarray(dataStart, dataStart + compressedSize)
    void uncompressedSize
    entries.push({ name, data })
  }
  return entries
}

// ── Build a realistic model ──────────────────────────────────────────────
const CANVAS_W = 64
const CANVAS_H = 64

function buildModel(): ExportPackageModel {
  return {
    stage: 'action-assets',
    characterId: 'char-42',
    characterName: 'Hero',
    characterImageUrl: 'memory://master.png',
    outfitId: 'outfit-7',
    outfitName: 'Ranger',
    canvas: { width: CANVAS_W, height: CANVAS_H },
    source: { workflowRunId: 'run-99', generationIds: ['gen-1', 'gen-2'] },
    firstFrames: [
      {
        actionId: 'walk-abcdef1234',
        name: 'Walk',
        type: 'walk',
        fps: 8,
        imageUrl: 'memory://first-walk.png',
      },
    ],
    playtest: null,
    actions: [
      {
        id: 'walk-abcdef1234',
        name: 'Walk',
        type: 'walk',
        fps: 8,
        sequences: [
          {
            direction: 'default',
            expectedFrameCount: 3,
            loop: true,
            anchor: { x: 0.5, y: 0.92 },
            footY: 58,
            qualityStatus: 'passed',
            frames: [
              { index: 0, imageUrl: 'memory://walk-0.png', durationMs: 125 },
              { index: 1, imageUrl: 'memory://walk-1.png', durationMs: 125 },
              { index: 2, imageUrl: 'memory://walk-2.png', durationMs: 125 },
            ],
          },
        ],
      },
    ],
  }
}

// ── Provide a runtime that decodes our in-memory PNGs ───────────────────
const pngBuffer = makePng(CANVAS_W, CANVAS_H)
const pngBlob = new Blob([new Uint8Array(pngBuffer)], { type: 'image/png' })

const runtime: AssetExportRuntime = {
  fetchFrame: async () => new Blob([new Uint8Array(pngBuffer)], { type: 'image/png' }),
  decodeFrame: async (): Promise<DecodedFrame> => {
    return {
      source: pngBlob as unknown as CanvasImageSource,
      width: CANVAS_W,
      height: CANVAS_H,
      close: () => undefined,
    }
  },
  // jsdom 没有真实 canvas 实现,返回一个能骗过 context2d + canvasPng 的假 canvas。
  createCanvas: (w, h) => {
    const stubContext = {
      clearRect: () => undefined,
      drawImage: () => undefined,
    } as unknown as CanvasRenderingContext2D
    const fakeCanvas = {
      width: w,
      height: h,
      getContext: () => stubContext,
      toBlob: (cb: (blob: Blob | null) => void) => {
        // 输出的图集是空 transparent PNG,只要签名 + 头 + 一个 IDAT + IEND 即合法。
        // 这不是真实合成结果(因为我们跳过了 drawImage),但足以验证打包链。
        const atlasPng = makePng(w, h)
        cb(new Blob([new Uint8Array(atlasPng)], { type: 'image/png' }))
      },
    } as unknown as HTMLCanvasElement
    return fakeCanvas
  },
}

// ── The e2e test ─────────────────────────────────────────────────────────
describe('Cocos Creator 一键导出 e2e', () => {
  const result: { name: string; size: number; entries?: ZipEntry[]; error?: unknown } = {
    name: '',
    size: 0,
  }
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalCreateImageBitmap = (globalThis as { createImageBitmap?: unknown })
    .createImageBitmap

  afterAll(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    if (originalCreateImageBitmap === undefined) {
      delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap
    } else {
      ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = originalCreateImageBitmap
    }
  })

  it('生成可解压的 ZIP,且 manifest + README + 通用层完整', async () => {
    URL.createObjectURL = () => 'blob:cocos-e2e' as unknown as string
    URL.revokeObjectURL = () => undefined
    // polyfill createImageBitmap for jsdom
    if (typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap !== 'function') {
      ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = async (
        _blob: Blob,
      ): Promise<ImageBitmap> => {
        // jsdom 没有真实解码,造一个 stub
        return {
          width: CANVAS_W,
          height: CANVAS_H,
          close: () => undefined,
        } as unknown as ImageBitmap
      }
    }

    const model = buildModel()
    const plan: readonly PlannedSequence[] = createAssetExportPlan(model)
    expect(plan.length).toBe(1)
    expect(plan[0]?.frames.length).toBe(3)

    const exportResult = await exportGameAssets(model, {
      runtime,
      targets: [cocosCreatorTarget],
    })
    result.name = exportResult.filename
    result.size = exportResult.blob.size

    expect(exportResult.filename).toMatch(/^windup-.*\.zip$/)
    expect(exportResult.blob.size).toBeGreaterThan(0)

    const ab = await exportResult.blob.arrayBuffer()
    const buffer = Buffer.from(ab)
    const entries = readZip(buffer)
    result.entries = entries
    const paths = entries.map((e) => e.name)

    // 包根 = Hero-char-42-Ranger-outfit-7
    const rootPrefix = 'Hero-char-42-Ranger-outfit-7/'
    for (const p of paths) {
      expect(p.startsWith(rootPrefix)).toBe(true)
    }

    // 通用层必备
    expect(paths).toContain(`${rootPrefix}character/master.png`)
    expect(paths.some((p) => p.startsWith(`${rootPrefix}first-frames/Walk-`))).toBe(true)
    expect(paths).toContain(`${rootPrefix}meta.json`)
    expect(paths).toContain(`${rootPrefix}schema.json`)
    expect(paths).toContain(`${rootPrefix}README.md`)
    expect(paths).toContain(`${rootPrefix}frames/Walk/Walk_000.png`)
    expect(paths).toContain(`${rootPrefix}frames/Walk/Walk_001.png`)
    expect(paths).toContain(`${rootPrefix}frames/Walk/Walk_002.png`)
    expect(paths).toContain(`${rootPrefix}atlas/Walk.png`)

    // 打印真实产物清单,方便人工目视
    // eslint-disable-next-line no-console
    console.log(
      '\n=== Cocos e2e 真实产物 ===\n' +
        `ZIP 文件名: ${exportResult.filename}\n` +
        `ZIP 大小: ${exportResult.blob.size} bytes\n` +
        `共 ${entries.length} 个条目:\n` +
        paths.map((p) => `  ${p}`).join('\n'),
    )

    // Cocos 适配层
    const cocosManifestEntry = entries.find(
      (e) => e.name === `${rootPrefix}targets/cocos-creator/cocos-import.json`,
    )
    const cocosReadmeEntry = entries.find(
      (e) => e.name === `${rootPrefix}targets/cocos-creator/README.md`,
    )
    expect(cocosManifestEntry).toBeDefined()
    expect(cocosReadmeEntry).toBeDefined()

    // Cocos 包内没有 .anim / .meta
    const cocosPaths = entries
      .filter((e) => e.name.includes('targets/cocos-creator/'))
      .map((e) => e.name)
    expect(cocosPaths.some((p) => p.endsWith('.anim'))).toBe(false)
    expect(cocosPaths.some((p) => p.endsWith('.meta'))).toBe(false)

    // 解析 manifest,核对字段
    const manifest = JSON.parse(cocosManifestEntry!.data.toString('utf8'))
    expect(manifest.experimental).toBe(true)
    expect(manifest.engine).toBe('cocos-creator')
    expect(manifest.upstream_issue).toBe(94)
    expect(manifest.schema_version).toBe('windup-cocos-import-1.1.0')
    expect(manifest.package.character_id).toBe('char-42')
    expect(manifest.package.character_name).toBe('Hero')
    expect(manifest.package.outfit_id).toBe('outfit-7')
    expect(manifest.package.outfit_name).toBe('Ranger')
    expect(manifest.package.canvas).toEqual({ w: CANVAS_W, h: CANVAS_H })
    expect(manifest.master.anchor).toEqual({ x: 0.5, y: 0.92 })
    expect(manifest.master.anchor_cocos.x).toBe(0.5)
    expect(manifest.master.anchor_cocos.y).toBeCloseTo(0.08, 10)
    expect(manifest.master.file).toBe('character/master.png')

    expect(manifest.actions.length).toBe(1)
    const action = manifest.actions[0]
    expect(action.id).toBe('walk-abcdef1234')
    expect(action.export_name).toBe('Walk')
    expect(action.direction).toBe('default')
    expect(action.fps).toBe(8)
    expect(action.timing_mode).toBe('per-frame')
    expect(action.loop).toBe(true)
    expect(action.quality_status).toBe('passed')
    expect(action.anchor).toEqual({ x: 0.5, y: 0.92 })
    expect(action.anchor_cocos.x).toBe(0.5)
    expect(action.anchor_cocos.y).toBeCloseTo(0.08, 10)
    expect(action.foot_y).toBe(58)
    expect(action.frames.map((f: { file: string }) => f.file)).toEqual([
      'Walk_000.png',
      'Walk_001.png',
      'Walk_002.png',
    ])
    expect(action.frames.map((f: { duration_ms: number }) => f.duration_ms)).toEqual([
      125, 125, 125,
    ])
    expect(action.atlas).toEqual({
      file: 'atlas/Walk.png',
      cols: 3,
      rows: 1,
      cell: { w: CANVAS_W, h: CANVAS_H },
    })

    // README 含诚实声明
    const readme = cocosReadmeEntry!.data.toString('utf8')
    expect(readme).toMatch(/实验性|experimental/i)
    expect(readme).toMatch(/Issue #94|issues\/94/)
    expect(readme).toMatch(/不生成.*\.anim/)
    expect(readme).toMatch(/不生成.*meta/)
    expect(readme).toMatch(/UUID/)
    expect(readme).toMatch(/Hero/)
    expect(readme).toMatch(/Ranger/)

    // 打印 manifest 和 README 的实际内容,人眼复核
    // eslint-disable-next-line no-console
    console.log('\n=== cocos-import.json ===\n' + JSON.stringify(manifest, null, 2))
    // eslint-disable-next-line no-console
    console.log('\n=== targets/cocos-creator/README.md ===\n' + readme)

    // 通用层 PNG 真的是合法 PNG(头 8 字节 0x89 PNG ...)
    const masterPng = entries.find((e) => e.name === `${rootPrefix}character/master.png`)!
    expect(masterPng.data[0]).toBe(0x89)
    expect(masterPng.data[1]).toBe(0x50)
    expect(masterPng.data[2]).toBe(0x4e)
    expect(masterPng.data[3]).toBe(0x47)
    expect(masterPng.data[4]).toBe(0x0d)
    expect(masterPng.data[5]).toBe(0x0a)
    expect(masterPng.data[6]).toBe(0x1a)
    expect(masterPng.data[7]).toBe(0x0a)

    const framePng = entries.find((e) => e.name === `${rootPrefix}frames/Walk/Walk_000.png`)!
    expect(framePng.data[0]).toBe(0x89)

    const atlasPng = entries.find((e) => e.name === `${rootPrefix}atlas/Walk.png`)!
    expect(atlasPng.data[0]).toBe(0x89)
    // 图集是 3 帧横排,宽 3*64=192,高 64
    expect(atlasPng.data.length).toBeGreaterThan(0)

    // meta.json 是合法 JSON 且符合 schema_version 1.1.0
    const metaEntry = entries.find((e) => e.name === `${rootPrefix}meta.json`)!
    const meta = JSON.parse(metaEntry.data.toString('utf8'))
    expect(meta.schema_version).toBe('1.1.0')
    expect(meta.character.id).toBe('char-42')
    expect(meta.outfit.id).toBe('outfit-7')
    expect(meta.canvas).toEqual({ w: CANVAS_W, h: CANVAS_H })
    expect(meta.actions.length).toBe(1)
    expect(meta.actions[0].name).toBe('Walk')
    expect(meta.actions[0].fps).toBe(8)
    expect(meta.actions[0].atlas.cols).toBe(3)
    expect(meta.actions[0].frames.length).toBe(3)
    expect(meta.source.workflow_run_id).toBe('run-99')
    expect(meta.source.generation_ids).toEqual(['gen-1', 'gen-2'])
  }, 30_000)
})
