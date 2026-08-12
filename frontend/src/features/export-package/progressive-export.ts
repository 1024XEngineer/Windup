import type {
  Action,
  Character,
  Frame,
  Generation,
  Project,
  WorkflowActionInput,
  WorkflowRun,
} from '@/entities'

import type {
  ExportAction,
  ExportFirstFrame,
  ExportFrame,
  ExportPackageModel,
  ExportPlaytest,
} from './model'

const FOOT_LINE_RATIO = 0.92

export interface CreateProgressiveExportModelInput {
  project: Project
  character: Character
  outfitId: string
  run?: WorkflowRun | null
  playtest?: ExportPlaytest | null
  generations?: readonly Generation[]
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
        qualityStatus: 'passed',
        frames: exportFrames(action),
      },
    ],
  }
}

function workflowFirstFrames(run: WorkflowRun | null | undefined, outfitId: string) {
  if (!run) return []
  return run.nodes.flatMap((node): ExportFirstFrame[] => {
    if (
      node.type !== 'action-first-frame' ||
      node.status !== 'passed' ||
      node.phase !== 'completed' ||
      node.input.outfitId !== outfitId ||
      !node.selectedFirstFrameUrl ||
      node.deletedAt
    ) {
      return []
    }
    return [firstFrame(node.id, node.input, node.selectedFirstFrameUrl)]
  })
}

function firstFrame(
  actionId: string,
  input: WorkflowActionInput,
  imageUrl: string,
): ExportFirstFrame {
  return {
    actionId,
    name: input.name,
    type: input.type,
    fps: input.fps,
    imageUrl,
  }
}

function publishedFirstFrames(actions: readonly Action[]): readonly ExportFirstFrame[] {
  return actions.flatMap((action) => {
    const frame = orderedFrames(action)[0]
    return frame
      ? [
          {
            actionId: action.id,
            name: action.name,
            type: action.type,
            fps: action.fps,
            imageUrl: frame.imageUrl,
          },
        ]
      : []
  })
}

function generatedActions(
  project: Project,
  run: WorkflowRun | null | undefined,
  generations: readonly Generation[],
  outfitId: string,
): readonly ExportAction[] {
  if (!run) return []
  return run.nodes.flatMap((fullFrame): ExportAction[] => {
    if (
      fullFrame.type !== 'action-full-frame' ||
      fullFrame.status !== 'passed' ||
      fullFrame.phase !== 'completed' ||
      fullFrame.deletedAt
    ) {
      return []
    }
    const reference = fullFrame.generations.find((item) => item.role === 'complete_animation')
    const generation = reference
      ? generations.find((item) => item.id === reference.taskId)
      : undefined
    if (
      !generation ||
      generation.status !== 'completed' ||
      generation.result?.type !== 'complete_animation'
    ) {
      return []
    }
    const method = run.nodes.find(
      (node) =>
        node.type === 'action-generation-method' && fullFrame.dependsOnNodeIds.includes(node.id),
    )
    const first = method
      ? run.nodes.find(
          (node) => node.type === 'action-first-frame' && method.dependsOnNodeIds.includes(node.id),
        )
      : undefined
    if (!first || first.type !== 'action-first-frame' || first.input.outfitId !== outfitId)
      return []
    const frames = [...generation.result.frames]
      .sort((left, right) => left.index - right.index)
      .map((frame, index) => {
        if (frame.index !== index) throw new Error(`${first.input.name}的帧序号必须从 0 连续排列`)
        const durationMs =
          frame.durationMs !== null && frame.durationMs > 0
            ? Math.round(frame.durationMs)
            : Math.max(1, Math.round(1000 / first.input.fps))
        return { index: frame.index, imageUrl: frame.url, durationMs }
      })
    const review = run.nodes.find(
      (node) => node.type === 'review' && node.dependsOnNodeIds.includes(fullFrame.id),
    )
    return [
      {
        id: fullFrame.id,
        name: first.input.name,
        type: first.input.type,
        fps: first.input.fps,
        sequences: [
          {
            direction: 'default',
            expectedFrameCount: frames.length,
            loop: true,
            anchor: { x: 0.5, y: FOOT_LINE_RATIO },
            footY: Math.trunc(project.spriteSize.height * FOOT_LINE_RATIO),
            qualityStatus: review?.status === 'passed' ? 'passed' : 'pending',
            frames,
          },
        ],
      },
    ]
  })
}

function mergeActions(published: readonly ExportAction[], generated: readonly ExportAction[]) {
  const result = [...published]
  for (const action of generated) {
    if (!result.some((candidate) => candidate.id === action.id || candidate.name === action.name)) {
      result.push(action)
    }
  }
  return result
}

function mergeFirstFrames(
  workflowFrames: readonly ExportFirstFrame[],
  actionFrames: readonly ExportFirstFrame[],
) {
  const result = [...workflowFrames]
  for (const frame of actionFrames) {
    const existing = result.findIndex(
      (candidate) => candidate.actionId === frame.actionId || candidate.name === frame.name,
    )
    if (existing === -1) result.push(frame)
  }
  return result
}

function characterName(character: Character, run: WorkflowRun | null | undefined) {
  const setup = run?.nodes.find((node) => node.type === 'character-setup')
  return character.name?.trim() || setup?.input.name?.trim() || '未命名角色'
}

export function createProgressiveExportModel({
  project,
  character,
  outfitId,
  run = null,
  playtest = null,
  generations = [],
}: CreateProgressiveExportModelInput): ExportPackageModel {
  if (character.projectId !== project.id) throw new Error('角色与项目不匹配')
  if (run && (run.id !== character.workflowRunId || run.projectId !== project.id)) {
    throw new Error('WorkflowRun 与角色或项目不匹配')
  }
  const outfit = character.outfits.find((candidate) => candidate.id === outfitId)
  if (!outfit) throw new Error('导出造型不存在')
  const characterImageUrl = outfit.previewUrl || character.referenceImageUrl
  if (!characterImageUrl) throw new Error('当前造型没有已确认的角色母版')

  const publishedActions = outfit.actions.map((action) => exportAction(action, project))
  const actions = mergeActions(
    publishedActions,
    playtest ? [] : generatedActions(project, run, generations, outfitId),
  )
  const firstFrames = mergeFirstFrames(
    workflowFirstFrames(run, outfitId),
    publishedFirstFrames(outfit.actions),
  )
  const generationIds = run
    ? [...new Set(run.nodes.flatMap((node) => node.generations.map((item) => item.taskId)))]
    : []

  return {
    stage: playtest
      ? 'playtest'
      : actions.length
        ? 'action-assets'
        : firstFrames.length
          ? 'first-frame'
          : 'character',
    characterId: character.id,
    characterName: characterName(character, run),
    characterImageUrl,
    outfitId: outfit.id,
    outfitName: outfit.name,
    canvas: { ...project.spriteSize },
    source: run
      ? { workflowRunId: run.id, generationIds }
      : character.workflowRunId
        ? { workflowRunId: character.workflowRunId, generationIds: [] }
        : null,
    firstFrames,
    actions,
    playtest,
  }
}
