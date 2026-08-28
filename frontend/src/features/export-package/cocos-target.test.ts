import { describe, expect, it } from 'vitest'

import type { AssetExportTargetContext, PlannedFrame, PlannedSequence } from './asset-export'
import { COCOS_IMPORT_SCHEMA_VERSION, cocosCreatorTarget, toCocosAnchor } from './cocos-target'
import type { GenericExportMetadata } from './contract'
import type { ExportAction, ExportPackageModel, ExportSequence } from './model'

function buildModel(): ExportPackageModel {
  return {
    stage: 'action-assets',
    characterId: 'char-1',
    characterName: 'Aster',
    characterImageUrl: 'https://example.com/aster.png',
    outfitId: 'outfit-1',
    outfitName: 'Explorer',
    canvas: { width: 256, height: 256 },
    source: null,
    firstFrames: [],
    playtest: null,
    actions: [
      {
        id: 'action-1',
        name: 'Walk',
        type: 'walk',
        fps: 12,
        sequences: [
          {
            direction: 'default',
            expectedFrameCount: 4,
            loop: true,
            anchor: { x: 0.5, y: 0.92 },
            footY: 235,
            qualityStatus: 'passed',
            frames: [
              { index: 0, imageUrl: 'https://example.com/walk-0.png', durationMs: 80 },
              { index: 1, imageUrl: 'https://example.com/walk-1.png', durationMs: 0 },
              { index: 2, imageUrl: 'https://example.com/walk-2.png', durationMs: 90 },
              { index: 3, imageUrl: 'https://example.com/walk-3.png', durationMs: 0 },
            ],
          },
        ],
      },
    ],
  }
}

function buildMetadata(plan: readonly PlannedSequence[]): GenericExportMetadata {
  return {
    schema_version: '1.2.0',
    stage: 'action-assets',
    character: { id: 'char-1', name: 'Aster', image: 'character/master.png' },
    outfit: { id: 'outfit-1', name: 'Explorer' },
    canvas: { w: 256, h: 256 },
    first_frames: [],
    playtest: null,
    source: null,
    actions: plan.map((item) => ({
      id: item.action.id,
      name: item.action.name,
      fps: item.action.fps,
      loop: item.sequence.loop,
      quality_status: item.sequence.qualityStatus,
      frames: item.frames.map((frame: PlannedFrame) => ({
        index: frame.index,
        file: frame.filename,
      })),
      preview_gif: item.previewGifFile,
      anchor: { ...item.sequence.anchor },
      foot_y: item.sequence.footY,
      atlas: {
        file: item.atlasFile,
        cols: item.columns,
        rows: item.rows,
        cell: { w: 256, h: 256 },
      },
    })),
  }
}

function buildPlan(model: ExportPackageModel): PlannedSequence[] {
  const action: ExportAction = model.actions[0]
  const sequence: ExportSequence = action.sequences[0]
  return [
    {
      action,
      sequence,
      exportName: 'Walk-default',
      framesFolder: 'frames/Walk-default',
      atlasFile: 'atlas/Walk-default.png',
      previewGifFile: 'preview/Walk-default.gif',
      columns: 4,
      rows: 1,
      frames: sequence.frames.map((frame, index) => ({
        frame,
        index,
        filename: `Walk-default_${String(frame.index).padStart(3, '0')}.png`,
        relativeFile: `frames/Walk-default/Walk-default_${String(frame.index).padStart(3, '0')}.png`,
      })),
    },
  ]
}

function buildContext(): AssetExportTargetContext {
  const model = buildModel()
  const plan = buildPlan(model)
  return { model, metadata: buildMetadata(plan), plan }
}

