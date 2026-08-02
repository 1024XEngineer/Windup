/** 已经写入 Character 后端记录、可以由资产库和 Playtest 读取的目标。 */
export interface PublishedAssetTarget {
  characterId: string
  outfitId: string
  actionId?: string
}

/** 发布后的页面入口。真正的资产写入由 CharacterApis 完成。 */
export function buildPlaytestPath(target: PublishedAssetTarget): string {
  const path = `/playtest/${encodeURIComponent(target.characterId)}/${encodeURIComponent(target.outfitId)}`
  return target.actionId ? `${path}?actionId=${encodeURIComponent(target.actionId)}` : path
}

const ACTION_NAMES: Record<ActionType, string> = {
  idle: '待机',
  walk: '行走',
  jump: '跳跃',
  attack: '攻击',
  custom: '自定义动作',
}

/** 审核通过时才把 WorkflowRun 中的完整动画写入正式 Character 资产树。 */
export async function publishWorkflowRun(
  characterApis: CharacterApis,
  run: WorkflowRun,
): Promise<Character> {
  if (!run.characterId || !run.outfitId) throw new Error('工作流还没有关联角色与造型')
  const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
  const step = revision?.steps.find((item) => item.type === 'action-generation')
  if (step?.type !== 'action-generation' || step.status !== 'passed' || !step.output) {
    throw new Error('动作生成尚未完成，不能发布')
  }
  const result = step.output
  const character = await characterApis.get(run.characterId)
  const outfit = character.outfits.find((item) => item.id === run.outfitId)
  if (!outfit) throw new Error('角色中没有找到工作流关联的造型')
  const actionId = `${character.id}-${result.actionType}`
  const action = {
    id: actionId,
    outfitId: outfit.id,
    name: ACTION_NAMES[result.actionType],
    kind: 'custom' as const,
    type: result.actionType,
    fps: 8,
    keyFrameIndex: 0,
    frames: result.frames.map((frame) => ({
      imageUrl: frame.url,
      durationMs: frame.durationMs,
      rootMotion: null,
    })),
  }
  return characterApis.update({
    ...character,
    outfits: character.outfits.map((item) =>
      item.id === outfit.id
        ? { ...item, actions: [...item.actions.filter((old) => old.id !== actionId), action] }
        : item,
    ),
  })
}

export { canPublishToPlaytest, workflowRunToCharacter } from './workflow-to-character'
import type { ActionType, Character, CharacterApis, WorkflowRun } from '@/entities'
