/** 资产库页面：读取后端已经保存的 Character 树，不展示运行中的 WorkflowRun。 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import type { Character, CharacterApis } from '@/entities'

export function AssetLibraryPage({ apis }: { apis: CharacterApis }) {
  const { projectId = '' } = useParams()
  const [characters, setCharacters] = useState<Character[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!projectId) return
    void apis.listByProject(projectId).then(
      (items) =>
        active &&
        setCharacters(
          items.filter((character) =>
            character.outfits.some((outfit) => outfit.actions.length > 0),
          ),
        ),
      (cause) => active && setError(cause instanceof Error ? cause.message : '资产加载失败'),
    )
    return () => {
      active = false
    }
  }, [apis, projectId])

  return (
    <section className="py-8">
      <p className="text-xs font-semibold text-slate-500">ASSET LIBRARY</p>
      <h1 className="mt-2 text-3xl font-semibold">资产库</h1>
      <p className="mt-2 text-sm text-slate-500">项目中已经发布的角色、造型和动作。</p>
      {error && (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      )}
      {!error && characters.length === 0 && (
        <p className="mt-8 border border-dashed border-slate-300 p-8 text-sm text-slate-500">
          这个项目还没有已发布资产。
        </p>
      )}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {characters.flatMap((character) =>
          character.outfits.map((outfit) => (
            <article key={`${character.id}:${outfit.id}`} className="border border-slate-200 p-4">
              {outfit.characterTemplateUrl && (
                <img
                  className="aspect-square w-full bg-slate-100 object-contain"
                  src={outfit.characterTemplateUrl}
                  alt={`${outfit.name} 角色母版`}
                />
              )}
              <h2 className="mt-4 font-semibold">{outfit.name}</h2>
              <p className="mt-1 text-xs text-slate-500">{outfit.actions.length} 个动作</p>
              <Link
                className="mt-4 inline-block text-sm font-semibold underline"
                to={`/playtest/${character.id}/${outfit.id}`}
              >
                进入预览台
              </Link>
            </article>
          )),
        )}
      </div>
    </section>
  )
}
