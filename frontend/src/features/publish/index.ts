/**
 * 资产进入 Character 树由 Quick Start / Workflow Editor 在审核通过时完成。
 * 此处只保留页面跳转和稳定资产 ID 规则，避免再把已废弃的节点内嵌结果
 * 转成第二份资产模型。
 */
export interface PublishedAssetTarget {
  characterId: string
  outfitId: string
  actionId?: string
}

export function buildPlaytestPath(target: PublishedAssetTarget): string {
  const path = `/playtest/${encodeURIComponent(target.characterId)}/${encodeURIComponent(target.outfitId)}`
  return target.actionId ? `${path}?${new URLSearchParams({ actionId: target.actionId })}` : path
}

/** 同一角色的多个 Action 以 Run 和完整动画节点共同定位，防止互相覆盖。 */
export function buildPublishedActionId(
  characterId: string,
  runId: string,
  actionNodeId: string,
): string {
  return `${characterId}-${runId}-${actionNodeId}`
}
