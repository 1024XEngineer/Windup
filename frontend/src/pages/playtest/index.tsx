import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'

import type { Character, CharacterApis } from '@/entities/character'
import type { PlaytestInspectionApis } from '@/entities/playtest-inspection'
import type { ProjectApis } from '@/entities/project'
import { buildPlaytestPath } from '@/features/publish'

import { loadPlayableCharacters, toPlayableCharacter } from './assets'
import { PlaytestWorkbench, type PlaytestAssetOption } from './workbench'

export interface PlaytestPageApis {
  characters: Pick<CharacterApis, 'get' | 'listByProject'> &
    Partial<Pick<CharacterApis, 'update' | 'remove'>>
  projects?: Pick<ProjectApis, 'get' | 'list'>
  inspections?: Pick<PlaytestInspectionApis, 'get' | 'save'>
  /** 删除必须经过工作流命令，避免 Character 已删但 WorkflowRun 仍显示可发布。 */
  deleteAsset?(characterId: string, outfitId: string): Promise<Character | null>
  /** 删除 Action 时保留其 WorkflowRun 分支，并标记为已删除。 */
  deleteAction?(characterId: string, outfitId: string, actionId: string): Promise<Character>
}

export interface PlaytestPageProps {
  apis?: PlaytestPageApis
}

interface PageData {
  character: Character | null
  playableCharacters: Character[]
  expectedCanvas: { width: number; height: number } | null
  error: string | null
  loading: boolean
}

