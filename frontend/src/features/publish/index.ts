import type { ActionType, Character, CharacterApis, WorkflowNode, WorkflowRun } from '@/entities'

/** 已经写入 Character 后端记录、可以由资产库和 Playtest 读取的目标。 */
export interface PublishedAssetTarget {
  characterId: string
  outfitId: string
  actionId?: string
}

/** 发布后的页面入口。真正的资产写入由 CharacterApis 完成。 */
export function buildPlaytestPath(target: PublishedAssetTarget): string {
  const path = `/playtest/${encodeURIComponent(target.characterId)}/${encodeURIComponent(target.outfitId)}`
  return target.actionId ? `${path}?${new URLSearchParams({ actionId: target.actionId })}` : path
}

const ACTION_NAMES: Record<ActionType, string> = {
  idle: '待机',
  walk: '行走',
  jump: '跳跃',
  attack: '攻击',
  custom: '自定义动作',
}

/** 动作 ID 同时绑定 Run 与动作节点，保证同一 Run 的多个动作不会互相覆盖。 */
export function buildPublishedActionId(
  characterId: string,
  runId: string,
  actionStepId: string,
): string {
  return `${characterId}-${runId}-${actionStepId}`
}

/** 审核通过时才把 WorkflowRun 中的完整动画写入正式 Character 资产树。 */
export async function publishWorkflowRun(
  characterApis: CharacterApis,
  run: WorkflowRun,
  actionNodeId?: string,
): Promise<Character> {
  if (!run.characterId || !run.outfitId) throw new Error('工作流还没有关联角色与造型')
  const node = findReviewedAction(run.nodes, actionNodeId)
  if (!node?.output) {
    throw new Error('动作生成尚未完成，不能发布')
  }
  const result = node.output
  const character = await characterApis.get(run.characterId)
  const outfit = character.outfits.find((item) => item.id === run.outfitId)
  if (!outfit) throw new Error('角色中没有找到工作流关联的造型')
  const actionId = buildPublishedActionId(character.id, run.id, node.id)
  const action = {
    id: actionId,
    outfitId: outfit.id,
    name:
      result.actionType === 'custom'
        ? node.input?.prompt?.trim() || run.prompt?.trim() || '自定义动作'
        : ACTION_NAMES[result.actionType],
    expectedFrameCount: result.frames.length,
    type: result.actionType,
    fps: 8,
    keyFrameIndex: 0,
    frames: result.frames.map((frame) => ({
      imageUrl: frame.imageUrl,
      durationMs: frame.durationMs,
      rootMotion: null,
    })),
  }
  return characterApis.update({
    ...character,
    outfits: character.outfits.map((item) =>
      item.id === outfit.id
        ? {
            ...item,
            actions: [...item.actions.filter((old) => old.id !== actionId), action],
          }
        : item,
    ),
  })
}

function findReviewedAction(nodes: WorkflowRun['nodes'], actionNodeId?: string) {
  const candidates = nodes.filter(
    (node): node is Extract<WorkflowNode, { type: 'action-full-frame' }> =>
      node.type === 'action-full-frame' &&
      !node.deletedAt &&
      node.status === 'passed' &&
      Boolean(node.output) &&
      (!actionNodeId || node.id === actionNodeId),
  )
  return (
    candidates.findLast((action) =>
      nodes.some(
        (review) =>
          review.type === 'review' &&
          !review.deletedAt &&
          review.status === 'passed' &&
          review.dependsOnNodeIds.includes(action.id),
      ),
    ) ?? null
  )
}

export { canPublishToPlaytest, workflowRunToCharacter } from './workflow-to-character'
