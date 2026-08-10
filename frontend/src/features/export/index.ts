import type {
  Action,
  Character,
  CharacterApis,
  Generation,
  WorkflowNode,
  WorkflowRun,
} from '@/entities'

/** 把确认后的造型与动作导出到资产库。 */
export interface ExportProps {
  runId: string
  characterId: string
  outfitId: string
}

export interface PublishReviewedActionInput {
  character: Character
  workflow: WorkflowRun
  reviewNodeId: string
  generation: Generation
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
    async publishReviewedAction({ character, workflow, reviewNodeId, generation }) {
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
      if (generation.projectId !== workflow.projectId) {
        throw new Error('Generation 与当前 WorkflowRun 不匹配')
      }
      if (
        generation.id !==
          fullFrameNode.generations.find((item) => item.role === 'complete_animation')?.taskId ||
        generation.type !== 'complete_animation' ||
        generation.status !== 'completed' ||
        generation.result?.type !== 'complete_animation' ||
        generation.result.frames.length === 0
      ) {
        throw new Error('完整动画生成结果不可发布')
      }

      const methodNode = findSingleDependency(workflow, fullFrameNode, 'action-generation-method')
      const firstFrameNode = findSingleDependency(workflow, methodNode, 'action-first-frame')
      const templateNode = findSingleDependency(workflow, firstFrameNode, 'character-template')
      const setupNode = findSingleDependency(workflow, templateNode, 'character-setup')
      if (!templateNode.selectedImageUrl) throw new Error('角色母版尚未确认')

      const outfitIndex = character.outfits.findIndex(
        (outfit) => outfit.id === firstFrameNode.input.outfitId,
      )
      if (outfitIndex < 0) throw new Error('动作所属造型不存在')

      const action: Action = {
        id: firstFrameNode.id,
        outfitId: firstFrameNode.input.outfitId,
        name: firstFrameNode.input.name,
        type: firstFrameNode.input.type,
        loop: firstFrameNode.input.type === 'idle' || firstFrameNode.input.type === 'walk',
        fps: firstFrameNode.input.fps,
        frameCount: generation.result.frames.length,
        frames: generation.result.frames.map((frame, index) => ({
          index,
          imageUrl: frame.url,
          durationMs: null,
        })),
      }
      const targetOutfit = character.outfits[outfitIndex]!
      const actionIndex = targetOutfit.actions.findIndex((item) => item.id === action.id)
      const actions = [...targetOutfit.actions]
      if (actionIndex >= 0) actions[actionIndex] = action
      else actions.push(action)

      const outfits = [...character.outfits]
      outfits[outfitIndex] = { ...targetOutfit, actions }
      return characterApis.update({
        ...character,
        description: setupNode.input.prompt,
        referenceImageUrl: templateNode.selectedImageUrl,
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