const initialPageData: PageData = {
  character: null,
  playableCharacters: [],
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
 * 正式 Playtest 页面使用 #70 已定义的 Character 接口读取与管理资产。
 * 接口未配置时明确报错，不允许正式入口回退到 Demo 数据。
 * 预览、播放和自动分析本身不改资产；只有用户明确触发改名或删除时才写回 Character。
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
        playableCharacters: [],
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
        const playableCharacter = toPlayableCharacter(character)
        if (playableCharacter === null) {
          if (!cancelled) {
            setData({ ...initialPageData, error: '这个角色没有可预览的动作' })
          }
          return
        }

        let playableCharacters = [playableCharacter]
        let expectedCanvas: PageData['expectedCanvas'] = null
        const [charactersResult, projectResult] = await Promise.allSettled([
          apis.projects
            ? loadPlayableCharacters({ projects: apis.projects, characters: apis.characters })
            : apis.characters
                .listByProject(character.projectId)
                .then((characters) =>
                  characters
                    .map(toPlayableCharacter)
                    .filter((candidate): candidate is Character => candidate !== null),
                ),
          apis.projects?.get(character.projectId) ?? Promise.resolve(null),
        ])
        if (charactersResult.status === 'fulfilled') {
          playableCharacters = [
            playableCharacter,
            ...charactersResult.value.filter((candidate) => candidate.id !== playableCharacter.id),
          ]
        }
        if (projectResult.status === 'fulfilled' && projectResult.value !== null) {
          expectedCanvas = projectResult.value.spriteSize
        }
        if (!cancelled) {
          setData({
            character: playableCharacter,
            playableCharacters,
            expectedCanvas,
            error: null,
            loading: false,
          })
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

  const assetOptions = buildAssetOptions(data.playableCharacters)

  function replaceCharacter(saved: Character | null, characterId: string): Character[] {
    const playable = saved ? toPlayableCharacter(saved) : null
    const nextCharacters = data.playableCharacters.flatMap((candidate) => {
      if (candidate.id !== characterId) return [candidate]
      return playable ? [playable] : []
    })
    if (playable && !nextCharacters.some((candidate) => candidate.id === playable.id)) {
      nextCharacters.push(playable)
    }
    setData((current) => ({
      ...current,
      character: current.character?.id === characterId ? playable : current.character,
      playableCharacters: nextCharacters,
    }))
    return nextCharacters
  }

  async function renameAsset(asset: PlaytestAssetOption, name: string) {
    if (!apis?.characters.update) throw new Error('角色更新接口尚未配置')
    const source = await apis.characters.get(asset.characterId)
    if (!source.outfits.some((outfit) => outfit.id === asset.outfitId)) {
      throw new Error('没有找到需要改名的造型')
    }
    const saved = await apis.characters.update({
      ...source,
      outfits: source.outfits.map((outfit) =>
        outfit.id === asset.outfitId ? { ...outfit, name } : outfit,
      ),
    })
    replaceCharacter(saved, source.id)
  }

  async function deleteAsset(asset: PlaytestAssetOption) {
    if (!apis?.deleteAsset) throw new Error('资产删除命令尚未配置')
    const saved = await apis.deleteAsset(asset.characterId, asset.outfitId)
    const nextCharacters = replaceCharacter(saved, asset.characterId)
    const nextAsset = buildAssetOptions(nextCharacters)[0]
    navigate(
      nextAsset
        ? buildPlaytestPath({ characterId: nextAsset.characterId, outfitId: nextAsset.outfitId })
        : '/playtest',
      { replace: true },
    )
  }

  async function renameAction(actionId: string, name: string) {
    if (!apis?.characters.update) throw new Error('角色更新接口尚未配置')
    const source = await apis.characters.get(data.character!.id)
    const saved = await apis.characters.update({
      ...source,
      outfits: source.outfits.map((outfit) =>
        outfit.id === outfitId
          ? {
              ...outfit,
              actions: outfit.actions.map((action) =>
                action.id === actionId ? { ...action, name } : action,
              ),
            }
          : outfit,
      ),
    })
    replaceCharacter(saved, source.id)
  }

  async function deleteAction(actionId: string) {
    if (!apis?.deleteAction) throw new Error('动作删除命令尚未配置')
    const characterId = data.character!.id
    const saved = await apis.deleteAction(characterId, outfitId ?? '', actionId)
    const nextCharacters = replaceCharacter(saved, characterId)
    const savedPlayable = toPlayableCharacter(saved)
    const remainingOutfit = savedPlayable?.outfits.find((outfit) => outfit.id === outfitId)
    const nextAction = remainingOutfit?.actions[0]
    if (remainingOutfit && nextAction) {
      navigate(
        buildPlaytestPath({
          characterId: saved.id,
          outfitId: remainingOutfit.id,
          actionId: nextAction.id,
        }),
        { replace: true },
      )
      return
    }
    const nextAsset = buildAssetOptions(nextCharacters)[0]
    navigate(
      nextAsset
        ? buildPlaytestPath({ characterId: nextAsset.characterId, outfitId: nextAsset.outfitId })
        : '/playtest',
      { replace: true },
    )
  }

  return (
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
      onRenameAsset={renameAsset}
      onDeleteAsset={deleteAsset}
      onRenameAction={renameAction}
      onDeleteAction={deleteAction}
    />
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
        name: assetDisplayName(character.id, outfit.name, outfit.actions[0]?.name),
        outfitName: outfit.name,
        previewUrl: outfit.characterTemplateUrl ?? outfit.actions[0]?.frames[0]?.imageUrl ?? null,
        actionCount: outfit.actions.length,
      })),
  )
}

function assetDisplayName(
  characterId: string,
  outfitName: string,
  firstActionName?: string,
): string {
  const normalizedOutfitName = outfitName.trim()
  const generatedDefault =
    normalizedOutfitName === '默认造型' || /^default(?: outfit)?$/i.test(normalizedOutfitName)
  if (!generatedDefault && normalizedOutfitName) return normalizedOutfitName
  return firstActionName?.trim() || `角色 ${characterId}`
}

function PlaytestPageMessage({ children }: { children: string }) {
  return (
    <main aria-label="Playtest" className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <p className="text-sm font-medium text-slate-700">{children}</p>
    </main>
  )
}
