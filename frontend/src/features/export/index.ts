import type {
  Action,
  ActionDirection,
  Character,
  CharacterApis,
  Generation,
  DirectionalMovement,
  WorkflowNode,
  WorkflowRun,
} from '@/entities'
import { getDirectionProfile, resolveActionDirection } from '@/entities'

export interface PublishReviewedActionInput {
  character: Character
  workflow: WorkflowRun
  reviewNodeId: string
  /** 兼容旧调用方；新流程应传入同一动作的全部真实方向结果。 */
  generation?: Generation
  generations?: readonly Generation[]
  directionalMovement?: DirectionalMovement
}

export interface CharacterAssetPublisher {
  publishReviewedAction(input: PublishReviewedActionInput): Promise<Character>
}

/**
 * 把一个动作节点下各真实方向的生成结果组装成一棵 Action。
 *
 * 真实方向各自保留帧；西/西北/西南等可由水平翻转得到的方向只保存关系，
 * 这样后端和 Playtest 都能知道“这是镜像”，不会因为重复保存一份帧而失去来源。
 */
export function buildReviewedAction(
  workflow: WorkflowRun,
  reviewNodeId: string,
  generations: readonly Generation[],
  directionalMovement: DirectionalMovement = 'single',
): Action {
  const reviewNode = findNode(workflow, reviewNodeId, 'review')
  const fullFrameNode = findSingleDependency(workflow, reviewNode, 'action-full-frame')
  if (fullFrameNode.status !== 'passed' || fullFrameNode.phase !== 'completed') {
    throw new Error('完整动画尚未完成')
  }

  const methodNode = findSingleDependency(workflow, fullFrameNode, 'action-generation-method')
  const firstFrameNode = findSingleDependency(workflow, methodNode, 'action-first-frame')
  const templateNode = findSingleDependency(workflow, firstFrameNode, 'character-template')
  if (
    !templateNode.selectedImageUrl &&
    Object.keys(templateNode.selectedImages ?? {}).length === 0
  ) {
    throw new Error('角色母版尚未确认')
  }

  const references = fullFrameNode.generations.filter(
    (reference) => reference.role === 'complete_animation',
  )
  const byDirection = new Map<
    ActionDirection,
    Extract<Generation['result'], { type: 'complete_animation' }>
  >()
  for (const generation of generations) {
    if (generation.projectId !== workflow.projectId) {
      throw new Error('Generation 与当前 WorkflowRun 不匹配')
    }
    const reference = references.find((item) => item.taskId === generation.id)
    if (!reference || generation.type !== 'complete_animation') {
      throw new Error('完整动画生成结果不可发布')
    }
    const result = generation.result
    if (generation.status !== 'completed' || result?.type !== 'complete_animation') {
      throw new Error('完整动画生成结果不可发布')
    }
    const direction = result.direction ?? reference.direction ?? 'east'
    if (byDirection.has(direction)) throw new Error(`重复的 ${direction} 方向动画结果`)
    if (result.frames.length === 0) {
      throw new Error('完整动画生成结果不可发布')
    }
    byDirection.set(direction, result)
  }

  const profile = getDirectionProfile(directionalMovement)
  for (const direction of profile.sourceDirections) {
    if (!byDirection.has(direction)) throw new Error(`缺少 ${direction} 方向动画结果`)
  }

  const framesByDirection = new Map<ActionDirection, FrameData>()
  for (const direction of profile.sourceDirections) {
    const result = byDirection.get(direction)!
    framesByDirection.set(direction, {
      frameCount: result.frames.length,
      frames: result.frames.map((frame) => ({
        index: frame.index,
        imageUrl: frame.url,
        durationMs: frame.durationMs,
      })),
    })
  }

  const east = framesByDirection.get('east')!
  return {
    id: firstFrameNode.id,
    outfitId: firstFrameNode.input.outfitId,
    name: firstFrameNode.input.name,
    type: firstFrameNode.input.type,
    loop: firstFrameNode.input.type === 'idle' || firstFrameNode.input.type === 'walk',
    fps: firstFrameNode.input.fps,
    frameCount: east.frameCount,
    frames: east.frames,
    sequences: profile.logicalDirections.map((direction) => {
      const resolved = resolveActionDirection(direction)
      const source = framesByDirection.get(resolved.sourceDirection)!
      return {
        direction,
        sourceDirection: resolved.mirrorX ? resolved.sourceDirection : null,
        mirrorX: resolved.mirrorX,
        frameCount: source.frameCount,
        frames: resolved.mirrorX ? [] : source.frames,
      }
    }),
  }
}

interface FrameData {
  frameCount: number
  frames: Action['frames']
}

/**
 * 审核通过前把完整动画幂等写入 Character 资产树。Action ID 使用首帧节点 ID，
 * 因而发布成功但 WorkflowRun 保存失败时可以安全重试，不会追加重复动作。
 */
export function createCharacterAssetPublisher(
  characterApis: Pick<CharacterApis, 'update'>,
): CharacterAssetPublisher {
  return {
    async publishReviewedAction({
      character,
      workflow,
      reviewNodeId,
      generation,
      generations,
      directionalMovement = 'single',
    }) {
      if (character.workflowRunId !== workflow.id || character.projectId !== workflow.projectId) {
        throw new Error('Character 与当前 WorkflowRun 不匹配')
      }

      const reviewNode = findNode(workflow, reviewNodeId, 'review')
      if (reviewNode.status !== 'active' || reviewNode.phase !== 'reviewing') {
        throw new Error('只能发布正在审核的动作')
      }
      const fullFrameNode = findSingleDependency(workflow, reviewNode, 'action-full-frame')
      if (fullFrameNode.status !== 'passed' || fullFrameNode.phase !== 'completed') {
        throw new Error('完整动画尚未完成')
      }
      const actionGenerations = generations ?? (generation ? [generation] : [])
      if (actionGenerations.length === 0) throw new Error('完整动画生成结果不存在')
      const action = buildReviewedAction(
        workflow,
        reviewNodeId,
        actionGenerations,
        directionalMovement,
      )

      const outfitIndex = character.outfits.findIndex((outfit) => outfit.id === action.outfitId)
      if (outfitIndex < 0) throw new Error('动作所属造型不存在')
      const targetOutfit = character.outfits[outfitIndex]!
      const actionIndex = targetOutfit.actions.findIndex((item) => item.id === action.id)
      const actions = [...targetOutfit.actions]
      if (actionIndex >= 0) actions[actionIndex] = action
      else actions.push(action)

      const outfits = [...character.outfits]
      outfits[outfitIndex] = { ...targetOutfit, actions }
      return characterApis.update({
        ...character,
        outfits,
      })
    },
  }
}

function findNode<TType extends WorkflowNode['type']>(
  workflow: WorkflowRun,
  nodeId: string,
  type: TType,
): Extract<WorkflowNode, { type: TType }> {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.type !== type) throw new Error(`目标节点不是 ${type}`)
  return node as Extract<WorkflowNode, { type: TType }>
}

function findSingleDependency<TType extends WorkflowNode['type']>(
  workflow: WorkflowRun,
  node: WorkflowNode,
  type: TType,
): Extract<WorkflowNode, { type: TType }> {
  if (node.dependsOnNodeIds.length !== 1) {
    throw new Error(`${node.id} 必须且只能依赖一个节点`)
  }
  return findNode(workflow, node.dependsOnNodeIds[0]!, type)
}
