import {
  assertMultiDirectionAssetPublishable,
  characterDataVersionForWrite,
  getDirectionProfile,
  type Action,
  type ActionSequence,
  type Character,
  type CharacterApis,
  type DirectionalMovement,
  type Generation,
  type WorkflowNode,
  type WorkflowRun,
} from '@/entities'

export interface PublishReviewedActionInput {
  character: Character
  workflow: WorkflowRun
  reviewNodeId: string
  /** 新工作流传入全部真实源方向；旧调用仍可只传 east generation。 */
  generations?: readonly Generation[]
  generation?: Generation
  directionalMovement?: DirectionalMovement
}

export interface CharacterAssetPublisher {
  publishReviewedAction(input: PublishReviewedActionInput): Promise<Character>
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
      generations,
      generation,
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
      const generationItems = generations ?? (generation ? [generation] : [])
      const profile = getDirectionProfile(directionalMovement)
      for (const direction of profile.generationDirections) {
        const reference = fullFrameNode.generations.find(
          (item) => item.role === 'complete_animation' && (item.direction ?? 'east') === direction,
        )
        const item = generationItems.find((candidate) => candidate.id === reference?.taskId)
        if (item?.projectId !== workflow.projectId) {
          throw new Error('Generation 与当前 WorkflowRun 不匹配')
        }
        if (
          !reference ||
          item.type !== 'complete_animation' ||
          item.status !== 'completed' ||
          item.result?.type !== 'complete_animation' ||
          (item.result.direction ?? 'east') !== direction ||
          item.result.frames.length === 0
        ) {
          throw new Error(`完整动画方向 ${direction} 的生成结果不可发布`)
        }
      }

      const methodNode = findSingleDependency(workflow, fullFrameNode, 'action-generation-method')
      const firstFrameNode = findSingleDependency(workflow, methodNode, 'action-first-frame')
      const templateNode = findSingleDependency(workflow, firstFrameNode, 'character-template')
      if (!templateNode.selectedImageUrl) throw new Error('角色母版尚未确认')

      const outfitIndex = character.outfits.findIndex(
        (outfit) => outfit.id === firstFrameNode.input.outfitId,
      )
      if (outfitIndex < 0) throw new Error('动作所属造型不存在')

      const sequences = createActionSequences(generationItems, directionalMovement)
      const eastSequence = sequences.find((sequence) => sequence.direction === 'east')!
      const action: Action = {
        id: firstFrameNode.id,
        outfitId: firstFrameNode.input.outfitId,
        name: firstFrameNode.input.name,
        type: firstFrameNode.input.type,
        loop: firstFrameNode.input.type === 'idle' || firstFrameNode.input.type === 'walk',
        fps: firstFrameNode.input.fps,
        frameCount: eastSequence.frameCount,
        frames: eastSequence.frames,
        sequences,
      }
      const targetOutfit = character.outfits[outfitIndex]!
      const actionIndex = targetOutfit.actions.findIndex((item) => item.id === action.id)
      const actions = [...targetOutfit.actions]
      if (actionIndex >= 0) actions[actionIndex] = action
      else actions.push(action)

      const outfits = [...character.outfits]
      outfits[outfitIndex] = { ...targetOutfit, actions }
      const nextActions = outfits.flatMap((outfit) => outfit.actions)
      const dataVersion = characterDataVersionForWrite(
        character.dataVersion,
        character.templates ?? [],
        nextActions,
      )
      assertMultiDirectionAssetPublishable(
        dataVersion,
        directionalMovement,
        character.templates ?? [],
        nextActions,
      )
      return characterApis.update({
        ...character,
        dataVersion,
        outfits,
      })
    },
  }
}

export function createActionSequences(
  generations: readonly Generation[],
  directionalMovement: DirectionalMovement,
): ActionSequence[] {
  const profile = getDirectionProfile(directionalMovement)
  const sources = new Map(
    profile.generationDirections.map((direction) => {
      const generation = generations.find(
        (item) =>
          item.type === 'complete_animation' &&
          item.status === 'completed' &&
          item.result?.type === 'complete_animation' &&
          (item.result.direction ?? 'east') === direction,
      )
      if (
        generation?.type !== 'complete_animation' ||
        generation.result?.type !== 'complete_animation' ||
        generation.result.frames.length === 0
      ) {
        throw new Error(`完整动画方向 ${direction} 的生成结果不可发布`)
      }
      return [direction, generation.result.frames] as const
    }),
  )
  return profile.logicalDirections.map((direction) => {
    const directFrames = sources.get(direction)
    if (directFrames) {
      return {
        direction,
        sourceDirection: null,
        mirrorX: false,
        frameCount: directFrames.length,
        frames: directFrames.map((frame) => ({
          index: frame.index,
          imageUrl: frame.url,
          durationMs: frame.durationMs,
        })),
      }
    }
    const derived = profile.derivedDirections.find((item) => item.direction === direction)
    if (!derived) throw new Error(`完整动画缺少方向 ${direction}`)
    const frames = sources.get(derived.sourceDirection)
    if (!frames) throw new Error(`完整动画缺少方向 ${derived.sourceDirection}`)
    return {
      direction,
      sourceDirection: derived.sourceDirection,
      mirrorX: derived.mirrorX,
      frameCount: frames.length,
      frames: [],
    }
  })
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
