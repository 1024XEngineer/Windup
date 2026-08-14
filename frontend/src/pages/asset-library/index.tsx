import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { CHARACTER_STATUS, characterApis, type Character } from '@/entities'
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
        status: CHARACTER_STATUS.PUBLISHED,
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
            className="cursor-not-allowed rounded-full border border-app-line px-4 py-2 text-xs font-semibold text-app-faint"
          >
            ＋ 新建角色
          </button>
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-app-danger-line bg-app-danger-soft p-5 text-sm text-app-danger"
          >
            {error}
          </p>
        ) : charactersPage === null ? (
          <p className="mt-8 text-sm text-app-muted">正在建立资产索引…</p>
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
      {characters.map((character, index) => {
        const name = characterName(character)
        const outfit = character.outfits[0]
        const actionCount = character.outfits.reduce((sum, item) => sum + item.actions.length, 0)
        return (
          <Link
            key={character.id}
            to={`/projects/${projectId}/assets/${character.id}`}
            aria-label={`查看角色 ${name}`}
            className="group overflow-hidden rounded-[1.25rem] border border-app-line bg-app-surface-raised transition hover:border-app-line-strong"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-app-surface-muted">
              {outfit?.previewUrl ? (
                <img
                  src={outfit.previewUrl}
                  alt={`${name}的${outfit.name}预览`}
                  loading={index < 4 ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchPriority={index === 0 ? 'high' : 'auto'}
                  className="h-full w-full object-contain p-5 [image-rendering:pixelated] transition group-hover:scale-[1.025]"
                />
              ) : (
                <div className="grid h-full place-items-center bg-[linear-gradient(135deg,var(--color-app-surface-muted)_25%,var(--color-app-surface)_25%,var(--color-app-surface)_50%,var(--color-app-surface-muted)_50%,var(--color-app-surface-muted)_75%,var(--color-app-surface)_75%)] bg-[length:24px_24px]">
                  <span className="rounded-full border border-app-line bg-app-surface-raised px-2.5 py-1 text-xs font-medium text-app-muted">
                    暂无造型预览
                  </span>
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-app-ink">{name}</h3>
                  <p className="mt-1 text-xs text-app-faint">{outfit?.name ?? '尚未创建造型'}</p>
                </div>
                <span aria-hidden="true" className="text-app-faint">
                  ↗
                </span>
              </div>
              <div className="mt-4 flex gap-2 border-t border-app-line pt-3 text-xs text-app-muted">
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
    <div className="mt-5 rounded-[1.25rem] border border-dashed border-app-line bg-app-surface-raised p-7">
      <h3 className="font-semibold text-app-ink">这个项目还没有角色</h3>
      <p className="mt-2 text-sm text-app-muted">角色会在创建工作流确认后进入这里。</p>
    </div>
  )
}
