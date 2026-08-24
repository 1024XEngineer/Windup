/** @vitest-environment jsdom */
// Standalone e2e dump harness — writes the real generated ZIP to
// `frontend/dist/cocos-e2e/windup-Hero-char-42-Ranger-outfit-7.zip` so a human
// can unzip it and inspect the manifest / README / frames / atlas.
// Run only via `vitest run src/features/export-package/cocos-target.e2e.extract.test.ts`.

import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cocosCreatorTarget } from './cocos-target'
import { exportGameAssets } from './asset-export'
import type { AssetExportRuntime, DecodedFrame } from './asset-export'
import type { ExportPackageModel } from './model'

const CANVAS_W = 64
const CANVAS_H = 64

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
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, payload])), 0)
  return Buffer.concat([len, t, payload, crc])
}

function makePng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(6, 9)
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)
  const row = width * 4 + 1
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * row] = 0
    for (let x = 0; x < width; x += 1) {
      const off = y * row + 1 + x * 4
      raw[off] = 0
      raw[off + 1] = 0
      raw[off + 2] = 0
      raw[off + 3] = 0
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('Cocos Creator 一键导出 e2e — 落盘', () => {
  it('把真实 ZIP 写到 dist/cocos-e2e/ 给人工 unzip 看', async () => {
    const pngBuffer = makePng(CANVAS_W, CANVAS_H)
    const model: ExportPackageModel = {
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
    const runtime: AssetExportRuntime = {
      fetchFrame: async () => new Blob([new Uint8Array(pngBuffer)], { type: 'image/png' }),
      decodeFrame: async (): Promise<DecodedFrame> => ({
        source: new Blob([new Uint8Array(pngBuffer)], {
          type: 'image/png',
        }) as unknown as CanvasImageSource,
        width: CANVAS_W,
        height: CANVAS_H,
        close: () => undefined,
      }),
      createCanvas: (w, h) => {
        const ctx = {
          clearRect: () => undefined,
          drawImage: () => undefined,
        } as unknown as CanvasRenderingContext2D
        return {
          width: w,
          height: h,
          getContext: () => ctx,
          toBlob: (cb: (b: Blob | null) => void) =>
            cb(new Blob([new Uint8Array(makePng(w, h))], { type: 'image/png' })),
        } as unknown as HTMLCanvasElement
      },
    }

    const result = await exportGameAssets(model, { runtime, targets: [cocosCreatorTarget] })
    const ab = await result.blob.arrayBuffer()
    const buf = Buffer.from(ab)

    const outDir = resolve(process.cwd(), 'dist/cocos-e2e')
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
    const zipPath = resolve(outDir, 'windup-Hero-char-42-Ranger-outfit-7.zip')
    writeFileSync(zipPath, buf)
    expect(buf.length).toBeGreaterThan(0)
    // eslint-disable-next-line no-console
    console.log(`\n真实 ZIP 已落盘: ${zipPath} (${buf.length} bytes)`)
  }, 30_000)
})
