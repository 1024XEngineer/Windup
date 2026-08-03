import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import type { Character, CharacterApis } from '@/entities/character'
import type { PlaytestInspectionApis } from '@/entities/playtest-inspection'
import type { ProjectApis } from '@/entities/project'
import { buildPlaytestPath } from '@/features/publish'

import { PlaytestWorkbench, type PlaytestAssetOption } from './workbench'

export interface PlaytestPageApis {
  characters: Pick<CharacterApis, 'get' | 'listByProject'>
  projects?: Pick<ProjectApis, 'get'>
  inspections?: Pick<PlaytestInspectionApis, 'get' | 'save'>
}

export interface PlaytestPageProps {
  apis?: PlaytestPageApis
}

interface PageData {
  character: Character | null
  projectCharacters: Character[]
  expectedCanvas: { width: number; height: number } | null
  error: string | null
  loading: boolean
}

const initialPageData: PageData = {
  character: null,
  projectCharacters: [],
  expectedCanvas: null,
  error: null,
  loading: false,
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const identifiable = error as { code?: unknown; status?: unknown }
  return (
    identifiable.code === 404 ||
    identifiable.code === '404' ||
    identifiable.status === 404 ||
    identifiable.status === '404'
  )
}

/**
 * 正式 Playtest 页面只读取 #70 已定义的 Character 接口。
 * 当接口未配置时，自动回退到内置 demo 角色素材。
 * 核验与自动分析结果均停留在页面会话，不写回资产树。
 */
export function PlaytestPage({ apis }: PlaytestPageProps) {
  const { characterId, outfitId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialActionId = searchParams.get('actionId')
  const [data, setData] = useState<PageData>(initialPageData)

  useEffect(() => {
    // 正式入口未配置角色接口时明确提示，不加载也不回退到 Demo 少年数据
    if (apis === undefined) {
      setData({
        character: null,
        projectCharacters: [],
        expectedCanvas: null,
        error: 'Playtest 角色接口尚未配置',
        loading: false,
      })
      return
    }
    if (characterId === undefined || outfitId === undefined) {
      setData({ ...initialPageData, error: 'Playtest 路由参数不完整' })
      return
    }

    let cancelled = false
    setData({ ...initialPageData, loading: true })
    void apis.characters.get(characterId).then(
      async (character) => {
        let projectCharacters = [character]
        let expectedCanvas: PageData['expectedCanvas'] = null
        const [charactersResult, projectResult] = await Promise.allSettled([
          apis.characters.listByProject(character.projectId),
          apis.projects?.get(character.projectId) ?? Promise.resolve(null),
        ])
        if (charactersResult.status === 'fulfilled') projectCharacters = charactersResult.value
        if (projectResult.status === 'fulfilled' && projectResult.value !== null) {
          expectedCanvas = projectResult.value.spriteSize
        }
        if (!cancelled) {
          setData({ character, projectCharacters, expectedCanvas, error: null, loading: false })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setData({
            ...initialPageData,
            error: isNotFoundError(error) ? '角色不存在' : '角色读取失败',
          })
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [apis, characterId, outfitId])

  if (data.error !== null) return <PlaytestPageMessage>{data.error}</PlaytestPageMessage>
  if (data.loading || data.character === null)
    return <PlaytestPageMessage>加载 Playtest 数据中</PlaytestPageMessage>

  const assetOptions = buildAssetOptions(data.projectCharacters)

  return (
    <div className="bg-[#eef0ed] pt-2">
      <div className="px-3 sm:px-5">
        <Link
          to="/playtest"
          aria-label="返回全部 Playtest"
          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-[#59635b] hover:bg-[#e1e5e1] hover:text-[#2f4e38]"
        >
          <span aria-hidden="true">←</span>
          全部 Playtest
        </Link>
      </div>
      <PlaytestWorkbench
        key={`${data.character.id}:${outfitId}:${initialActionId ?? ''}`}
        character={data.character}
        outfitId={outfitId ?? ''}
        assetOptions={assetOptions}
        expectedCanvas={data.expectedCanvas}
        inspectionApis={apis?.inspections}
        initialActionId={initialActionId}
        onSelectAsset={(asset) =>
          navigate(
            buildPlaytestPath({
              characterId: asset.characterId,
              outfitId: asset.outfitId,
            }),
          )
        }
        onAddAction={() => {
          const params = new URLSearchParams({
            characterId: data.character!.id,
            outfitId: outfitId ?? '',
          })
          navigate(`/quick-start?${params.toString()}`)
        }}
      />
    </div>
  )
}

function buildAssetOptions(characters: Character[]): PlaytestAssetOption[] {
  return characters.flatMap((character) =>
    character.outfits
      .filter((outfit) => outfit.actions.length > 0)
      .map((outfit) => ({
        key: `${character.id}:${outfit.id}`,
        characterId: character.id,
        outfitId: outfit.id,
        name: `${outfit.name}（角色 ${character.id}）`,
        actionCount: outfit.actions.length,
      })),
  )
}

function PlaytestPageMessage({ children }: { children: string }) {
  return (
    <main aria-label="Playtest" className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <p className="text-sm font-medium text-slate-700">{children}</p>
    </main>
  )
}
