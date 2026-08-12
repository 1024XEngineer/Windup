import type { Action, Character, Frame, Project } from '@/entities'

import type { ExportAction, ExportFrame, ExportPackageModel } from './model'

/** 与 ai_engine.align_bottom_center 的默认脚线保持一致。 */
const FOOT_LINE_RATIO = 0.92

export interface CreateCharacterExportModelInput {
  project: Project
  character: Character
  outfitId: string
}

function orderedFrames(action: Action): readonly Frame[] {
  const frames = [...action.frames].sort((left, right) => left.index - right.index)
  const invalid = frames.find((frame, index) => frame.index !== index)
  if (invalid !== undefined) throw new Error(`${action.name}的帧序号必须从 0 连续排列`)
  return frames
}

function durationMs(frame: Frame, action: Action): number {
  if (frame.durationMs !== null && Number.isFinite(frame.durationMs) && frame.durationMs > 0) {
    return Math.round(frame.durationMs)
  }
  if (!Number.isFinite(action.fps) || action.fps <= 0) {
    throw new Error(`${action.name}缺少有效的帧时长和 FPS`)
  }
  return Math.max(1, Math.round(1000 / action.fps))
}

function exportFrames(action: Action): readonly ExportFrame[] {
  return orderedFrames(action).map((frame) => ({
    index: frame.index,
    imageUrl: frame.imageUrl,
    durationMs: durationMs(frame, action),
  }))
}

function exportAction(action: Action, project: Project): ExportAction {
  return {
    id: action.id,
    name: action.name,
    type: action.type,
    fps: action.fps,
    sequences: [
      {
        direction: 'default',
        expectedFrameCount: action.frameCount,
        loop: action.loop,
        anchor: { x: 0.5, y: FOOT_LINE_RATIO },
        footY: Math.trunc(project.spriteSize.height * FOOT_LINE_RATIO),
        // Character 资产树只保存审核通过后发布的动作。
        qualityStatus: 'passed',
        frames: exportFrames(action),
      },
    ],
  }
}

export function createCharacterExportModel({
  project,
  character,
  outfitId,
}: CreateCharacterExportModelInput): ExportPackageModel {
  if (character.projectId !== project.id) throw new Error('角色与项目不匹配')
  const characterName = character.name?.trim()
  if (!characterName) throw new Error('角色名称不能为空')
  const outfit = character.outfits.find((candidate) => candidate.id === outfitId)
  if (outfit === undefined) throw new Error('导出造型不存在')

  return {
    characterId: character.id,
    characterName,
    outfitId: outfit.id,
    outfitName: outfit.name,
    canvas: { ...project.spriteSize },
    source: { workflowRunId: character.workflowRunId, generationIds: [] },
    actions: outfit.actions.map((action) => exportAction(action, project)),
  }
}
