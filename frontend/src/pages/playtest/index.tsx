import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router'

import { characterApis, projectApis, type Character, type Project } from '@/entities'
import { ApiError } from '@/shared/api'

import { PlaytestWorkbench } from './workbench'

export { PlaytestEntryPage } from './entry'

export interface PlaytestPageProps {
  renderToolbar?(context: {
    project: Project
    character: Character
    outfitId: string
    initialActionId: string | null
  }): ReactNode
}

interface PageData {
  character: Character | null
  project: Project | null
  error: string | null
  loading: boolean
}

const initialPageData: PageData = { character: null, project: null, error: null, loading: false }

/**
 * 后端把「角色不存在」表达成 HTTP 200 里的业务码 404，真正的传输失败才落在 status 上。
 * 两者都要认：只看其中一个，会把找不到的角色显示成读取失败，或者反过来。
 */
function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 404 || error.status === 404)
}

/**
 * 预览台：用角色造型里已经确认的动作帧真实操控角色。
 * 页面只读 Character，不写回资产树，也不参与生成与审核。
 * 读不到角色时直接报错，不退回任何内置数据。
 */
export function PlaytestPage({ renderToolbar }: PlaytestPageProps = {}) {
  const { characterId, outfitId } = useParams()
  const [searchParams] = useSearchParams()
  const initialActionId = searchParams.get('actionId')
  const [data, setData] = useState<PageData>(initialPageData)

  useEffect(() => {
    if (characterId === undefined) return

    let cancelled = false
    setData({ ...initialPageData, loading: true })
    void characterApis
      .get(characterId)
      .then(async (character) => ({
        character,
        project: await projectApis.get(character.projectId),
      }))
      .then(
        ({ character, project }) => {
          if (!cancelled) setData({ character, project, error: null, loading: false })
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
  }, [characterId])

  if (characterId === undefined || outfitId === undefined)
    return <PlaytestPageMessage>预览台路由参数不完整</PlaytestPageMessage>
  if (data.error !== null) return <PlaytestPageMessage>{data.error}</PlaytestPageMessage>
  if (data.loading || data.character === null || data.project === null)
    return <PlaytestPageMessage>正在加载预览台数据</PlaytestPageMessage>

  const toolbar = renderToolbar?.({
    project: data.project,
    character: data.character,
    outfitId,
    initialActionId,
  })

  return (
    <PlaytestWorkbench
      character={data.character}
      outfitId={outfitId}
      initialActionId={initialActionId}
      toolbar={toolbar}
    />
  )
}

function PlaytestPageMessage({ children }: { children: string }) {
  return (
    <main aria-label="预览台" className="grid min-h-screen place-items-center bg-[#dfe3df] p-6">
      <p className="text-sm font-medium text-[#3d443f]">{children}</p>
    </main>
  )
}
