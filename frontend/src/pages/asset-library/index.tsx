import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import type { Character } from '@/entities'
import { mockCharacterApis, useExtractedAssets, type ExtractedAsset } from './mock'

export function AssetLibraryPage() {
  const { projectId } = useParams()
  const [searchParams] = useSearchParams()
  const { assets: extractedAssets } = useExtractedAssets()
  const [characters, setCharacters] = useState<Character[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!projectId) {
      setError('缺少项目 ID')
      return () => {
        active = false
      }
    }

    setCharacters(null)
    setError(null)
    void mockCharacterApis.listByProject(projectId).then(
      (nextCharacters) => {
        if (!active) return
        setCharacters(nextCharacters)
      },
      () => {
        if (active) setError('资产库暂时无法读取')
      },
    )
    return () => {
      active = false
    }
  }, [projectId])

  const normalizedQuery = (searchParams.get('q') ?? '').trim().toLowerCase()
  const requestedType = searchParams.get('type')
  const type =
    requestedType === 'actions' && extractedAssets.some((asset) => asset.kind === 'action')
      ? 'actions'
      : 'characters'
  const filteredCharacters = useMemo(
    () =>
      (characters ?? []).filter((character) =>
        character.name.toLowerCase().includes(normalizedQuery),
      ),
    [characters, normalizedQuery],
  )
  const filteredExtractedAssets = extractedAssets.filter(
    (asset) => asset.kind === 'action' && asset.name.toLowerCase().includes(normalizedQuery),
  )
  const currentLabel = type === 'actions' ? '动作模板' : '角色'
  return (
    <section aria-labelledby="asset-library-title" className="min-h-full min-w-0">
      <h2 id="asset-library-title" className="sr-only">
        {currentLabel}
      </h2>
      <div className="p-6 lg:p-8">
        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-[#d8c7bd] bg-[#fff8f2] p-5 text-sm text-[#7a3f2a]"
          >
            {error}
          </p>
        ) : characters === null ? (
          <p className="mt-8 text-sm text-[#70766f]">正在建立资产索引…</p>
        ) : type === 'characters' ? (
          <CharacterGrid projectId={projectId ?? ''} characters={filteredCharacters} />
        ) : (
          <ExtractedAssetGrid assets={filteredExtractedAssets} />
        )}
      </div>
    </section>
  )
}

function ExtractedAssetGrid({ assets }: { assets: ExtractedAsset[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
      {assets.map((asset) => (
        <article
          key={asset.id}
          aria-label={`动作模板 ${asset.name}`}
          className="overflow-hidden rounded-[1.25rem] border border-[#d7dbd4] bg-white"
        >
          <div className="aspect-[4/3] bg-[#eef1ec] p-4">
            <img
              src={asset.previewImageUrl}
              alt={`${asset.name}预览`}
              className="h-full w-full object-contain [image-rendering:pixelated]"
            />
          </div>
          <div className="p-4">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#7a827a]">
              动作模板
            </p>
            <h3 className="mt-1 font-semibold text-[#242a24]">{asset.name}</h3>
            <p className="mt-2 text-xs text-[#737b73]">来源：{asset.source}</p>
          </div>
        </article>
      ))}
    </div>
  )
}

function CharacterGrid({ projectId, characters }: { projectId: string; characters: Character[] }) {
  if (characters.length === 0) return <EmptyState title="这个项目还没有角色" action="新建角色" />
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
      {characters.map((character) => {
        const outfit = character.outfits[0]
        const actionCount = character.outfits.reduce((sum, item) => sum + item.actions.length, 0)
        return (
          <Link
            key={character.id}
            to={`/projects/${projectId}/assets/${character.id}`}
            aria-label={`查看角色 ${character.name}`}
            className="group overflow-hidden rounded-[1.25rem] border border-[#d7dbd4] bg-white transition hover:border-[#9ca79c]"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-[#f0f2ed]">
              {outfit?.characterTemplateUrl ? (
                <img
                  src={outfit.characterTemplateUrl}
                  alt={`${character.name}的${outfit.name}母版`}
                  className="h-full w-full object-contain p-5 [image-rendering:pixelated] transition group-hover:scale-[1.025]"
                />
              ) : (
                <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#eef0eb_25%,#f7f7f4_25%,#f7f7f4_50%,#eef0eb_50%,#eef0eb_75%,#f7f7f4_75%)] bg-[length:24px_24px]">
                  <span className="rounded-full border border-[#d7dbd4] bg-white px-2.5 py-1 text-xs font-medium text-[#677068]">
                    母版未定稿
                  </span>
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-[#242a24]">{character.name}</h4>
                  <p className="mt-1 text-xs text-[#767d75]">{outfit?.name ?? '尚未创建造型'}</p>
                </div>
                <span aria-hidden="true" className="text-[#899189]">
                  ↗
                </span>
              </div>
              <div className="mt-4 flex gap-2 border-t border-[#ecefe9] pt-3 text-xs text-[#697169]">
                <span>{character.outfits.length} 套造型</span>
                <span>·</span>
                <span>{actionCount} 个动作</span>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function EmptyState({ title, action }: { title: string; action: string }) {
  return (
    <div className="mt-5 rounded-[1.25rem] border border-dashed border-[#cbd1c8] bg-[#f8f9f6] p-7">
      <h4 className="font-semibold text-[#252a25]">{title}</h4>
      <p className="mt-2 text-sm text-[#6d736c]">新建后会出现在当前项目的资产索引中。</p>
      <button
        type="button"
        className="mt-5 rounded-lg bg-[#263f2d] px-3.5 py-2 text-sm font-medium text-white"
      >
        {action}
      </button>
    </div>
  )
}
