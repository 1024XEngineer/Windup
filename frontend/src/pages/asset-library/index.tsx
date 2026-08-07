import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { characterApis, type Character } from '@/entities'
import type { Paged } from '@/shared/pagination'
import { Pagination } from '@/shared/ui'

const CHARACTER_PAGE_SIZE = 24

function characterName(character: Character) {
  return character.name ?? '未命名角色'
}

export function AssetLibraryPage() {
  const { projectId } = useParams()
  const [pageNumber, setPageNumber] = useState(1)
  const [charactersPage, setCharactersPage] = useState<Paged<Character> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!projectId) {
      setError('缺少项目 ID')
      return () => {
        active = false
      }
    }

    setCharactersPage(null)
    setError(null)
    void characterApis
      .listByProject(projectId, {
        page: pageNumber,
        pageSize: CHARACTER_PAGE_SIZE,
      })
      .then(
        (page) => {
          if (active) setCharactersPage(page)
        },
        () => {
          if (active) setError('资产库暂时无法读取')
        },
      )
    return () => {
      active = false
    }
  }, [pageNumber, projectId])

  return (
    <section aria-labelledby="asset-library-title" className="min-h-full min-w-0">
      <h2 id="asset-library-title" className="sr-only">
        角色
      </h2>
      <div className="p-6 lg:p-8">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            aria-label="新建角色"
            disabled
            title="角色生成应进入 Workflow Editor"
            className="cursor-not-allowed rounded-full border border-[#cbd1c8] px-4 py-2 text-xs font-semibold text-[#858c84]"
          >
            ＋ 新建角色
          </button>
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-[#d8c7bd] bg-[#fff8f2] p-5 text-sm text-[#7a3f2a]"
          >
            {error}
          </p>
        ) : charactersPage === null ? (
          <p className="mt-8 text-sm text-[#70766f]">正在建立资产索引…</p>
        ) : (
          <>
            <CharacterGrid projectId={projectId ?? ''} characters={charactersPage.items} />
            <Pagination
              page={charactersPage.page}
              pageSize={charactersPage.pageSize}
              total={charactersPage.total}
              onPageChange={setPageNumber}
            />
          </>
        )}
      </div>
    </section>
  )
}

function CharacterGrid({ projectId, characters }: { projectId: string; characters: Character[] }) {
  if (characters.length === 0) return <EmptyState />

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
      {characters.map((character) => {
        const name = characterName(character)
        const outfit = character.outfits[0]
        const actionCount = character.outfits.reduce((sum, item) => sum + item.actions.length, 0)
        return (
          <Link
            key={character.id}
            to={`/projects/${projectId}/assets/${character.id}`}
            aria-label={`查看角色 ${name}`}
            className="group overflow-hidden rounded-[1.25rem] border border-[#d7dbd4] bg-white transition hover:border-[#9ca79c]"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-[#f0f2ed]">
              {outfit?.previewUrl ? (
                <img
                  src={outfit.previewUrl}
                  alt={`${name}的${outfit.name}预览`}
                  className="h-full w-full object-contain p-5 [image-rendering:pixelated] transition group-hover:scale-[1.025]"
                />
              ) : (
                <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#eef0eb_25%,#f7f7f4_25%,#f7f7f4_50%,#eef0eb_50%,#eef0eb_75%,#f7f7f4_75%)] bg-[length:24px_24px]">
                  <span className="rounded-full border border-[#d7dbd4] bg-white px-2.5 py-1 text-xs font-medium text-[#677068]">
                    暂无造型预览
                  </span>
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-[#242a24]">{name}</h3>
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

function EmptyState() {
  return (
    <div className="mt-5 rounded-[1.25rem] border border-dashed border-[#cbd1c8] bg-[#f8f9f6] p-7">
      <h3 className="font-semibold text-[#252a25]">这个项目还没有角色</h3>
      <p className="mt-2 text-sm text-[#6d736c]">角色会在创建工作流确认后进入这里。</p>
    </div>
  )
}
