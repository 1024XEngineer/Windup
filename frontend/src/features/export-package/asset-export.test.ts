/** @vitest-environment jsdom */
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'

import {
  createAssetExportPlan,
  exportGameAssets,
  type AssetExportRuntime,
  type AssetExportTarget,
} from './asset-export'
import { COCOS_TARGET_READINESS, toCocosAnchor } from './cocos-target'
import { EXPORT_PACKAGE_JSON_SCHEMA_TEXT } from './contract'
import type { ExportAction, ExportFrame, ExportPackageModel } from './model'

function frame(index: number): ExportFrame {
  return {
    index,
    imageUrl: `/frames/walk-${index}.png`,
    durationMs: 100,
  }
}

function action(frameCount = 9): ExportAction {
  return {
    id: 'walk-abcdef12',
    name: 'Walk / Forward',
    type: 'walk',
    fps: 10,
    sequences: [
      {
        direction: 'south',
        expectedFrameCount: frameCount,
        loop: true,
        anchor: { x: 0.5, y: 0.9 },
        footY: 36,
        qualityStatus: 'passed',
        frames: Array.from({ length: frameCount }, (_, index) => frame(index)),
      },
    ],
  }
}

const model: ExportPackageModel = {
  characterId: 'character-1',
  characterName: 'Aster',
  outfitId: 'outfit-1',
  outfitName: 'Explorer',
  canvas: { width: 32, height: 40 },
  source: { workflowRunId: 'run-1', generationIds: ['generation-1'] },
  actions: [action()],
}

/** 构造足够让契约检查识别为 RGBA PNG 的文件头，解码由测试运行时接管。 */
function rgbaPng(type = 'image/png'): Blob {
  const data = new Uint8Array(33)
  data.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  new DataView(data.buffer).setUint32(8, 13, false)
  data.set([73, 72, 68, 82], 12)
  data[25] = 6
  return new Blob([data], { type })
}

async function readStoredZip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const data = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  const entries = new Map<string, Uint8Array>()
  let offset = 0

  while (offset + 4 <= data.length && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = decoder.decode(data.slice(nameStart, nameStart + nameLength))
    entries.set(name, data.slice(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }
  return entries
}

function runtime(failingUrl: string | null = null): AssetExportRuntime {
  return {
    fetchFrame: vi.fn(async (url) => {
      if (url === failingUrl) throw new Error('missing')
      return rgbaPng()
    }),
    decodeFrame: vi.fn(async () => ({
      source: {} as CanvasImageSource,
      width: 32,
      height: 40,
      close: vi.fn(),
    })),
    createCanvas: vi.fn((width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      Object.defineProperty(canvas, 'getContext', {
        value: () => ({
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({
            data: new Uint8ClampedArray(width * height * 4),
          })),
        }),
      })
      Object.defineProperty(canvas, 'toBlob', {
        value: (callback: BlobCallback) => callback(new Blob(['atlas'], { type: 'image/png' })),
      })
      return canvas
    }),
  }
}

