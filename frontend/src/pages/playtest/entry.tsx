import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'

import { loadPlayableCharacters, type PlaytestAssetSourceApis } from './assets'
import { buildPlaytestPath } from './path'

export type PlaytestEntryApis = PlaytestAssetSourceApis

interface EntryState {
  target: string | null
  message: string
}

const initialState: EntryState = {
  target: null,
  message: '正在进入 Playtest 工作台',
}

/**
 * Playtest 的根路由只是工作台入口，不承担项目目录或资产管理职责。
 * 它从现有项目中找到第一个包含动作的造型，然后把完整上下文交给正式工作台路由。
 */
export function PlaytestEntryPage({ apis }: { apis: PlaytestEntryApis }) {
  const [state, setState] = useState<EntryState>(initialState)

  useEffect(() => {
    let cancelled = false

    void resolveWorkbenchTarget(apis).then(
      (target) => {
        if (!cancelled) {
          setState({
            target,
            message: target === null ? '没有可预览的动作，请先完成一次动作生成' : '',
          })
        }
      },
      () => {
        if (!cancelled) setState({ target: null, message: 'Playtest 数据读取失败' })
      },
    )

    return () => {
      cancelled = true
    }
  }, [apis])

  if (state.target !== null) return <Navigate to={state.target} replace />

  return (
    <main aria-label="Playtest" className="grid min-h-screen place-items-center bg-[#eef0ed] p-6">
      <div className="text-center">
        <h1 className="sr-only">Playtest</h1>
        <p className="text-sm font-medium text-[#59635b]">{state.message}</p>
      </div>
    </main>
  )
}

async function resolveWorkbenchTarget(apis: PlaytestEntryApis): Promise<string | null> {
  const character = (await loadPlayableCharacters(apis))[0]
  const outfit = character?.outfits[0]
  const action = outfit?.actions[0]
  if (!character || !outfit || !action) return null

  return buildPlaytestPath({
    characterId: character.id,
    outfitId: outfit.id,
    actionId: action.id,
  })
}
