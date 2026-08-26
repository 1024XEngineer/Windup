import exportSchemaText from './export-package.schema.json?raw'
import { EXPORT_STAGES } from './model'
import type { ExportPackageModel } from './model'

export const EXPORT_PACKAGE_SCHEMA_VERSION = '1.1.0'
export const EXPORT_PACKAGE_JSON_SCHEMA_TEXT = exportSchemaText

export interface GenericExportFrame {
  index: number
  file: string
}

export interface GenericExportAction {
  id: string
  name: string
  fps: number
  loop: boolean
  quality_status: ExportPackageModel['actions'][number]['sequences'][number]['qualityStatus']
  frames: readonly GenericExportFrame[]
  anchor: { x: number; y: number }
  foot_y: number
  atlas: {
    file: string
    cols: number
    rows: number
    cell: { w: number; h: number }
  }
}

export interface GenericExportMetadata {
  schema_version: typeof EXPORT_PACKAGE_SCHEMA_VERSION
  stage: ExportPackageModel['stage']
  character: { id: string; name: string; image: string }
  outfit: { id: string; name: string }
  canvas: { w: number; h: number }
  first_frames: readonly {
    action_id: string
    name: string
    type: string
    fps: number
    file: string
  }[]
  actions: readonly GenericExportAction[]
  playtest: { initial_action_id: string | null } | null
  source: {
    workflow_run_id: string
    generation_ids: readonly string[]
  } | null
}

function fail(field: string, reason: string): never {
  throw new Error(`${field}: ${reason}`)
}

function requireText(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) fail(field, '必须是非空字符串')
}

function requirePositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) fail(field, '必须是大于 0 的整数')
}

function requireUnitNumber(field: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(field, '必须是 0 到 1 的数值')
}

/**
 * 在读取任何图片前完成结构与质量门禁。
 * 报错路径使用 meta.json 对应字段名，方便调用方直接定位坏数据。
 */
export function validateExportPackageModel(model: ExportPackageModel): void {
  if (!EXPORT_STAGES.includes(model.stage)) {
    fail('stage', '不是支持的导出阶段')
  }
  requireText('character.id', model.characterId)
  requireText('character.name', model.characterName)
  requireText('character.imageUrl', model.characterImageUrl)
  requireText('outfit.id', model.outfitId)
  requireText('outfit.name', model.outfitName)
  requirePositiveInteger('canvas.w', model.canvas.width)
  requirePositiveInteger('canvas.h', model.canvas.height)
  if (model.source !== null) {
    requireText('source.workflow_run_id', model.source.workflowRunId)
    const generationIds = new Set<string>()
    model.source.generationIds.forEach((id, index) => {
      requireText(`source.generation_ids[${index}]`, id)
      if (generationIds.has(id)) fail(`source.generation_ids[${index}]`, '生成记录不能重复')
      generationIds.add(id)
    })
  }

  model.firstFrames.forEach((frame, index) => {
    const field = `firstFrames[${index}]`
    requireText(`${field}.actionId`, frame.actionId)
    requireText(`${field}.name`, frame.name)
    requirePositiveInteger(`${field}.fps`, frame.fps)
    requireText(`${field}.imageUrl`, frame.imageUrl)
  })
  if (model.stage === 'first-frame' && model.firstFrames.length === 0) {
    fail('firstFrames', '首帧阶段至少需要一个已确认首帧')
  }
  if (
    (model.stage === 'action-assets' || model.stage === 'playtest') &&
    model.actions.length === 0
  ) {
    fail('actions', '当前阶段至少需要一个完整动作')
  }
  if (model.stage === 'playtest' && model.playtest === null) {
    fail('playtest', 'Playtest 阶段必须包含运行配置')
  }
  if (model.stage !== 'playtest' && model.playtest !== null) {
    fail('playtest', '只有 Playtest 阶段可以包含运行配置')
  }
  model.actions.forEach((action, actionIndex) => {
    const actionField = `actions[${actionIndex}]`
    requireText(`${actionField}.name`, action.name)
    requirePositiveInteger(`${actionField}.fps`, action.fps)
    if (action.sequences.length === 0) fail(`${actionField}.sequences`, '至少需要一个动作方向')

    action.sequences.forEach((sequence, sequenceIndex) => {
      const sequenceField = `${actionField}.sequences[${sequenceIndex}]`
      requireText(`${sequenceField}.direction`, sequence.direction)
      requirePositiveInteger(`${sequenceField}.expectedFrameCount`, sequence.expectedFrameCount)
      requireUnitNumber(`${sequenceField}.anchor.x`, sequence.anchor.x)
      requireUnitNumber(`${sequenceField}.anchor.y`, sequence.anchor.y)
      if (
        !Number.isInteger(sequence.footY) ||
        sequence.footY < 0 ||
        sequence.footY > model.canvas.height
      ) {
        fail(`${sequenceField}.footY`, `必须是 0 到 ${model.canvas.height} 的整数像素值`)
      }
      if (model.stage === 'playtest' && sequence.qualityStatus !== 'passed') {
        fail(`${sequenceField}.qualityStatus`, '质量检测未通过，禁止导出')
      }
      if (sequence.frames.length !== sequence.expectedFrameCount) {
        fail(
          `${sequenceField}.frames`,
          `缺帧，期望 ${sequence.expectedFrameCount} 帧，实际 ${sequence.frames.length} 帧`,
        )
      }
      sequence.frames.forEach((frame, frameIndex) => {
        if (frame.index !== frameIndex) {
          fail(`${sequenceField}.frames[${frameIndex}].index`, `必须连续且等于 ${frameIndex}`)
        }
        requireText(`${sequenceField}.frames[${frameIndex}].imageUrl`, frame.imageUrl)
        requirePositiveInteger(
          `${sequenceField}.frames[${frameIndex}].durationMs`,
          frame.durationMs,
        )
      })
    })
  })
}
