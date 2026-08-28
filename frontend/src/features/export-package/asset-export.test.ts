/** @vitest-environment jsdom */
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it, vi } from 'vitest'

import {
  createAssetExportPlan,
  exportGameAssets,
  palettizeGifFrame,
  type AssetExportRuntime,
  type AssetExportTarget,
} from './asset-export'
import { COCOS_CREATOR_TARGET, COCOS_TARGET_READINESS, toCocosAnchor } from './cocos-target'
import { EXPORT_PACKAGE_JSON_SCHEMA_TEXT, validateExportPackageModel } from './contract'
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
  stage: 'action-assets',
  characterId: 'character-1',
  characterName: 'Aster',
  characterImageUrl: '/master.png',
  outfitId: 'outfit-1',
  outfitName: 'Explorer',
  canvas: { width: 32, height: 40 },
  source: { workflowRunId: 'run-1', generationIds: ['generation-1'] },
  firstFrames: [
    { actionId: 'walk-abcdef12', name: 'Walk', type: 'walk', fps: 10, imageUrl: '/walk-0.png' },
  ],
  actions: [action()],
  playtest: null,
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
  it('拒绝把不完整内容标记成更高导出阶段', () => {
    const cases: Array<[ExportPackageModel, string]> = [
      [{ ...model, stage: 'unknown' as ExportPackageModel['stage'] }, 'stage: 不是支持的导出阶段'],
      [
        { ...model, stage: 'first-frame', firstFrames: [], actions: [] },
        'firstFrames: 首帧阶段至少需要一个已确认首帧',
      ],
      [{ ...model, stage: 'action-assets', actions: [] }, 'actions: 当前阶段至少需要一个完整动作'],
      [{ ...model, stage: 'playtest', playtest: null }, 'playtest: Playtest 阶段必须包含运行配置'],
      [
        { ...model, stage: 'character', actions: [], playtest: { initialActionId: null } },
        'playtest: 只有 Playtest 阶段可以包含运行配置',
      ],
    ]

    for (const [candidate, message] of cases) {
      expect(() => validateExportPackageModel(candidate)).toThrow(message)
    }
  })

  it('角色阶段只打包母版，后续阶段在同一根目录增量追加首帧和 Playtest 清单', async () => {
    const characterModel: ExportPackageModel = {
      ...model,
      stage: 'character',
      characterImageUrl: '/master.png',
      firstFrames: [],
      actions: [],
      playtest: null,
    }
    const firstFrameModel: ExportPackageModel = {
      ...characterModel,
      stage: 'first-frame',
      firstFrames: [
        {
          actionId: 'walk',
          name: 'Walk',
          type: 'walk',
          fps: 10,
          imageUrl: '/walk-first.png',
        },
      ],
    }
    const playtestModel: ExportPackageModel = {
      ...firstFrameModel,
      stage: 'playtest',
      actions: model.actions,
      playtest: { initialActionId: 'walk-abcdef12' },
    }

    const characterEntries = await readStoredZip(
      (await exportGameAssets(characterModel, { runtime: runtime() })).blob,
    )
    const firstFrameEntries = await readStoredZip(
      (await exportGameAssets(firstFrameModel, { runtime: runtime() })).blob,
    )
    const playtestEntries = await readStoredZip(
      (await exportGameAssets(playtestModel, { runtime: runtime() })).blob,
    )
    const root = 'Aster-character-1-Explorer-outfit-1'

    expect([...characterEntries.keys()]).toContain(`${root}/character/master.png`)
    expect([...characterEntries.keys()].every((name) => firstFrameEntries.has(name))).toBe(true)
    expect(firstFrameEntries.has(`${root}/first-frames/Walk-walk.png`)).toBe(true)
    expect([...firstFrameEntries.keys()].every((name) => playtestEntries.has(name))).toBe(true)
    expect(playtestEntries.has(`${root}/playtest.json`)).toBe(true)

    const playtest = JSON.parse(
      new TextDecoder().decode(playtestEntries.get(`${root}/playtest.json`)),
    )
    expect(playtest).toEqual({
      schema_version: '1.3.0',
      initial_action_id: 'walk-abcdef12',
      action_ids: ['walk-abcdef12'],
    })

    const meta = JSON.parse(new TextDecoder().decode(playtestEntries.get(`${root}/meta.json`)))
    expect(meta).toMatchObject({
      stage: 'playtest',
      character: { image: 'character/master.png' },
      first_frames: [{ action_id: 'walk', file: 'first-frames/Walk-walk.png' }],
      playtest: { initial_action_id: 'walk-abcdef12' },
    })
  })

  it('声明 Cocos PNG + plist 目标已就绪，并转换锚点坐标', () => {
    expect(COCOS_TARGET_READINESS.ready).toBe(true)
    const anchor = toCocosAnchor({ x: 0.5, y: 0.9 })
    expect(anchor.x).toBe(0.5)
    expect(anchor.y).toBeCloseTo(0.1)
  })

  it('Cocos target 输出同名 PNG/plist 和保留逐帧时长的动画清单', async () => {
    const entries = await readStoredZip(
      (
        await exportGameAssets(model, {
          runtime: runtime(),
          targets: [COCOS_CREATOR_TARGET],
        })
      ).blob,
    )
    const root = 'Aster-character-1-Explorer-outfit-1'
    const targetRoot = `${root}/targets/cocos-creator-3x`
    const atlas = entries.get(`${root}/atlas/Walk-Forward-south.png`)
    const cocosAtlas = entries.get(`${targetRoot}/atlases/Walk-Forward-south.png`)
    const plist = new TextDecoder().decode(
      entries.get(`${targetRoot}/atlases/Walk-Forward-south.plist`),
    )
    const manifest = JSON.parse(
      new TextDecoder().decode(entries.get(`${targetRoot}/windup-animation.json`)),
    )

    expect(cocosAtlas).toEqual(atlas)
    expect(plist).toContain('<key>Walk-Forward-south_000.png</key>')
    expect(plist).toContain('<string>{{0,0},{32,40}}</string>')
    expect(plist).toContain('<key>Walk-Forward-south_008.png</key>')
    expect(plist).toContain('<string>{{0,40},{32,40}}</string>')
    expect(plist).toContain('<key>textureFileName</key>')
    expect(plist).toContain('<string>Walk-Forward-south.png</string>')
    expect(manifest).toMatchObject({
      engine: 'cocos-creator-3.x',
      animations: [
        {
          id: 'walk-abcdef12',
          direction: 'south',
          loop: true,
          anchor: { x: 0.5, y: 0.1 },
        },
      ],
    })
    expect(manifest.animations[0].frames[0]).toEqual({
      sprite_frame: 'Walk-Forward-south_000.png',
      duration_ms: 100,
    })
    expect(manifest.animations[0].frames).toHaveLength(9)
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
    expect(plan[0]).not.toHaveProperty('previewWebpFile')
    expect(plan[0]).not.toHaveProperty('previewApngFile')
    expect(plan[0]?.frames[0]?.filename).toBe('Walk-Forward-south_000.png')
    expect(plan[0]?.frames[8]?.filename).toBe('Walk-Forward-south_008.png')
  })

  it('GIF 为透明像素预留索引，并把多色帧平均通道误差控制在 5 以内', () => {
    const width = 64
    const height = 64
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x
        rgba[pixel * 4] = Math.round((x / (width - 1)) * 255)
        rgba[pixel * 4 + 1] = Math.round((y / (height - 1)) * 255)
        rgba[pixel * 4 + 2] = Math.round((((x + y) % width) / (width - 1)) * 255)
        rgba[pixel * 4 + 3] = x < 4 ? 0 : 255
      }
    }

    const result = palettizeGifFrame(rgba)
    let absoluteError = 0
    let opaqueChannels = 0
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (rgba[pixel * 4 + 3] === 0) {
        expect(result.indexed[pixel]).toBe(result.transparentIndex)
        continue
      }
      expect(result.indexed[pixel]).not.toBe(result.transparentIndex)
      const color = result.palette[result.indexed[pixel]!]
      for (let channel = 0; channel < 3; channel += 1) {
        absoluteError += Math.abs(rgba[pixel * 4 + channel]! - color![channel]!)
        opaqueChannels += 1
      }
    }

    expect(result.palette.length).toBeLessThanOrEqual(256)
    expect(absoluteError / opaqueChannels).toBeLessThan(5)
  })

  it('GIF 全透明帧仍生成有效的单色透明调色板', () => {
    const result = palettizeGifFrame(new Uint8ClampedArray(4 * 4 * 4))

    expect(result.palette).toEqual([[0, 0, 0]])
    expect(result.indexed).toEqual(new Uint8Array(16))
    expect(result.transparentIndex).toBe(0)
  })

  it('保留原始 PNG、图集和 GIF 预览，并在 meta.json 中声明方向与逐帧时长', async () => {
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
    expect(names).toContain(`${root}/preview/Walk-Forward-south.gif`)
    expect(names).not.toContain(`${root}/preview/Walk-Forward-south.webp`)
    expect(names).not.toContain(`${root}/preview/Walk-Forward-south.apng`)
    expect(names.filter((name) => name.includes('/frames/'))).toHaveLength(9)

    const gif = entries.get(`${root}/preview/Walk-Forward-south.gif`)
    expect(new TextDecoder().decode(gif?.slice(0, 6))).toBe('GIF89a')

    const meta = JSON.parse(new TextDecoder().decode(entries.get(`${root}/meta.json`)))
    const schema = JSON.parse(EXPORT_PACKAGE_JSON_SCHEMA_TEXT)
    const validate = new Ajv2020().compile(schema)
    expect(validate(meta), JSON.stringify(validate.errors)).toBe(true)
    expect(meta).toMatchObject({
      schema_version: '1.3.0',
      character: { id: 'character-1', name: 'Aster' },
      canvas: { w: 32, h: 40 },
      source: { workflow_run_id: 'run-1', generation_ids: ['generation-1'] },
    })
    expect(meta.actions[0]).toMatchObject({
      name: 'Walk / Forward',
      direction: 'south',
      fps: 10,
      loop: true,
      anchor: { x: 0.5, y: 0.9 },
      foot_y: 36,
      preview_gif: 'preview/Walk-Forward-south.gif',
      atlas: { cols: 8, rows: 2, cell: { w: 32, h: 40 } },
    })
    expect(meta.actions[0].frames.slice(0, 2)).toEqual([
      { index: 0, file: 'Walk-Forward-south_000.png', duration_ms: 100 },
      { index: 1, file: 'Walk-Forward-south_001.png', duration_ms: 100 },
    ])
    expect(meta.actions[0]).not.toHaveProperty('preview_webp')
    expect(meta.actions[0]).not.toHaveProperty('preview_apng')
  })

  it('接受与预览一致的亚毫秒精度规范化帧时长', async () => {
    const denseTimingModel: ExportPackageModel = {
      ...model,
      actions: [
        {
          ...model.actions[0]!,
          sequences: [
            {
              ...model.actions[0]!.sequences[0]!,
              frames: model.actions[0]!.sequences[0]!.frames.map((currentFrame) => ({
                ...currentFrame,
                durationMs: 31.25,
              })),
            },
          ],
        },
      ],
    }

    await expect(exportGameAssets(denseTimingModel, { runtime: runtime() })).resolves.toMatchObject(
      {
        filename: 'windup-Aster-character-1-Explorer-outfit-1.zip',
      },
    )
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
      stage: 'playtest',
      playtest: { initialActionId: null },
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
      'character/master.png: PNG 解码失败（corrupt image）',
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
    expect(closes).toHaveLength(2)
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

  it('GIF 编码失败时指出预览路径并释放动作帧', async () => {
    const closes: Array<ReturnType<typeof vi.fn>> = []
    const testRuntime: AssetExportRuntime = {
      ...runtime(),
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
        Object.defineProperty(canvas, 'getContext', {
          value: () => ({
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            getImageData: vi.fn(() => {
              throw new Error('pixel access denied')
            }),
          }),
        })
        Object.defineProperty(canvas, 'toBlob', {
          value: (callback: BlobCallback) => callback(new Blob(['atlas'], { type: 'image/png' })),
        })
        return canvas
      }),
    }

    await expect(exportGameAssets(model, { runtime: testRuntime })).rejects.toThrow(
      'preview/Walk-Forward-south.gif: GIF 编码失败（pixel access denied）',
    )
    expect(closes).toHaveLength(11)
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true)
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

  it('按动作序列释放解码图片，不同时持有整包所有帧', async () => {
    const second = action()
    const twoActionModel: ExportPackageModel = {
      ...model,
      actions: [
        ...model.actions,
        {
          ...second,
          id: 'run-abcdef12',
          name: 'Run',
          sequences: [
            {
              ...second.sequences[0]!,
              frames: second.sequences[0]!.frames.map((item) => ({
                ...item,
                imageUrl: `/frames/run-${item.index}.png`,
              })),
            },
          ],
        },
      ],
    }
    const testRuntime = runtime()
    let openCount = 0
    let peakOpenCount = 0
    testRuntime.decodeFrame = vi.fn(async () => {
      openCount += 1
      peakOpenCount = Math.max(peakOpenCount, openCount)
      return {
        source: {} as CanvasImageSource,
        width: 32,
        height: 40,
        close: vi.fn(() => {
          openCount -= 1
        }),
      }
    })

    await exportGameAssets(twoActionModel, { runtime: testRuntime })

    expect(peakOpenCount).toBeLessThanOrEqual(9)
    expect(openCount).toBe(0)
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
    expect(closes).toHaveLength(11)
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  })
})
