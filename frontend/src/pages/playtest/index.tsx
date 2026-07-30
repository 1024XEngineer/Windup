import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'

import type { Character, CharacterApis } from '@/entities/character'

import { PlaytestWorkbench } from './workbench'

export interface PlaytestPageApis {
  characters: Pick<CharacterApis, 'get'>
}

export interface PlaytestPageProps {
  apis?: PlaytestPageApis
}

interface PageData {
  character: Character | null
  error: string | null
  loading: boolean
}

const initialPageData: PageData = { character: null, error: null, loading: false }

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
 * 核验与自动分析结果均停留在页面会话，不写回资产树。
 */
export function PlaytestPage({ apis }: PlaytestPageProps) {
  const { characterId, outfitId } = useParams()
  const [searchParams] = useSearchParams()
  const initialActionId = searchParams.get('actionId')
  const [data, setData] = useState<PageData>(initialPageData)

  useEffect(() => {
    if (apis === undefined) {
      setData({ ...initialPageData, error: 'Playtest 角色接口尚未配置' })
      return
    }
    if (characterId === undefined || outfitId === undefined) {
      setData({ ...initialPageData, error: 'Playtest 路由参数不完整' })
      return
    }

    let cancelled = false
    setData({ ...initialPageData, loading: true })
    void apis.characters.get(characterId).then(
      (character) => {
        if (!cancelled) setData({ character, error: null, loading: false })
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

  return (
    <PlaytestWorkbench
      key={initialActionId ?? ''}
      character={data.character}
      outfitId={outfitId ?? ''}
      initialActionId={initialActionId}
    />
  )
}

function PlaytestPageMessage({ children }: { children: string }) {
  return (
    <main aria-label="Playtest" className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <p className="text-sm font-medium text-slate-700">{children}</p>
    </main>
  )
}
