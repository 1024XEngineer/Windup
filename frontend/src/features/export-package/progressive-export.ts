import type {
  Action,
  Character,
  Frame,
  Generation,
  Project,
  SequenceGeometry,
  WorkflowActionInput,
  WorkflowRun,
} from '@/entities'
import { getDirectionProfile, resolvedFrameImageUrl } from '@/entities'

import type {
  ExportAction,
  ExportFirstFrame,
  ExportFrame,
  ExportPackageModel,
  ExportPlaytest,
} from './model'

/**
 * 后端没报落位几何时的回落值（早于 geometry 上线的资产）。
 *
 * 这个数与后端 `postprocess.pack.FOOT_LINE` 是同一条线，抄一份在这里就是第二真相源 ——
 * 所以只在缺 geometry 时用，能拿到就一律用后端报的那份。两份不同步的后果是角色不站在
 * 地上，而帧数、时长、成色全都正常，没有任何一道会红。
 */
const FALLBACK_FOOT_LINE_RATIO = 0.92

function sequenceGeometry(
  geometry: SequenceGeometry | undefined,
  spriteHeight: number,
): { anchor: { x: number; y: number }; footY: number } {
  if (geometry) {
    return { anchor: geometry.anchor, footY: geometry.footY }
  }
  return {
    anchor: { x: 0.5, y: FALLBACK_FOOT_LINE_RATIO },
    footY: Math.trunc(spriteHeight * FALLBACK_FOOT_LINE_RATIO),
  }
}

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
    imageUrl: resolvedFrameImageUrl(frame, action.preferredVersion ?? 'original'),
    durationMs: durationMs(frame, action),
  }))
}

function exportAction(action: Action, project: Project): ExportAction {
  const realSequences = (action.sequences ?? []).filter(
    (sequence) =>
      sequence.sourceDirection === null && !sequence.mirrorX && sequence.frames.length > 0,
  )
  const hasDirectionalSequences = (action.sequences?.length ?? 0) > 0
  const profile = getDirectionProfile(project.directionalMovement)
  const singleSequence =
    project.directionalMovement === 'single'
      ? realSequences.find((sequence) => sequence.direction === 'east')
      : undefined
  const directionalSequences =
    project.directionalMovement === 'single' || !hasDirectionalSequences
      ? []
      : profile.logicalDirections.map((direction) => {
          const direct = realSequences.find((item) => item.direction === direction)
          if (direct) return direct
          const derived = profile.derivedDirections.find((item) => item.direction === direction)
          const source =
            derived && realSequences.find((item) => item.direction === derived.sourceDirection)
          if (!derived || !source) throw new Error(`${action.name}缺少${direction}方向真实序列`)
          return {
            ...source,
            direction,
            sourceDirection: derived.sourceDirection,
            mirrorX: derived.mirrorX,
          }
        })
  const selectedSequences = singleSequence ? [singleSequence] : directionalSequences
  const sequences =
    selectedSequences.length > 0
      ? selectedSequences.map((sequence) => ({
          direction: singleSequence ? ('default' as const) : sequence.direction,
          sourceDirection: singleSequence ? null : sequence.sourceDirection,
          mirrorX: singleSequence ? false : sequence.mirrorX,
          expectedFrameCount: sequence.frameCount,
          loop: action.loop,
          ...sequenceGeometry(undefined, project.spriteSize.height),
          qualityStatus: 'passed' as const,
          frames: [...sequence.frames]
            .sort((left, right) => left.index - right.index)
            .map((frame, index) => {
              if (frame.index !== index) {
                throw new Error(`${action.name}的${sequence.direction}方向帧序号必须从 0 连续排列`)
              }
              return {
                index: frame.index,
                imageUrl: resolvedFrameImageUrl(frame, action.preferredVersion ?? 'original'),
                durationMs: durationMs(frame, action),
              }
            }),
        }))
      : project.directionalMovement === 'single'
        ? [
            {
              direction: 'default',
              sourceDirection: null,
              mirrorX: false,
              expectedFrameCount: action.frameCount,
              loop: action.loop,
              ...sequenceGeometry(undefined, project.spriteSize.height),
              qualityStatus: 'passed' as const,
              frames: exportFrames(action),
            },
          ]
        : ['east', 'west'].map((direction) => ({
            direction,
            sourceDirection: direction === 'west' ? ('east' as const) : null,
            mirrorX: direction === 'west',
            expectedFrameCount: action.frameCount,
            loop: action.loop,
            ...sequenceGeometry(undefined, project.spriteSize.height),
            qualityStatus: 'passed' as const,
            frames: exportFrames(action),
          }))
  return {
    id: action.id,
    name: action.name,
    type: action.type,
    fps: action.fps,
    sequences,
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
  const nodesById = new Map(run.nodes.map((node) => [node.id, node]))
  const generationsById = new Map(generations.map((generation) => [generation.id, generation]))
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
    const review = reviewByFullFrameId.get(fullFrame.id)
    const sequences = getDirectionProfile(project.directionalMovement).generationDirections.map(
      (direction) => {
        const reference = fullFrame.generations.find(
          (item) => item.role === 'complete_animation' && (item.direction ?? 'east') === direction,
        )
        const generation = reference ? generationsById.get(reference.taskId) : undefined
        if (
          !generation ||
          generation.status !== 'completed' ||
          generation.result?.type !== 'complete_animation' ||
          (generation.result.direction ?? 'east') !== direction
        ) {
          throw new Error(`${first.input.name}缺少${direction}方向完整动画`)
        }
        const frames = [...generation.result.frames]
          .sort((left, right) => left.index - right.index)
          .map((frame, index) => {
            if (frame.index !== index) {
              const directionLabel =
                project.directionalMovement === 'single' ? '' : `${direction}方向`
              throw new Error(`${first.input.name}的${directionLabel}帧序号必须从 0 连续排列`)
            }
            const durationMs =
              frame.durationMs !== null && frame.durationMs > 0
                ? Math.round(frame.durationMs)
                : Math.max(1, Math.round(1000 / first.input.fps))
            return { index: frame.index, imageUrl: frame.url, durationMs }
          })
        return {
          direction: project.directionalMovement === 'single' ? 'default' : direction,
          expectedFrameCount: frames.length,
          loop: true,
          ...sequenceGeometry(generation.result.geometry, project.spriteSize.height),
          qualityStatus: review?.status === 'passed' ? ('passed' as const) : ('pending' as const),
          frames,
        }
      },
    )
    return [
      {
        id: fullFrame.id,
        name: first.input.name,
        type: first.input.type,
        fps: first.input.fps,
        sequences,
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
