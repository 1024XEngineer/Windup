import type { Character } from '@/entities'

/**
 * 创建/确认角色与母版，选择动作模板应用到角色。
 * 宿主：quick-start、workflow-editor、projects、asset-library 的「继续补充动作」。
 */
export interface CharacterSetupProps {
  /** 要创建或编辑角色的后端 Project ID。 */
  projectId: string
  /** 已有角色时传入，用于补充动作；不传表示新建。 */
  characterId?: string
  /** 角色建好或母版确认后通知宿主。 */
  onCharacterReady?: (character: Character) => void
}

export function CharacterSetup({ projectId, characterId }: CharacterSetupProps) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-400">
      角色与母版设置待实现（项目 {projectId}
      {characterId ? ` · 角色 ${characterId}` : ' · 新建'}）。
    </section>
  )
}
