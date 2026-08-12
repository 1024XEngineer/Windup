import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { characterApis, projectApis, type Character, type Outfit, type Project } from '@/entities'
import type { Paged } from '@/shared/pagination'
import { PageContainer } from '@/shared/ui'

import { PlaytestPixelStage } from './pixel-stage'

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

function outfitPlayback(outfit: Outfit) {
  const frameCount = outfit.actions.reduce((sum, action) => sum + action.frames.length, 0)
  return { frameCount, playable: frameCount > 0 }
}

/**
 * Playtest 的全局入口只负责定位已落入 Character 资产树的 Outfit。
 * 它不生成测试数据；具体操控仍交给带 characterId 与 outfitId 的试玩台。
 */
export function PlaytestEntryPage() {
  const [state, setState] = useState<EntryState>(initialState)

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
          if (active) setState({ groups: [], error: '可试玩资产暂时无法读取' })
        },
      )

    return () => {
      active = false
    }
  }, [])

  const outfitCount =
    state.groups?.reduce(
      (total, group) =>
        total + group.characters.reduce((sum, character) => sum + character.outfits.length, 0),
      0,
    ) ?? 0

  return (
    <PageContainer>
      <section aria-labelledby="playtest-entry-title">
        <header className="relative overflow-hidden border-b border-[#d8dbd4] bg-[linear-gradient(105deg,#fff_0%,#fff_54%,#f1f4ef_100%)] pb-7 md:min-h-64 md:px-2 md:py-7">
          <div className="relative z-10 max-w-xl">
            <p className="font-mono text-[0.68rem] font-semibold tracking-[0.2em] text-[#778078] uppercase">
              Character field test
            </p>
            <div className="mt-3">
              <h1
                id="playtest-entry-title"
                className="font-serif text-4xl font-medium tracking-[-0.045em] text-[#1f211e]"
              >
                选择可试玩资产
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#696e67]">
                选择一套已有造型，检查动作衔接、移动反馈和实际播放效果。
              </p>
            </div>
            <div className="mt-5 flex items-center gap-3 font-mono text-[0.68rem] text-[#747c74]">
              <span className="inline-block h-1.5 w-1.5 bg-[#294433]" />
              <span>{state.groups !== null ? `${outfitCount} 套造型已接入` : '正在接入资产'}</span>
            </div>
          </div>

          <PlaytestPixelStage />
        </header>

        {state.error ? (
          <ErrorState />
        ) : state.groups === null ? (
          <p className="mt-8 text-sm text-[#70766f]">正在整理可试玩资产…</p>
        ) : outfitCount === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-7 space-y-8">
            {state.groups.map((group) => {
              const charactersWithOutfits = group.characters.filter(
                (character) => character.outfits.length > 0,
              )
              if (charactersWithOutfits.length === 0) return null

              return (
                <section key={group.project.id} aria-labelledby={`project-${group.project.id}`}>
                  <div className="flex items-center justify-between gap-4">
                    <h2
                      id={`project-${group.project.id}`}
                      className="text-sm font-semibold text-[#343a34]"
                    >
                      {group.project.name}
                    </h2>
                    <Link
                      to={`/projects/${group.project.id}/assets`}
                      className="text-xs font-medium text-[#687268] underline decoration-[#b8c0b8] underline-offset-4 hover:text-[#294433]"
                    >
                      查看项目资产
                    </Link>
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {charactersWithOutfits.flatMap((character) =>
                      character.outfits.map((outfit) => (
                        <OutfitCard
                          key={`${character.id}:${outfit.id}`}
                          character={character}
                          outfit={outfit}
                        />
                      )),
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function OutfitCard({ character, outfit }: { character: Character; outfit: Outfit }) {
  const { frameCount, playable } = outfitPlayback(outfit)
  const name = characterName(character)
  const content = (
    <article
      className={`group overflow-hidden rounded-[1.4rem] border bg-[#f4f5f1] ${
        playable
          ? 'border-[#d3d8d1] transition duration-300 hover:-translate-y-0.5 hover:border-[#88988b] hover:bg-white'
          : 'border-[#dfe2dc] text-[#7b827b]'
      }`}
    >
      <div className="relative aspect-[16/9] overflow-hidden border-b border-[#dde1da] bg-[#e8ece7]">
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
          <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#e3e7e1_25%,#f1f2ee_25%,#f1f2ee_50%,#e3e7e1_50%,#e3e7e1_75%,#f1f2ee_75%)] bg-[length:24px_24px]">
            <span className="rounded-full border border-[#c9cec7] bg-[#f8f9f6]/90 px-3 py-1 text-xs font-medium text-[#707870]">
              暂无造型预览
            </span>
          </div>
        )}
        <span
          className={`absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold ${
            playable
              ? 'border-[#9eafa1] bg-[#edf3ed]/95 text-[#294433]'
              : 'border-[#cdd2cc] bg-[#f4f5f1]/95 text-[#7a817a]'
          }`}
        >
          {playable ? '可试玩' : '待补帧'}
        </span>
      </div>
      <div className="p-4">
        <p className="text-xs text-[#747b73]">{name}</p>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h3 className="font-serif text-xl font-medium tracking-[-0.03em] text-[#252925]">
            {outfit.name}
          </h3>
          <span aria-hidden="true" className="text-[#7a877d]">
            {playable ? '↗' : '—'}
          </span>
        </div>
        <p className="mt-4 border-t border-[#dfe2dc] pt-3 text-xs text-[#687168]">
          {playable ? `${outfit.actions.length} 个动作 · ${frameCount} 帧` : '尚无可播放帧'}
        </p>
      </div>
    </article>
  )

  if (!playable) return content

  return (
    <Link
      to={`/playtest/${character.id}/${outfit.id}`}
      aria-label={`试玩 ${name} · ${outfit.name}`}
      className="block rounded-[1.4rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#294433]"
    >
      {content}
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="mt-7 rounded-[1.5rem] border border-dashed border-[#c9cec6] bg-[#f7f8f4] p-7 sm:p-9">
      <h2 className="font-serif text-2xl font-medium tracking-[-0.03em] text-[#252a25]">
        还没有可试玩的角色
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#6d736c]">
        完成角色与动作制作后，可以在这里检查移动和动画效果。
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/quick-start"
          className="inline-flex min-h-10 items-center rounded-full bg-[#294433] px-5 text-sm font-semibold text-white hover:bg-[#1f3828] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#294433]"
        >
          开始创作
        </Link>
        <Link
          to="/projects"
          className="inline-flex min-h-10 items-center rounded-full border border-[#c7cec6] px-5 text-sm font-semibold text-[#465047] hover:border-[#939f95] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#294433]"
        >
          查看项目资产
        </Link>
      </div>
    </div>
  )
}

function ErrorState() {
  return (
    <div className="mt-7 rounded-[1.5rem] border border-[#d8c7bd] bg-[#fff8f2] p-7">
      <h2 className="font-semibold text-[#6f3928]">可试玩资产暂时无法读取</h2>
      <p className="mt-2 text-sm text-[#7a5548]">稍后刷新页面，或先回项目资产检查角色数据。</p>
      <Link
        to="/projects"
        className="mt-5 inline-flex min-h-10 items-center rounded-full border border-[#c9a99b] px-5 text-sm font-semibold text-[#6f3928]"
      >
        查看项目资产
      </Link>
    </div>
  )
}
