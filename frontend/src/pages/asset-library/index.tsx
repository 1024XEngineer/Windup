import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'

import { CHARACTER_STATUS, characterApis, type Character, type Project } from '@/entities'
import type { Paged } from '@/shared/pagination'
import { AssetPreviewCard, Pagination } from '@/shared/ui'

const CHARACTER_PAGE_SIZE = 24

function characterName(character: Character) {
  return character.name ?? '未命名角色'
}

export function AssetLibraryPage() {
  const { projectId } = useParams()
  const project = useOutletContext<Project>()
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
      <div className="p-6 lg:p-8">
        <header className="mb-7 border-b border-app-line pb-6">
          <Link
            to="/projects"
            className="text-xs font-medium text-app-muted underline decoration-app-line underline-offset-4 hover:text-app-accent"
          >
            返回项目中心
          </Link>
          <h2
            id="asset-library-title"
            className="mt-3 font-serif text-[clamp(2.15rem,4vw,3.5rem)] font-medium leading-none tracking-[-0.05em] text-app-ink"
          >
            {project.name}
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            {charactersPage === null ? '正在读取角色资产' : `${charactersPage.total} 个角色`}
          </p>
        </header>
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
          <AssetPreviewCard
            key={character.id}
            to={`/projects/${projectId}/assets/${character.id}`}
            ariaLabel={`查看角色 ${name}`}
            title={name}
            subtitle={outfit?.name ?? '尚未创建造型'}
            trailing="↗"
            footer={`${character.outfits.length} 套造型 · ${actionCount} 个动作`}
            previewUrl={outfit?.previewUrl ?? null}
            previewAlt={`${name}的${outfit?.name ?? '造型'}预览`}
            thumbnail
            eager={index < 4}
            priority={index === 0}
          />
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