describe('cocos-target', () => {
  it('toCocosAnchor flips the y axis of normalized anchors', () => {
    const flipped = toCocosAnchor({ x: 0.5, y: 0.92 })
    expect(flipped.x).toBe(0.5)
    expect(flipped.y).toBeCloseTo(0.08, 10)
    const corner0 = toCocosAnchor({ x: 0, y: 0 })
    expect(corner0).toEqual({ x: 0, y: 1 })
    const corner1 = toCocosAnchor({ x: 1, y: 1 })
    expect(corner1).toEqual({ x: 1, y: 0 })
  })

  it('uses the cocos-creator target id', () => {
    expect(cocosCreatorTarget.id).toBe('cocos-creator')
  })

  it('produces exactly two files: a manifest json and a readme', async () => {
    const files = await cocosCreatorTarget.createFiles(buildContext())
    const paths = files.map((file) => file.path)
    expect(paths).toEqual(['cocos-import.json', 'README.md'])
  })

  it('manifest marks itself experimental and points at issue 94', async () => {
    const files = await cocosCreatorTarget.createFiles(buildContext())
    const manifestEntry = files.find((file) => file.path === 'cocos-import.json')
    expect(manifestEntry).toBeDefined()
    const manifest = JSON.parse(String(manifestEntry?.data))
    expect(manifest.experimental).toBe(true)
    expect(manifest.engine).toBe('cocos-creator')
    expect(manifest.upstream_issue).toBe(94)
    expect(manifest.schema_version).toBe(COCOS_IMPORT_SCHEMA_VERSION)
  })

  it('flips anchor y for both the master image and every action', async () => {
    const files = await cocosCreatorTarget.createFiles(buildContext())
    const manifest = JSON.parse(
      String(files.find((file) => file.path === 'cocos-import.json')?.data),
    )

    expect(manifest.master.anchor).toEqual({ x: 0.5, y: 0.92 })
    expect(manifest.master.anchor_cocos.x).toBe(0.5)
    expect(manifest.master.anchor_cocos.y).toBeCloseTo(0.08, 10)

    const action = manifest.actions[0]
    expect(action.anchor).toEqual({ x: 0.5, y: 0.92 })
    expect(action.anchor_cocos.x).toBe(0.5)
    expect(action.anchor_cocos.y).toBeCloseTo(0.08, 10)
  })

  it('emits 1.1 per-frame timing without rounding missing frame durations', async () => {
    const files = await cocosCreatorTarget.createFiles(buildContext())
    const manifest = JSON.parse(
      String(files.find((file) => file.path === 'cocos-import.json')?.data),
    )

    const action = manifest.actions[0]
    expect(action.timing_mode).toBe('per-frame')
    const frames = action.frames
    expect(frames[0].duration_ms).toBe(80)
    expect(frames[1].duration_ms).toBeNull()
    expect(frames[2].duration_ms).toBe(90)
    expect(frames[3].duration_ms).toBeNull()
  })

  it('uses constant-fps timing when no frame has an explicit duration', async () => {
    const context = buildContext()
    const sequence = context.plan[0]!.sequence
    const constantPlan = [
      {
        ...context.plan[0]!,
        sequence: {
          ...sequence,
          frames: sequence.frames.map((frame) => ({ ...frame, durationMs: 0 })),
        },
        frames: context.plan[0]!.frames.map((planned) => ({
          ...planned,
          frame: { ...planned.frame, durationMs: 0 },
        })),
      },
    ]
    const files = await cocosCreatorTarget.createFiles({ ...context, plan: constantPlan })
    const manifest = JSON.parse(String(files[0]?.data))

    expect(manifest.schema_version).toBe('windup-cocos-import-1.1.0')
    expect(manifest.actions[0].timing_mode).toBe('constant-fps')
    expect(
      manifest.actions[0].frames.map((frame: { duration_ms: number | null }) => frame.duration_ms),
    ).toEqual([null, null, null, null])
  })

  it('keeps atlas file path and frame count from the generic plan', async () => {
    const files = await cocosCreatorTarget.createFiles(buildContext())
    const manifest = JSON.parse(
      String(files.find((file) => file.path === 'cocos-import.json')?.data),
    )

    expect(manifest.actions[0].atlas).toEqual({
      file: 'atlas/Walk-default.png',
      cols: 4,
      rows: 1,
      cell: { w: 256, h: 256 },
    })
    expect(manifest.actions[0].frames.map((f: { file: string }) => f.file)).toEqual([
      'Walk-default_000.png',
      'Walk-default_001.png',
      'Walk-default_002.png',
      'Walk-default_003.png',
    ])
  })

  it('does not fabricate cocos native files (no .anim / .meta paths)', async () => {
    const files = await cocosCreatorTarget.createFiles(buildContext())
    const paths = files.map((file) => file.path)
    expect(paths).not.toContain('cocos-import.json'.replace('cocos-import', 'cocos.anim'))
    expect(paths.some((p) => p.endsWith('.anim'))).toBe(false)
    expect(paths.some((p) => p.endsWith('.meta'))).toBe(false)

    const manifestEntry = files.find((file) => file.path === 'cocos-import.json')
    const manifest = JSON.parse(String(manifestEntry?.data))
    const allFileFields: string[] = []
    allFileFields.push(manifest.master.file)
    for (const action of manifest.actions) {
      allFileFields.push(action.atlas.file)
      for (const frame of action.frames) allFileFields.push(frame.file)
    }
    expect(allFileFields.some((p) => p.endsWith('.anim'))).toBe(false)
    expect(allFileFields.some((p) => p.endsWith('.meta'))).toBe(false)
  })

  it('readme is honest about experimental status and points at issue 94', async () => {
    const files = await cocosCreatorTarget.createFiles(buildContext())
    const readme = String(files.find((file) => file.path === 'README.md')?.data)
    expect(readme).toMatch(/实验性|experimental/i)
    expect(readme).toMatch(/Issue #94|issues\/94/)
    expect(readme).toMatch(/aster|Aster/)
  })

  it('keeps repeated action ids aligned to their plan sequence directions', async () => {
    const base = buildContext()
    const firstPlan = base.plan[0]!
    const northPlan: PlannedSequence = {
      ...firstPlan,
      sequence: { ...firstPlan.sequence, direction: 'north' },
      exportName: 'Walk-north',
      framesFolder: 'frames/Walk-north',
      atlasFile: 'atlas/Walk-north.png',
      frames: firstPlan.frames.map((frame) => ({
        ...frame,
        filename: frame.filename.replace('Walk-default', 'Walk-north'),
        relativeFile: frame.relativeFile.replace('Walk-default', 'Walk-north'),
      })),
    }
    const secondMetadata = {
      ...base.metadata.actions[0]!,
      atlas: { ...base.metadata.actions[0]!.atlas, file: 'atlas/Walk-north.png' },
      frames: northPlan.frames.map((frame) => ({ index: frame.index, file: frame.filename })),
    }
    const files = await cocosCreatorTarget.createFiles({
      model: buildModel(),
      metadata: { ...base.metadata, actions: [base.metadata.actions[0]!, secondMetadata] },
      plan: [firstPlan, northPlan],
    })
    const manifest = JSON.parse(String(files[0]?.data))
    expect(manifest.actions.map((action: { direction: string }) => action.direction)).toEqual([
      'default',
      'north',
    ])
    expect(manifest.actions.map((action: { export_name: string }) => action.export_name)).toEqual([
      'Walk-default',
      'Walk-north',
    ])
  })

  it('rejects metadata and plan action-count drift before creating a manifest', async () => {
    const context = buildContext()

    await expect(cocosCreatorTarget.createFiles({ ...context, plan: [] })).rejects.toThrow(
      'meta.json 动作数量 1 与 plan 数量 0 不一致',
    )
  })

  it('rejects a sparse plan entry instead of producing a misaligned action', async () => {
    const context = buildContext()
    const sparsePlan = new Array<PlannedSequence>(1)

    await expect(cocosCreatorTarget.createFiles({ ...context, plan: sparsePlan })).rejects.toThrow(
      'meta.json 缺少第 0 个 plan 动作',
    )
  })

  it('uses a null duration when metadata contains a frame absent from the plan', async () => {
    const context = buildContext()
    const metadata = {
      ...context.metadata,
      actions: context.metadata.actions.map((action) => ({
        ...action,
        frames: [...action.frames, { index: 4, file: 'Walk-default_004.png' }],
      })),
    }
    const files = await cocosCreatorTarget.createFiles({ ...context, metadata })
    const manifest = JSON.parse(String(files[0]?.data))

    expect(manifest.actions[0].frames[4]).toEqual({
      index: 4,
      file: 'Walk-default_004.png',
      duration_ms: null,
    })
  })
})
