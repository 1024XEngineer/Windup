import { type DragEvent, type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router'

import type { Action, Character, CharacterApis, Outfit } from '@/entities/character'
import type { Project, ProjectApis } from '@/entities/project'
import { buildPlaytestPath } from '@/features/publish'

export interface PlaytestCatalogApis {
  projects: Pick<ProjectApis, 'list' | 'remove'>
  characters: Pick<CharacterApis, 'listByProject' | 'update' | 'remove'>
}

interface CatalogAsset {
  project: Project
  character: Character
  outfit: Outfit
}

interface CatalogState {
  projects: Project[]
  assets: CatalogAsset[]
  error: string | null
  loading: boolean
}

interface CatalogData {
  projects: Project[]
  assets: CatalogAsset[]
}

const INITIAL_STATE: CatalogState = { projects: [], assets: [], error: null, loading: true }

/** Playtest 入口按项目组织可核验角色，移动和改名通过 Character 整树接口持久化。 */
export function PlaytestCatalogPage({ apis }: { apis: PlaytestCatalogApis }) {
  const [state, setState] = useState<CatalogState>(INITIAL_STATE)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [busyCharacterIds, setBusyCharacterIds] = useState<Set<string>>(new Set())
  const [busyProjectIds, setBusyProjectIds] = useState<Set<string>>(new Set())
  const [draggedCharacterId, setDraggedCharacterId] = useState<string | null>(null)
  const [dropProjectId, setDropProjectId] = useState<string | null>(null)
  const [operationMessage, setOperationMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setState(INITIAL_STATE)

    void loadCatalog(apis).then(
      ({ projects, assets }) => {
        if (!active) return
        setState({ projects, assets, error: null, loading: false })
        setSelectedProjectId((current) =>
          current && projects.some((project) => project.id === current)
            ? current
            : (projects[0]?.id ?? null),
        )
      },
      (cause: unknown) =>
        active &&
        setState({
          projects: [],
          assets: [],
          error: errorMessage(cause, '资产加载失败'),
          loading: false,
        }),
    )

    return () => {
      active = false
    }
  }, [apis, reloadKey])

  const setCharacterBusy = (characterId: string, busy: boolean) => {
    setBusyCharacterIds((current) => {
      const next = new Set(current)
      if (busy) next.add(characterId)
      else next.delete(characterId)
      return next
    })
  }

  const persistCharacter = async (character: Character, successMessage: string) => {
    setCharacterBusy(character.id, true)
    setOperationMessage(null)
    try {
      const saved = await apis.characters.update(character)
      if (saved.projectId !== character.projectId) {
        throw new Error('后端未保存新的项目归属')
      }
      setState((current) => replaceCharacter(current, saved))
      setOperationMessage(successMessage)
    } catch (cause) {
      setOperationMessage(errorMessage(cause, '保存失败，请重试'))
      throw cause
    } finally {
      setCharacterBusy(character.id, false)
    }
  }

  const moveCharacter = async (characterId: string, projectId: string) => {
    const source = state.assets.find((asset) => asset.character.id === characterId)
    const target = state.projects.find((project) => project.id === projectId)
    if (!source || !target || source.character.projectId === projectId) return

    try {
      await persistCharacter(
        { ...source.character, projectId },
        `已将角色资产移动到“${target.name}”`,
      )
      setSelectedProjectId(projectId)
    } catch {
      // persistCharacter 已在页面上保留具体错误。
    }
  }

  const renameOutfit = async (character: Character, outfitId: string, name: string) => {
    await persistCharacter(
      {
        ...character,
        outfits: character.outfits.map((outfit) =>
          outfit.id === outfitId ? { ...outfit, name } : outfit,
        ),
      },
      `资产已改名为“${name}”`,
    )
  }

  const renameAction = async (
    character: Character,
    outfitId: string,
    actionId: string,
    name: string,
  ) => {
    await persistCharacter(
      {
        ...character,
        outfits: character.outfits.map((outfit) =>
          outfit.id === outfitId
            ? {
                ...outfit,
                actions: outfit.actions.map((action) =>
                  action.id === actionId ? { ...action, name } : action,
                ),
              }
            : outfit,
        ),
      },
      `动作已改名为“${name}”`,
    )
  }

  const deleteAsset = async (character: Character, outfit: Outfit) => {
    if (!window.confirm(`确定删除资产“${outfit.name}”吗？此操作无法撤销。`)) return

    setCharacterBusy(character.id, true)
    setOperationMessage(null)
    try {
      if (character.outfits.length === 1) {
        await apis.characters.remove(character.id)
        setState((current) => ({
          ...current,
          assets: current.assets.filter((asset) => asset.character.id !== character.id),
        }))
      } else {
        const saved = await apis.characters.update({
          ...character,
          outfits: character.outfits.filter((candidate) => candidate.id !== outfit.id),
        })
        setState((current) => replaceCharacter(current, saved))
      }
      setOperationMessage(`已删除资产“${outfit.name}”`)
    } catch (cause) {
      setOperationMessage(errorMessage(cause, '资产删除失败，请重试'))
    } finally {
      setCharacterBusy(character.id, false)
    }
  }

  const deleteProject = async (project: Project) => {
    if (!window.confirm(`确定删除项目“${project.name}”及其中全部角色资产吗？此操作无法撤销。`)) {
      return
    }

    setBusyProjectIds((current) => new Set(current).add(project.id))
    setOperationMessage(null)
    try {
      await apis.projects.remove(project.id)
      setState((current) => ({
        ...current,
        projects: current.projects.filter((candidate) => candidate.id !== project.id),
        assets: current.assets.filter((asset) => asset.project.id !== project.id),
      }))
      setSelectedProjectId((current) =>
        current === project.id
          ? (state.projects.find((candidate) => candidate.id !== project.id)?.id ?? null)
          : current,
      )
      setOperationMessage(`已删除项目“${project.name}”`)
    } catch (cause) {
      setOperationMessage(errorMessage(cause, '项目删除失败，请重试'))
    } finally {
      setBusyProjectIds((current) => {
        const next = new Set(current)
        next.delete(project.id)
        return next
      })
    }
  }

  const selectedProject = state.projects.find((project) => project.id === selectedProjectId) ?? null
  const selectedAssets = selectedProject
    ? state.assets.filter((asset) => asset.project.id === selectedProject.id)
    : []

  return (
    <section className="mx-auto w-full max-w-6xl py-8 text-[#1d251f]">
      <Link
        to="/projects"
        className="mb-4 inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#b9c1ba] px-3 text-xs font-semibold text-[#4f5b52] hover:border-[#758078] hover:text-[#26372c]"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ‹
        </span>
        返回项目
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d5dad5] pb-5">
        <div>
          <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[#747973]">
            PLAYTEST
          </p>
          <h1 className="mt-2 font-serif text-3xl">Playtest</h1>
          <p className="mt-2 text-sm text-[#687069]">选择项目和角色动作进行核验。</p>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
          disabled={state.loading}
          className="min-h-10 rounded-lg border border-[#aeb8b0] px-4 text-xs font-semibold text-[#35583f] disabled:opacity-50"
        >
          {state.loading ? '正在同步' : '刷新资产'}
        </button>
      </header>

      {state.error ? <CatalogAlert tone="error">{state.error}</CatalogAlert> : null}
      {operationMessage ? <CatalogAlert tone="status">{operationMessage}</CatalogAlert> : null}

      {!state.error && !state.loading && state.projects.length === 0 ? (
        <div className="mt-8 border border-dashed border-[#c9d0ca] px-6 py-12 text-center">
          <p className="text-sm text-[#687069]">还没有项目。</p>
          <Link
            to="/quick-start"
            className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-[#35583f] px-4 text-sm font-semibold text-white"
          >
            创建角色动作
          </Link>
        </div>
      ) : null}

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside
          aria-label="项目文件夹"
          className="max-h-72 overflow-y-auto border border-[#ced5cf] bg-white lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]"
        >
          <div className="border-b border-[#dde2de] px-4 py-3">
            <h2 className="text-xs font-semibold">项目文件夹</h2>
            <p className="mt-1 text-[10px] text-[#747973]">{state.projects.length} 个项目</p>
          </div>
          <div className="grid gap-px bg-[#e2e6e2]">
            {state.projects.map((project) => {
              const assetCount = state.assets.filter(
                (asset) => asset.project.id === project.id,
              ).length
              const selected = selectedProjectId === project.id
              const projectBusy = busyProjectIds.has(project.id)
              const dropActive = dropProjectId === project.id && draggedCharacterId !== null

              return (
                <section
                  key={project.id}
                  aria-label={`${project.name}项目文件夹`}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setDropProjectId(project.id)
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    const characterId =
                      event.dataTransfer.getData('application/x-windup-character') ||
                      draggedCharacterId
                    setDropProjectId(null)
                    setDraggedCharacterId(null)
                    if (characterId) void moveCharacter(characterId, project.id)
                  }}
                  className={`grid grid-cols-[minmax(0,1fr)_36px] items-center bg-white p-1 transition-colors ${
                    dropActive ? 'bg-[#e1eee4]' : ''
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={projectBusy}
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`grid min-h-14 min-w-0 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 px-2 text-left disabled:opacity-50 ${
                      selected ? 'bg-[#edf3ee] text-[#294c33]' : 'hover:bg-[#f4f6f4]'
                    }`}
                  >
                    <span aria-hidden="true" className="text-sm text-[#526258]">
                      {selected ? '▾' : '▸'}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-xs">{project.name}</strong>
                      <small className="mt-0.5 block text-[9px] text-[#747973]">
                        {project.spriteSize.width} × {project.spriteSize.height}
                      </small>
                    </span>
                    <span className="rounded-md bg-[#e8ece8] px-1.5 py-1 text-[9px] font-semibold text-[#59635b]">
                      {assetCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`删除项目文件夹 ${project.name}`}
                    title="删除项目文件夹"
                    disabled={projectBusy}
                    onClick={() => void deleteProject(project)}
                    className="grid h-9 w-9 place-items-center rounded-md text-[10px] font-semibold text-[#973d34] hover:bg-[#faeeec] disabled:opacity-40"
                  >
                    删除
                  </button>
                </section>
              )
            })}
          </div>
        </aside>

        <section aria-label="当前项目资产" className="min-w-0 border border-[#ced5cf] bg-[#f7f8f7]">
          {selectedProject ? (
            <>
              <header className="border-b border-[#dde2de] bg-white px-5 py-4">
                <p className="text-[10px] font-semibold text-[#747973]">当前文件夹</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <h2 className="min-w-0 truncate text-lg font-semibold">{selectedProject.name}</h2>
                  <span className="shrink-0 text-[10px] text-[#747973]">
                    {selectedAssets.length} 项资产
                  </span>
                </div>
              </header>
              <div className="grid gap-4 p-4 xl:grid-cols-2">
                {selectedAssets.length === 0 ? (
                  <p className="col-span-full py-16 text-center text-xs text-[#858c86]">空文件夹</p>
                ) : (
                  selectedAssets.map((asset) => (
                    <AssetCard
                      key={`${asset.character.id}:${asset.outfit.id}`}
                      asset={asset}
                      busy={busyCharacterIds.has(asset.character.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(
                          'application/x-windup-character',
                          asset.character.id,
                        )
                        setDraggedCharacterId(asset.character.id)
                      }}
                      onDragEnd={() => {
                        setDraggedCharacterId(null)
                        setDropProjectId(null)
                      }}
                      onRenameOutfit={(name) =>
                        renameOutfit(asset.character, asset.outfit.id, name)
                      }
                      onRenameAction={(actionId, name) =>
                        renameAction(asset.character, asset.outfit.id, actionId, name)
                      }
                      onDelete={() => deleteAsset(asset.character, asset.outfit)}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="py-16 text-center text-xs text-[#858c86]">请选择项目文件夹</p>
          )}
        </section>
      </div>
    </section>
  )
}

function AssetCard({
  asset,
  busy,
  onDragStart,
  onDragEnd,
  onRenameOutfit,
  onRenameAction,
  onDelete,
}: {
  asset: CatalogAsset
  busy: boolean
  onDragStart(event: DragEvent<HTMLElement>): void
  onDragEnd(): void
  onRenameOutfit(name: string): Promise<void>
  onRenameAction(actionId: string, name: string): Promise<void>
  onDelete(): Promise<void>
}) {
  const { character, outfit } = asset

  return (
    <article
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`grid min-h-[240px] grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#d1d7d2] bg-white ${
        busy ? 'opacity-60' : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      <div className="grid min-h-full place-items-center bg-[#edf0ec] p-2">
        {outfit.characterTemplateUrl ? (
          <img
            src={outfit.characterTemplateUrl}
            alt={`${outfit.name} 角色图`}
            className="aspect-square w-full object-contain [image-rendering:pixelated]"
          />
        ) : (
          <span className="text-xs text-[#8b918c]">暂无角色图</span>
        )}
      </div>
      <div className="min-w-0 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[10px] font-semibold text-[#747973]">角色 {character.id}</p>
          <button
            type="button"
            aria-label={`删除资产 ${outfit.name}`}
            title="删除资产"
            disabled={busy}
            draggable={false}
            onClick={() => void onDelete()}
            className="min-h-8 rounded-md px-2 text-[10px] font-semibold text-[#973d34] hover:bg-[#faeeec] disabled:opacity-40"
          >
            删除
          </button>
        </div>
        <EditableName
          value={outfit.name}
          label="资产名称"
          disabled={busy}
          onSave={onRenameOutfit}
          className="mt-1"
        >
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{outfit.name}</h2>
        </EditableName>
        <p className="mt-1 text-[11px] text-[#747973]">{outfit.actions.length} 个动作</p>
        <div className="mt-4 grid gap-2">
          {outfit.actions.map((action) => (
            <ActionRow
              key={action.id}
              character={character}
              outfit={outfit}
              action={action}
              disabled={busy}
              onRename={(name) => onRenameAction(action.id, name)}
            />
          ))}
        </div>
      </div>
    </article>
  )
}

function ActionRow({
  character,
  outfit,
  action,
  disabled,
  onRename,
}: {
  character: Character
  outfit: Outfit
  action: Action
  disabled: boolean
  onRename(name: string): Promise<void>
}) {
  return (
    <EditableName value={action.name} label="动作名称" disabled={disabled} onSave={onRename}>
      <Link
        aria-label={`载入${action.name}`}
        to={buildPlaytestPath({
          characterId: character.id,
          outfitId: outfit.id,
          actionId: action.id,
        })}
        draggable={false}
        className="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-[#cbd3cc] px-3 text-xs font-semibold text-[#35583f] hover:border-[#78917e] hover:bg-[#eef4ef]"
      >
        <span className="truncate">{action.name}</span>
        <span className="shrink-0 font-mono text-[9px] text-[#747973]">
          {action.frames.length} 帧
        </span>
      </Link>
    </EditableName>
  )
}

function EditableName({
  value,
  label,
  disabled,
  onSave,
  className = '',
  children,
}: {
  value: string
  label: string
  disabled: boolean
  onSave(value: string): Promise<void>
  className?: string
  children: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setDraft(value), [value])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const name = draft.trim()
    if (!name) {
      setError('名称不能为空')
      return
    }
    if (name === value) {
      setEditing(false)
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave(name)
      setEditing(false)
    } catch (cause) {
      setError(errorMessage(cause, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={(event) => void submit(event)}
        onDragStart={(event) => event.stopPropagation()}
        className={`grid min-w-0 grid-cols-[minmax(0,1fr)_32px_32px] gap-1 ${className}`}
      >
        <input
          aria-label={label}
          autoFocus
          value={draft}
          maxLength={80}
          onChange={(event) => setDraft(event.target.value)}
          disabled={saving}
          className="h-8 min-w-0 rounded-md border border-[#829087] px-2 text-xs outline-none focus:border-[#35583f]"
        />
        <button
          type="submit"
          aria-label={`保存${label}`}
          title="保存"
          disabled={saving}
          className="h-8 rounded-md bg-[#35583f] text-sm text-white disabled:opacity-50"
        >
          ✓
        </button>
        <button
          type="button"
          aria-label={`取消修改${label}`}
          title="取消"
          disabled={saving}
          onClick={() => {
            setDraft(value)
            setError(null)
            setEditing(false)
          }}
          className="h-8 rounded-md border border-[#c5ccc6] text-sm text-[#687069]"
        >
          ×
        </button>
        {error ? <small className="col-span-full text-[10px] text-[#983c32]">{error}</small> : null}
      </form>
    )
  }

  return (
    <div className={`flex min-w-0 items-center gap-1 ${className}`}>
      {children}
      <button
        type="button"
        aria-label={`重命名${label} ${value}`}
        title={`重命名${label}`}
        disabled={disabled}
        draggable={false}
        onClick={() => setEditing(true)}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-sm text-[#687069] hover:bg-[#edf1ed] hover:text-[#35583f] disabled:opacity-40"
      >
        ✎
      </button>
    </div>
  )
}

function CatalogAlert({ children, tone }: { children: string; tone: 'error' | 'status' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mt-4 border-l-4 px-4 py-3 ${
        tone === 'error'
          ? 'border-[#a54438] bg-[#f8ece9] text-[#7d3028]'
          : 'border-[#4f7759] bg-[#edf5ef] text-[#35583f]'
      }`}
    >
      <p className="text-sm">{children}</p>
    </div>
  )
}

function replaceCharacter(state: CatalogState, character: Character): CatalogState {
  const project = state.projects.find((candidate) => candidate.id === character.projectId)
  if (!project) return state

  const otherAssets = state.assets.filter((asset) => asset.character.id !== character.id)
  const updatedAssets = character.outfits
    .filter((outfit) => outfit.actions.length > 0)
    .map((outfit) => ({ project, character, outfit }))

  return { ...state, assets: [...otherAssets, ...updatedAssets] }
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback
}

async function loadCatalog(apis: PlaytestCatalogApis): Promise<CatalogData> {
  const page = await apis.projects.list({ page: 1, pageSize: 100 })
  const charactersByProject = await Promise.all(
    page.items.map(async (project) => ({
      project,
      characters: await apis.characters.listByProject(project.id),
    })),
  )

  return {
    projects: page.items,
    assets: charactersByProject.flatMap(({ project, characters }) =>
      characters.flatMap((character) =>
        character.outfits
          .filter((outfit) => outfit.actions.length > 0)
          .map((outfit) => ({ project, character, outfit })),
      ),
    ),
  }
}
