import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import {
  characterApis,
  getOutfitPlayback,
  projectApis,
  type Character,
  type Outfit,
  type Project,
} from '@/entities'
import type { Paged } from '@/shared/pagination'
import { EditorialEntryCard, PageContainer } from '@/shared/ui'

interface ProjectCharacters {
  project: Project
  characters: Character[]
}

interface EntryState {
  groups: ProjectCharacters[] | null
  error: string | null
}

const initialState: EntryState = { groups: null, error: null }
const ASSET_PAGE_SIZE = 100

async function loadAllPages<T>(loadPage: (page: number) => Promise<Paged<T>>) {
  const firstPage = await loadPage(1)
  const pageCount = Math.ceil(firstPage.total / firstPage.pageSize)
  if (pageCount <= 1) return firstPage.items

  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => loadPage(index + 2)),
  )
  return [firstPage, ...remainingPages].flatMap((page) => page.items)
}

function characterName(character: Character) {
  return character.name ?? '未命名角色'
}

/**
 * Playtest 的全局入口只负责定位已落入 Character 资产树的 Outfit。
 * 它不生成测试数据；具体操控仍交给带 characterId 与 outfitId 的预览台。
 */
export function PlaytestEntryPage() {
  const [state, setState] = useState<EntryState>(initialState)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setState(initialState)

    void loadAllPages((page) => projectApis.list({ page, pageSize: ASSET_PAGE_SIZE }))
      .then(async (projects) =>
        Promise.all(
          projects.map(async (project) => ({
            project,
            characters: await loadAllPages((page) =>
              characterApis.listByProject(project.id, { page, pageSize: ASSET_PAGE_SIZE }),
            ),
          })),
        ),
      )
      .then(
        (groups) => {
          if (active) setState({ groups, error: null })
        },
        () => {
          if (active) setState({ groups: [], error: '可预览资产暂时无法读取' })
        },
      )

    return () => {
      active = false
    }
  }, [])

  const outfits = useMemo(
    () =>
      state.groups?.flatMap(({ project, characters }) =>
        characters.flatMap((character) =>
          character.outfits.map((outfit) => ({ project, character, outfit })),
        ),
      ) ?? [],
    [state.groups],
  )
  const visibleOutfits = selectedProjectId
    ? outfits.filter(({ project }) => project.id === selectedProjectId)
    : outfits
  const outfitCount = outfits.length

  return (
    <PageContainer>
      <section aria-labelledby="playtest-entry-title">
        <header className="flex flex-col gap-4 border-b border-app-line pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1
              id="playtest-entry-title"
              className="font-serif text-4xl font-medium tracking-[-0.045em] text-app-ink"
            >
              预览台
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">
              从已有造型进入操控测试，检查动作衔接、移动反馈和实际播放效果。
            </p>
          </div>
          <p className="shrink-0 pb-0.5 font-mono text-[0.68rem] text-app-faint">
            {state.groups !== null ? `${outfitCount} 套造型已接入` : '正在接入资产'}
          </p>
        </header>

        {state.error ? (
          <ErrorState />
        ) : state.groups === null ? (
          <p className="mt-8 text-sm text-app-muted">正在整理可预览资产…</p>
        ) : outfitCount === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-5">
            <div
              className="flex flex-wrap items-center gap-2 border-b border-app-line pb-4"
              aria-label="按项目筛选"
            >
              <button
                type="button"
                aria-label="筛选全部项目"
                aria-pressed={selectedProjectId === null}
                onClick={() => setSelectedProjectId(null)}
                className={`min-h-9 rounded-full border px-4 text-xs font-medium transition ${
                  selectedProjectId === null
                    ? 'border-app-accent bg-app-accent text-app-on-accent'
                    : 'border-app-line bg-app-surface text-app-muted hover:border-app-line-strong hover:text-app-ink'
                }`}
              >
                全部
              </button>
              {state.groups.map(({ project }) => (
                <button
                  key={project.id}
                  type="button"
                  aria-label={`筛选项目 ${project.name}`}
                  aria-pressed={selectedProjectId === project.id}
                  onClick={() => setSelectedProjectId(project.id)}
                  className={`min-h-9 rounded-full border px-4 text-xs font-medium transition ${
                    selectedProjectId === project.id
                      ? 'border-app-accent bg-app-accent text-app-on-accent'
                      : 'border-app-line bg-app-surface text-app-muted hover:border-app-line-strong hover:text-app-ink'
                  }`}
                >
                  {project.name}
                </button>
              ))}
            </div>

            {visibleOutfits.length === 0 ? (
              <div className="py-16 text-center">
                <p className="font-serif text-2xl text-app-ink">这个项目还没有可预览造型</p>
                <p className="mt-2 text-sm text-app-muted">可以先去项目资产确认角色和造型。</p>
              </div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleOutfits.map(({ project, character, outfit }) => (
                  <OutfitCard
                    key={`${character.id}:${outfit.id}`}
                    project={project}
                    character={character}
                    outfit={outfit}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function OutfitCard({
  project,
  character,
  outfit,
}: {
  project: Project
  character: Character
  outfit: Outfit
}) {
  const { frameCount, playable } = getOutfitPlayback(outfit)
  const name = characterName(character)
  const playableActions = outfit.actions.filter((action) => action.frames.length > 0)
  const actionSummary = playableActions.map((action) => action.name).join(' · ')
  const content = (
    <article
      className={`group overflow-hidden rounded-[1.5rem] border bg-app-surface ${
        playable
          ? 'border-app-line transition duration-300 hover:-translate-y-0.5 hover:border-app-line-strong hover:bg-app-surface-raised'
          : 'border-app-line text-app-faint'
      }`}
    >
      <div className="relative aspect-[16/9] overflow-hidden border-b border-app-line bg-app-surface-muted">
        {outfit.previewUrl ? (
          <img
            src={outfit.previewUrl}
            alt={`${name}的${outfit.name}预览`}
            className={`h-full w-full object-contain p-5 [image-rendering:pixelated] ${
              playable
                ? 'transition duration-300 group-hover:scale-[1.025]'
                : 'opacity-55 grayscale'
            }`}
          />
        ) : (
          <div className="grid h-full place-items-center bg-[linear-gradient(135deg,var(--color-app-surface-muted)_25%,var(--color-app-surface)_25%,var(--color-app-surface)_50%,var(--color-app-surface-muted)_50%,var(--color-app-surface-muted)_75%,var(--color-app-surface)_75%)] bg-[length:24px_24px]">
            <span className="rounded-full border border-app-line bg-app-surface-raised/90 px-3 py-1 text-xs font-medium text-app-muted">
              暂无造型预览
            </span>
          </div>
        )}
        <span
          className={`absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold ${
            playable
              ? 'border-app-line-strong bg-app-accent-muted/95 text-app-accent'
              : 'border-app-line bg-app-surface/95 text-app-faint'
          }`}
        >
          {playable ? '可预览' : '待补帧'}
        </span>
      </div>
      <div className="p-5">
        <p className="text-xs text-app-faint">{project.name}</p>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-xl font-medium tracking-[-0.03em] text-app-ink">
              {name}
            </h3>
            <p className="mt-1 text-xs font-medium text-app-muted">{outfit.name}</p>
          </div>
          <span aria-hidden="true" className="text-app-faint">
            {playable ? '↗' : '—'}
          </span>
        </div>
        <div className="mt-4 border-t border-app-line pt-3 text-xs">
          {playable ? (
            <>
              <p className="truncate text-app-ink-soft">{actionSummary}</p>
              <p className="mt-1.5 text-app-faint">
                {playableActions.length} 个动作 · {frameCount} 帧
              </p>
            </>
          ) : (
            <p className="text-app-faint">尚无可播放帧</p>
          )}
        </div>
      </div>
    </article>
  )

  if (!playable) return content

  return (
    <Link
      to={`/playtest/${character.id}/${outfit.id}`}
      aria-label={`预览 ${name} · ${outfit.name}`}
      className="block rounded-[1.5rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
    >
      {content}
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="mt-5">
      <EditorialEntryCard
        to="/quick-start"
        ariaLabel="开始创作"
        artwork="playtest"
        title="还没有可预览的角色"
        description="完成角色与动作制作后，可以在这里检查移动和动画效果。"
        action="开始创作"
      />
      <div className="mt-3 flex justify-end">
        <Link
          to="/projects"
          className="text-xs font-medium text-app-muted underline decoration-app-line underline-offset-4 hover:text-app-accent"
        >
          查看项目资产
        </Link>
      </div>
    </div>
  )
}

function ErrorState() {
  return (
    <div className="mt-7 rounded-[1.5rem] border border-app-danger-line bg-app-danger-soft p-7">
      <h2 className="font-semibold text-app-danger">可预览资产暂时无法读取</h2>
      <p className="mt-2 text-sm text-app-danger-muted">
        稍后刷新页面，或先回项目资产检查角色数据。
      </p>
      <Link
        to="/projects"
        className="mt-5 inline-flex min-h-10 items-center rounded-full border border-app-danger-line px-5 text-sm font-semibold text-app-danger"
      >
        查看项目资产
      </Link>
    </div>
  )
}
