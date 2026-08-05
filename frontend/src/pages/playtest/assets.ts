import type { Character, CharacterApis } from '@/entities/character'
import type { ProjectApis } from '@/entities/project'

export interface PlaytestAssetSourceApis {
  projects: Pick<ProjectApis, 'list'>
  characters: Pick<CharacterApis, 'listByProject'>
}

/**
 * Playtest 只接收真正能够播放的内容。这里生成只读视图，不删除或改写后端 Character：
 * 没有帧的动作、没有可播放动作的造型，以及最终没有造型的角色都会被排除。
 */
export function toPlayableCharacter(character: Character): Character | null {
  const outfits = character.outfits
    .map((outfit) => ({
      ...outfit,
      actions: outfit.actions.filter((action) => action.frames.length > 0),
    }))
    .filter((outfit) => outfit.actions.length > 0)

  return outfits.length > 0 ? { ...character, outfits } : null
}

/** 汇总所有项目中的可播放角色，供同一个 Playtest 工作台左栏切换。 */
export async function loadPlayableCharacters(apis: PlaytestAssetSourceApis): Promise<Character[]> {
  const projectPage = await apis.projects.list({ page: 1, pageSize: 100 })
  const characterResults = await Promise.allSettled(
    projectPage.items.map((project) => apis.characters.listByProject(project.id)),
  )
  const characters: Character[] = []
  const seenCharacterIds = new Set<string>()

  for (const result of characterResults) {
    if (result.status !== 'fulfilled') continue
    for (const character of result.value) {
      const playable = toPlayableCharacter(character)
      if (playable === null || seenCharacterIds.has(playable.id)) continue
      seenCharacterIds.add(playable.id)
      characters.push(playable)
    }
  }

  if (
    characterResults.length > 0 &&
    characterResults.every((result) => result.status === 'rejected')
  ) {
    throw new Error('所有项目的角色读取均失败')
  }
  return characters
}
