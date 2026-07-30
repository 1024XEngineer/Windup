/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'

import type { PlaytestPreviewModel, PreviewAction, PreviewFrame } from '../model/types'
import { createAssetExportPlan, exportGameAssets, type AssetExportRuntime } from './asset-export'

function frame(index: number): PreviewFrame {
  return {
    imageUrl: `/frames/walk-${index}.png`,
    durationMs: 100 + index,
    rootMotion: { dx: index, dy: 0 },
    keyFrame: index === 0,
  }
}

function action(frameCount = 9): PreviewAction {
  return {
    id: 'walk-abcdef12',
    name: 'Walk / Forward',
    type: 'walk',
    fps: 10,
    sequences: [
      {
        direction: 'south',
        frames: Array.from({ length: frameCount }, (_, index) => frame(index)),
      },
    ],
  }
}

const model: PlaytestPreviewModel = {
  characterId: 'character-1',
  characterName: 'Aster',
  outfitId: 'outfit-1',
  outfitName: 'Explorer',
  characterTemplateUrl: null,
  baseFrameCount: 0,
  actions: [action(), action(0)],
}

async function readStoredZip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const entries = new Map<string, Uint8Array>()
  let offset = 0

  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength))
    entries.set(name, bytes.slice(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }
  return entries
}

function runtime(failingUrl: string | null = null): AssetExportRuntime {
  return {
    fetchFrame: vi.fn(async (url) => {
      if (url === failingUrl) throw new Error('missing')
      return new Blob([`original:${url}`], { type: 'image/png' })
    }),
    decodeFrame: vi.fn(async (blob) => ({
      source: {} as CanvasImageSource,
      width: blob.size % 2 === 0 ? 32 : 24,
      height: 40,
      close: vi.fn(),
    })),
    createCanvas: vi.fn((width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      Object.defineProperty(canvas, 'getContext', {
        value: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
      })
      Object.defineProperty(canvas, 'toBlob', {
        value: (callback: BlobCallback) => callback(new Blob(['sheet'], { type: 'image/png' })),
      })
      return canvas
    }),
  }
}

describe('asset export', () => {
  it('plans non-empty sequences and wraps after eight columns', () => {
    const plan = createAssetExportPlan(model)

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({
      columns: 8,
      rows: 2,
      folder: 'actions/Walk-Forward-abcdef12/south',
    })
    expect(plan[0]?.frames.map((item) => item.filename)).toEqual([
      '000.png',
      '001.png',
      '002.png',
      '003.png',
      '004.png',
      '005.png',
      '006.png',
      '007.png',
      '008.png',
    ])
  })

  it('creates a zip containing only original frames, a sprite sheet and animation json', async () => {
    const phases: string[] = []
    const result = await exportGameAssets(model, runtime(), (phase) => phases.push(phase))
    const entries = await readStoredZip(result.blob)
    const names = [...entries.keys()]

    expect(result).toMatchObject({ filename: 'windup-Aster-Explorer.zip', incomplete: false })
    expect(phases).toEqual(['collecting', 'rendering', 'packing'])
    expect(names).toContain('actions/Walk-Forward-abcdef12/south/sprite-sheet.png')
    expect(names).toContain('actions/Walk-Forward-abcdef12/south/animation.json')
    expect(names.filter((name) => name.includes('/frames/'))).toHaveLength(9)
    expect(names.some((name) => /manifest|audit/i.test(name))).toBe(false)

    const jsonBytes = entries.get('actions/Walk-Forward-abcdef12/south/animation.json')
    const animation = JSON.parse(new TextDecoder().decode(jsonBytes))
    expect(animation.spriteSheet).toMatchObject({ columns: 8, rows: 2 })
    expect(animation.frames[0]).toMatchObject({
      index: 0,
      source: 'frames/000.png',
      available: true,
      durationMs: 100,
      keyFrame: true,
    })
  })

  it('keeps a transparent cell and marks a failed original frame unavailable', async () => {
    const result = await exportGameAssets(model, runtime('/frames/walk-4.png'))
    const entries = await readStoredZip(result.blob)
    const animation = JSON.parse(
      new TextDecoder().decode(entries.get('actions/Walk-Forward-abcdef12/south/animation.json')),
    )

    expect(result.incomplete).toBe(true)
    expect(entries.has('actions/Walk-Forward-abcdef12/south/frames/004.png')).toBe(false)
    expect(animation.frames[4]).toMatchObject({
      index: 4,
      source: 'frames/004.png',
      available: false,
    })
  })

  it('releases decoded images when sprite-sheet rendering fails', async () => {
    const baseRuntime = runtime()
    const closes: Array<ReturnType<typeof vi.fn>> = []
    const failingRuntime: AssetExportRuntime = {
      ...baseRuntime,
      decodeFrame: vi.fn(async () => {
        const close = vi.fn()
        closes.push(close)
        return { source: {} as CanvasImageSource, width: 24, height: 40, close }
      }),
      createCanvas: vi.fn((width, height) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        Object.defineProperty(canvas, 'getContext', { value: () => null })
        return canvas
      }),
    }

    await expect(exportGameAssets(model, failingRuntime)).rejects.toThrow(
      '浏览器无法创建 Sprite Sheet',
    )
    expect(closes).toHaveLength(9)
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  })
})