describe('asset export', () => {
  it('明确 Cocos 尚未就绪，并只落地已确认的锚点坐标转换', () => {
    expect(COCOS_TARGET_READINESS.ready).toBe(false)
    const anchor = toCocosAnchor({ x: 0.5, y: 0.9 })
    expect(anchor.x).toBe(0.5)
    expect(anchor.y).toBeCloseTo(0.1)
  })

  it('按动作名和方向生成连续三位帧名，并按八列排列图集', () => {
    const plan = createAssetExportPlan(model)

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({
      exportName: 'Walk-Forward-south',
      framesFolder: 'frames/Walk-Forward-south',
      atlasFile: 'atlas/Walk-Forward-south.png',
      columns: 8,
      rows: 2,
    })
    expect(plan[0]?.frames[0]?.filename).toBe('Walk-Forward-south_000.png')
    expect(plan[0]?.frames[8]?.filename).toBe('Walk-Forward-south_008.png')
  })

  it('生成通用目录、透明 PNG、图集、README、Schema 和可校验的动画 meta.json', async () => {
    const phases: string[] = []
    const result = await exportGameAssets(model, {
      runtime: runtime(),
      onPhase: (phase) => phases.push(phase),
    })
    const entries = await readStoredZip(result.blob)
    const root = 'Aster-character-1-Explorer-outfit-1'
    const names = [...entries.keys()]

    expect(result.filename).toBe('windup-Aster-character-1-Explorer-outfit-1.zip')
    expect(phases).toEqual(['validating', 'collecting', 'rendering', 'packing'])
    expect(names).toContain(`${root}/meta.json`)
    expect(names).toContain(`${root}/schema.json`)
    expect(names).toContain(`${root}/README.md`)
    expect(names).toContain(`${root}/atlas/Walk-Forward-south.png`)
    expect(names.filter((name) => name.includes('/frames/'))).toHaveLength(9)

    const meta = JSON.parse(new TextDecoder().decode(entries.get(`${root}/meta.json`)))
    const schema = JSON.parse(EXPORT_PACKAGE_JSON_SCHEMA_TEXT)
    const validate = new Ajv2020().compile(schema)
    expect(validate(meta), JSON.stringify(validate.errors)).toBe(true)
    expect(meta).toMatchObject({
      schema_version: '1.0.0',
      character: { id: 'character-1', name: 'Aster' },
      canvas: { w: 32, h: 40 },
      source: { workflow_run_id: 'run-1', generation_ids: ['generation-1'] },
    })
    expect(meta.actions[0]).toMatchObject({
      name: 'Walk-Forward-south',
      fps: 10,
      loop: true,
      anchor: { x: 0.5, y: 0.9 },
      foot_y: 36,
      atlas: { cols: 8, rows: 2, cell: { w: 32, h: 40 } },
    })
    expect(names.some((name) => name.endsWith('.gif'))).toBe(false)
  })

  it('把 Outfit 标识写入包名，避免同一 Character 的不同造型互相覆盖', async () => {
    const otherOutfit = {
      ...model,
      outfitId: 'outfit-2',
      outfitName: 'Armored',
    }

    const first = await exportGameAssets(model, { runtime: runtime() })
    const second = await exportGameAssets(otherOutfit, { runtime: runtime() })

    expect(first.filename).toBe('windup-Aster-character-1-Explorer-outfit-1.zip')
    expect(second.filename).toBe('windup-Aster-character-1-Armored-outfit-2.zip')
    expect(first.filename).not.toBe(second.filename)
  })

  it('响应 MIME 缺失或过于通用时仍按 PNG 文件字节完成校验', async () => {
    const baseRuntime = runtime()
    const untypedRuntime: AssetExportRuntime = {
      ...baseRuntime,
      fetchFrame: vi.fn(async () => rgbaPng('application/octet-stream')),
    }

    await expect(exportGameAssets(model, { runtime: untypedRuntime })).resolves.toMatchObject({
      filename: 'windup-Aster-character-1-Explorer-outfit-1.zip',
    })
  })

  it('声明帧数与实际帧数不一致时，在读取图片前拒绝导出', async () => {
    const badModel: ExportPackageModel = {
      ...model,
      actions: [
        {
          ...action(),
          sequences: [{ ...action().sequences[0]!, expectedFrameCount: 10 }],
        },
      ],
    }
    const testRuntime = runtime()

    await expect(exportGameAssets(badModel, { runtime: testRuntime })).rejects.toThrow(
      'actions[0].sequences[0].frames: 缺帧，期望 10 帧，实际 9 帧',
    )
    expect(testRuntime.fetchFrame).not.toHaveBeenCalled()
  })

  it('帧序号不是从 0 连续排列时，在读取图片前拒绝导出', async () => {
    const frames = action().sequences[0]!.frames.map((item, index) =>
      index === 4 ? { ...item, index: 7 } : item,
    )
    const badModel: ExportPackageModel = {
      ...model,
      actions: [
        {
          ...action(),
          sequences: [{ ...action().sequences[0]!, frames }],
        },
      ],
    }
    const testRuntime = runtime()

    await expect(exportGameAssets(badModel, { runtime: testRuntime })).rejects.toThrow(
      'actions[0].sequences[0].frames[4].index: 必须连续且等于 4',
    )
    expect(testRuntime.fetchFrame).not.toHaveBeenCalled()
  })

  it('任一原图读取失败时拒绝整个导出，不再生成透明占位包', async () => {
    await expect(
      exportGameAssets(model, { runtime: runtime('/frames/walk-4.png') }),
    ).rejects.toThrow('frames/Walk-Forward-south/Walk-Forward-south_004.png: 图片读取失败')
  })

  it('质量状态未通过时禁止导出', async () => {
    const badModel: ExportPackageModel = {
      ...model,
      actions: [
        {
          ...action(),
          sequences: [{ ...action().sequences[0]!, qualityStatus: 'pending' }],
        },
      ],
    }

    await expect(exportGameAssets(badModel, { runtime: runtime() })).rejects.toThrow(
      'actions[0].sequences[0].qualityStatus: 质量检测未通过，禁止导出',
    )
  })

  it('脚底线超出画布时在读取图片前拒绝导出', async () => {
    const badModel: ExportPackageModel = {
      ...model,
      actions: [
        {
          ...action(),
          sequences: [{ ...action().sequences[0]!, footY: 41 }],
        },
      ],
    }
    const testRuntime = runtime()

    await expect(exportGameAssets(badModel, { runtime: testRuntime })).rejects.toThrow(
      'actions[0].sequences[0].footY: 必须是 0 到 40 的整数像素值',
    )
    expect(testRuntime.fetchFrame).not.toHaveBeenCalled()
  })

  it('拒绝没有透明通道的 PNG', async () => {
    const data = new Uint8Array(await rgbaPng().arrayBuffer())
    data[25] = 2
    const testRuntime: AssetExportRuntime = {
      ...runtime(),
      fetchFrame: vi.fn(async () => new Blob([data], { type: 'image/png' })),
    }

    await expect(exportGameAssets(model, { runtime: testRuntime })).rejects.toThrow(
      'PNG 必须包含 Alpha 透明通道',
    )
    expect(testRuntime.decodeFrame).not.toHaveBeenCalled()
  })

  it('PNG 解码失败时带上具体帧路径', async () => {
    const testRuntime: AssetExportRuntime = {
      ...runtime(),
      decodeFrame: vi.fn(async () => {
        throw new Error('corrupt image')
      }),
    }

    await expect(exportGameAssets(model, { runtime: testRuntime })).rejects.toThrow(
      'frames/Walk-Forward-south/Walk-Forward-south_000.png: PNG 解码失败（corrupt image）',
    )
  })

  it('任一帧尺寸与项目画布不一致时关闭图片并拒绝导出', async () => {
    const closes: Array<ReturnType<typeof vi.fn>> = []
    const testRuntime: AssetExportRuntime = {
      ...runtime(),
      decodeFrame: vi.fn(async () => {
        const close = vi.fn()
        closes.push(close)
        return {
          source: {} as CanvasImageSource,
          width: 31,
          height: 40,
          close,
        }
      }),
    }

    await expect(exportGameAssets(model, { runtime: testRuntime })).rejects.toThrow(
      '画布应为 32x40，实际为 31x40',
    )
    expect(closes).toHaveLength(9)
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  })

  it('浏览器无法编码图集时释放图片并拒绝导出', async () => {
    const testRuntime: AssetExportRuntime = {
      ...runtime(),
      createCanvas: vi.fn((width, height) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        Object.defineProperty(canvas, 'getContext', {
          value: () => ({
            clearRect: vi.fn(),
            drawImage: vi.fn(),
          }),
        })
        Object.defineProperty(canvas, 'toBlob', {
          value: (callback: BlobCallback) => callback(null),
        })
        return canvas
      }),
    }

    await expect(exportGameAssets(model, { runtime: testRuntime })).rejects.toThrow(
      'atlas: PNG 编码失败',
    )
  })

  it('target 只能写入安全且不重复的相对路径', async () => {
    const unsafeTarget: AssetExportTarget = {
      id: 'unsafe',
      createFiles: vi.fn(async () => [{ path: '../escape.json', data: '{}' }]),
    }
    await expect(
      exportGameAssets(model, { runtime: runtime(), targets: [unsafeTarget] }),
    ).rejects.toThrow('targets.unsafe.files[0].path: 必须是安全的相对路径')

    const duplicateTarget: AssetExportTarget = {
      id: 'duplicate',
      createFiles: vi.fn(async () => [
        { path: 'same.json', data: '{}' },
        { path: 'same.json', data: new Uint8Array([1]) },
      ]),
    }
    await expect(
      exportGameAssets(model, {
        runtime: runtime(),
        targets: [duplicateTarget],
      }),
    ).rejects.toThrow('package.files: 文件路径重复')
  })

  it('空 target 不改变通用层，新增 target 文件只进入自己的目录', async () => {
    const emptyTarget: AssetExportTarget = {
      id: 'empty',
      createFiles: vi.fn(async () => []),
    }
    const cocosProbe: AssetExportTarget = {
      id: 'cocos-probe',
      createFiles: vi.fn(async ({ metadata }) => [
        {
          path: 'anchor-map.json',
          data: JSON.stringify({ source: metadata.actions[0]?.anchor }),
        },
      ]),
    }
    const common = await readStoredZip((await exportGameAssets(model, { runtime: runtime() })).blob)
    const extended = await readStoredZip(
      (
        await exportGameAssets(model, {
          runtime: runtime(),
          targets: [emptyTarget, cocosProbe],
        })
      ).blob,
    )
    const targetPath = 'Aster-character-1-Explorer-outfit-1/targets/cocos-probe/anchor-map.json'

    expect([...extended.keys()].filter((name) => !name.includes('/targets/'))).toEqual([
      ...common.keys(),
    ])
    expect(extended.has(targetPath)).toBe(true)
    expect(emptyTarget.createFiles).toHaveBeenCalledTimes(1)
  })

  it('渲染失败时释放已经解码的全部图片', async () => {
    const baseRuntime = runtime()
    const closes: Array<ReturnType<typeof vi.fn>> = []
    const failingRuntime: AssetExportRuntime = {
      ...baseRuntime,
      decodeFrame: vi.fn(async () => {
        const close = vi.fn()
        closes.push(close)
        return {
          source: {} as CanvasImageSource,
          width: 32,
          height: 40,
          close,
        }
      }),
      createCanvas: vi.fn((width, height) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        Object.defineProperty(canvas, 'getContext', { value: () => null })
        return canvas
      }),
    }

    await expect(exportGameAssets(model, { runtime: failingRuntime })).rejects.toThrow(
      'atlas/Walk-Forward-south.png: 浏览器无法创建 2D 画布',
    )
    expect(closes).toHaveLength(9)
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  })
})
