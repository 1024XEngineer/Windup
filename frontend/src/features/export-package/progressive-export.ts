import { getDirectionProfile, resolveActionDirection } from '@/entities'
import type {
  Action,
  ActionDirection,
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

function orderedFrames(framesInput: readonly Frame[], action: Action): readonly Frame[] {
  const frames = [...framesInput].sort((left, right) => left.index - right.index)
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

function exportFrames(frames: readonly Frame[], action: Action): readonly ExportFrame[] {
  return orderedFrames(frames, action).map((frame) => ({
    index: frame.index,
    imageUrl: frame.imageUrl,
    durationMs: durationMs(frame, action),
  }))
}

function exportAction(action: Action, project: Project): ExportAction {
  const directionalSequences = new Map<
    ActionDirection,
    {
      direction: ActionDirection
      sourceDirection: ActionDirection
      mirrorX: boolean
      expectedFrameCount: number
      frames: readonly Frame[]
    }
  >()
  for (const sequence of action.sequences ?? []) {
    if (sequence.sourceDirection !== null) continue
    directionalSequences.set(sequence.direction, {
      direction: sequence.direction,
      sourceDirection: sequence.direction,
      mirrorX: false,
      expectedFrameCount: sequence.frameCount,
      frames: sequence.frames,
    })
  }
  if (!directionalSequences.has('east') && action.frames.length > 0) {
    directionalSequences.set('east', {
      direction: 'east',
      sourceDirection: 'east',
      mirrorX: false,
      expectedFrameCount: action.frameCount,
      frames: action.frames,
    })
    directionalSequences.set('west', {
      direction: 'west',
      sourceDirection: 'east',
      mirrorX: true,
      expectedFrameCount: action.frameCount,
      frames: action.frames,
    })
  }
  for (const sequence of action.sequences ?? []) {
    if (sequence.sourceDirection === null) continue
    const source = directionalSequences.get(sequence.sourceDirection)
    if (source === undefined) continue
    directionalSequences.set(sequence.direction, {
      direction: sequence.direction,
      sourceDirection: sequence.sourceDirection,
      mirrorX: sequence.mirrorX,
      expectedFrameCount: sequence.frameCount,
      frames: source.frames,
    })
  }

  const requiredDirections =
    (action.sequences?.length ?? 0) === 0
      ? (['east', 'west'] as const)
      : getDirectionProfile(project.directionalMovement).logicalDirections
  const requiredSequences = requiredDirections.map((direction) => {
    const sequence = directionalSequences.get(direction)
    if (sequence === undefined) throw new Error(`${action.name}缺少 ${direction} 方向动作帧`)
    return sequence
  })

  return {
    id: action.id,
    name: action.name,
    type: action.type,
    fps: action.fps,
    sequences: requiredSequences.map((sequence) => ({
      direction: sequence.direction,
      sourceDirection: sequence.sourceDirection,
      mirrorX: sequence.mirrorX,
      expectedFrameCount: sequence.expectedFrameCount,
      loop: action.loop,
      anchor: { x: 0.5, y: FOOT_LINE_RATIO },
      footY: Math.trunc(project.spriteSize.height * FOOT_LINE_RATIO),
      qualityStatus: 'passed',
      frames: exportFrames(sequence.frames, action),
    })),
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
    const sourceFrames =
      action.sequences?.find(
        (sequence) => sequence.direction === 'east' && sequence.sourceDirection === null,
      )?.frames ??
      action.sequences?.find((sequence) => sequence.sourceDirection === null)?.frames ??
      action.frames
    const frame = orderedFrames(sourceFrames, action)[0]
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
  const nodesById = new Map(run.nodes.map((node) => [node.id, node]))
  const generationsById = new Map(generations.map((generation) => [generation.id, generation]))
  const profile = getDirectionProfile(project.directionalMovement)
  const reviewByFullFrameId = new Map<string, (typeof run.nodes)[number]>()
  for (const node of run.nodes) {
    if (node.type !== 'review') continue
    for (const dependencyId of node.dependsOnNodeIds) {
      if (!reviewByFullFrameId.has(dependencyId)) reviewByFullFrameId.set(dependencyId, node)
    }
  }
  return run.nodes.flatMap((fullFrame): ExportAction[] => {
    if (
      fullFrame.type !== 'action-full-frame' ||
      fullFrame.status !== 'passed' ||
      fullFrame.phase !== 'completed' ||
      fullFrame.deletedAt
    ) {
      return []
    }
    const generationsByDirection = new Map<ActionDirection, Generation>()
    for (const reference of fullFrame.generations.filter(
      (item) => item.role === 'complete_animation',
    )) {
      const generation = generationsById.get(reference.taskId)
      const result = generation?.result
      if (
        !generation ||
        generation.status !== 'completed' ||
        result?.type !== 'complete_animation'
      ) {
        continue
      }
      const direction = result.direction ?? reference.direction ?? 'east'
      generationsByDirection.set(direction, generation)
    }
    if (profile.sourceDirections.some((direction) => !generationsByDirection.has(direction))) {
      return []
    }
    const method = fullFrame.dependsOnNodeIds
      .map((dependencyId) => nodesById.get(dependencyId))
      .find((node) => node?.type === 'action-generation-method')
    const first = method
      ? method.dependsOnNodeIds
          .map((dependencyId) => nodesById.get(dependencyId))
          .find((node) => node?.type === 'action-first-frame')
      : undefined
    if (!first || first.type !== 'action-first-frame' || first.input.outfitId !== outfitId)
      return []
    const framesByDirection = new Map<ActionDirection, readonly ExportFrame[]>()
    for (const direction of profile.sourceDirections) {
      const generation = generationsByDirection.get(direction)!
      const result = generation.result
      if (!result || result.type !== 'complete_animation') continue
      const frames = [...result.frames]
        .sort((left, right) => left.index - right.index)
        .map((frame, index) => {
          if (frame.index !== index) {
            throw new Error(`${first.input.name}的${direction}方向帧序号必须从 0 连续排列`)
          }
          const durationMs =
            frame.durationMs !== null && frame.durationMs > 0
              ? Math.round(frame.durationMs)
              : Math.max(1, Math.round(1000 / first.input.fps))
          return { index: frame.index, imageUrl: frame.url, durationMs }
        })
      framesByDirection.set(direction, frames)
    }
    const review = reviewByFullFrameId.get(fullFrame.id)
    return [
      {
        // 与正式发布的 buildReviewedAction 使用同一个首帧节点 ID，
        // 这样动作刚生成和审核发布后可以合并，不会在导出包中重复出现。
        id: first.id,
        name: first.input.name,
        type: first.input.type,
        fps: first.input.fps,
        sequences: profile.logicalDirections.map((direction) => {
          const resolved = resolveActionDirection(direction)
          const frames = framesByDirection.get(resolved.sourceDirection)!
          return {
            direction,
            sourceDirection: resolved.mirrorX ? resolved.sourceDirection : null,
            mirrorX: resolved.mirrorX,
            expectedFrameCount: frames.length,
            loop: true,
            anchor: { x: 0.5, y: FOOT_LINE_RATIO },
            footY: Math.trunc(project.spriteSize.height * FOOT_LINE_RATIO),
            qualityStatus: review?.status === 'passed' ? 'passed' : 'pending',
            frames,
          }
        }),
      },
    ]
  })
}

function mergeActions(published: readonly ExportAction[], generated: readonly ExportAction[]) {
  const result = [...published]
  const actionIds = new Set(published.map((action) => action.id))
  for (const action of generated) {
    if (actionIds.has(action.id)) continue
    result.push(action)
    actionIds.add(action.id)
  }
  return result
}

function mergeFirstFrames(
  workflowFrames: readonly ExportFirstFrame[],
  actionFrames: readonly ExportFirstFrame[],
) {
  const result = [...workflowFrames]
  const actionIds = new Set(workflowFrames.map((frame) => frame.actionId))
  for (const frame of actionFrames) {
    if (actionIds.has(frame.actionId)) continue
    result.push(frame)
    actionIds.add(frame.actionId)
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
