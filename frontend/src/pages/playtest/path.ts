interface PlaytestPathTarget {
  characterId: string
  outfitId: string
  actionId?: string
}

/**
 * 统一生成 Playtest 地址，避免目录页和工作台各自拼接路径。
 * actionId 放在查询参数中，因为它只决定当前预览动作，不改变角色和造型的资源身份。
 */
export function buildPlaytestPath({ characterId, outfitId, actionId }: PlaytestPathTarget): string {
  const pathname = `/playtest/${encodeURIComponent(characterId)}/${encodeURIComponent(outfitId)}`
  if (actionId === undefined) return pathname

  return `${pathname}?${new URLSearchParams({ actionId }).toString()}`
}
