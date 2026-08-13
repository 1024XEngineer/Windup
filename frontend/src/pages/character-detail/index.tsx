import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'

import { characterApis, type Action, type Character, type Outfit, type Project } from '@/entities'
import { createCharacterExportModel, ExportPanel } from '@/features/export-package'

const ACTION_TYPE_LABELS: Record<string, string> = {
  walk: '行走',
  idle: '待机',
  attack: '攻击',
  custom: '自定义',
}

function actionTypeLabel(type: string) {
  return ACTION_TYPE_LABELS[type] ?? type
}

function orderedFrames(action: Action) {
  return [...action.frames].sort((left, right) => left.index - right.index)
}

function characterName(character: Character) {
  return character.name ?? '未命名角色'
}

export function CharacterDetailPage() {
  const { projectId, characterId } = useParams()
  const project = useOutletContext<Project>()
  const [character, setCharacter] = useState<Character | null>(null)
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!projectId || !characterId) {
      setError('缺少角色定位信息')
      return () => {
        active = false
      }
    }

    setCharacter(null)
    setSelectedOutfitId(null)
    setError(null)
    void characterApis.get(characterId).then(
      (nextCharacter) => {
        if (!active) return
        if (nextCharacter.projectId !== projectId) {
          setError('这个角色不属于当前项目')
          return
        }
        setCharacter(nextCharacter)
        setSelectedOutfitId(nextCharacter.outfits[0]?.id ?? null)
      },
      () => {
        if (active) setError('这个角色不存在或暂时无法读取')
      },
    )

    return () => {
      active = false
    }
  }, [characterId, projectId])

  if (error) {
    return (
      <p
        role="alert"
        className="m-6 rounded-xl border border-app-danger-line bg-app-danger-soft p-5 text-sm text-app-danger"
      >
        {error}
      </p>
    )
  }
  if (!character) return <p className="p-6 text-sm text-app-muted">正在读取角色资产…</p>

  const name = characterName(character)
  const selectedOutfit =
    character.outfits.find((outfit) => outfit.id === selectedOutfitId) ??
    character.outfits[0] ??
    null
  const canPlaytest = selectedOutfit?.actions.some((action) => action.frames.length > 0) ?? false

  return (
    <section aria-labelledby="character-title" className="p-4 lg:px-6 lg:py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            to={`/projects/${projectId}/assets`}
            className="text-xs font-semibold text-app-muted underline decoration-app-line underline-offset-4 hover:text-app-accent"
          >
            返回资产库
          </Link>
          <h2
            id="character-title"
            className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-app-ink"
          >
            {name}
          </h2>
          <p className="mt-1 text-xs text-app-muted">选择动作卡片查看完整帧序列。</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {selectedOutfit ? (
            <label className="flex items-center gap-2 text-xs font-medium text-app-muted">
              <span>造型</span>
              <select
                aria-label="选择造型"
                value={selectedOutfit.id}
                onChange={(event) => setSelectedOutfitId(event.target.value)}
                className="rounded-full border border-app-line bg-app-surface-raised px-3 py-2 text-sm font-semibold text-app-ink-soft outline-none focus:border-app-accent"
              >
                {character.outfits.map((outfit) => (
                  <option key={outfit.id} value={outfit.id}>
                    {outfit.name} · {outfit.actions.length} 动作
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {selectedOutfit && canPlaytest ? (
              <Link
                to={`/playtest/${character.id}/${selectedOutfit.id}`}
                aria-label="在预览台打开当前造型"
                className="inline-flex min-h-9 items-center rounded-full bg-app-accent px-4 text-xs font-semibold text-app-on-accent transition-colors hover:bg-app-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              >
                在预览台打开
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {character.outfits.length === 0 || !selectedOutfit ? (
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-app-line bg-app-surface-raised p-7">
          <h3 className="font-semibold text-app-ink">这个角色还没有造型</h3>
        </div>
      ) : (
        <>
          <div className="mt-3">
            <OutfitMaster character={character} outfit={selectedOutfit} />
          </div>
          <CharacterExport project={project} character={character} outfit={selectedOutfit} />
          <ActionList key={selectedOutfit.id} character={character} outfit={selectedOutfit} />
        </>
      )}
    </section>
  )
}

function CharacterExport({
  project,
  character,
  outfit,
}: {
  project: Project
  character: Character
  outfit: Outfit
}) {
  const result = useMemo(() => {
    try {
      return {
        model: createCharacterExportModel({ project, character, outfitId: outfit.id }),
        error: null,
      }
    } catch (error) {
      return {
        model: null,
        error: error instanceof Error ? error.message : '资产数据无效',
      }
    }
  }, [character, outfit.id, project])

  if (result.error !== null) {
    return (
      <p role="alert" className="mt-3 text-xs font-medium text-app-danger">
        导出不可用：{result.error}
      </p>
    )
  }
  if (result.model === null || result.model.actions.length === 0) return null
  return (
    <div className="mt-4 max-w-sm">
      <ExportPanel model={result.model} />
    </div>
  )
}

function OutfitMaster({ character, outfit }: { character: Character; outfit: Outfit }) {
  const name = characterName(character)
  return (
    <section aria-labelledby="outfit-master-title" className="flex min-w-0 items-center gap-4 py-2">
      <div className="h-28 w-28 shrink-0 sm:h-32 sm:w-32">
        {outfit.previewUrl ? (
          <img
            src={outfit.previewUrl}
            alt={`${name}的${outfit.name}预览`}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="h-full w-full object-contain [image-rendering:pixelated]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,var(--color-app-surface-muted)_25%,var(--color-app-surface)_25%,var(--color-app-surface)_50%,var(--color-app-surface-muted)_50%,var(--color-app-surface-muted)_75%,var(--color-app-surface)_75%)] bg-[length:28px_28px]">
            <span className="rounded-full border border-app-line bg-app-surface-raised/90 px-3 py-1 text-xs font-semibold text-app-muted">
              暂无造型预览
            </span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3
          id="outfit-master-title"
          className="text-lg font-semibold tracking-[-0.03em] text-app-ink"
        >
          {outfit.name}
        </h3>
        {outfit.description ? (
          <p className="mt-1 text-xs leading-5 text-app-muted">{outfit.description}</p>
        ) : null}
        <p className="mt-2 text-[0.7rem] font-medium text-app-muted">
          {outfit.actions.length} 个动作
        </p>
      </div>
    </section>
  )
}

function ActionList({ character, outfit }: { character: Character; outfit: Outfit }) {
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const selectedAction = outfit.actions.find((action) => action.id === selectedActionId) ?? null

  return (
    <section aria-labelledby="action-list-title" className="mt-3">
      <div className="flex items-end justify-between gap-4">
        <h3 id="action-list-title" className="text-lg font-semibold text-app-ink">
          动作与帧
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[0.7rem] text-app-faint">点击卡片展开完整帧</span>
          <button
            type="button"
            aria-label="增加动作"
            disabled
            title="动作生成应进入 Workflow Editor"
            className="cursor-not-allowed rounded-full border border-app-line px-3 py-1.5 text-xs font-semibold text-app-faint"
          >
            ＋ 增加动作
          </button>
        </div>
      </div>

      {outfit.actions.length === 0 ? (
        <div className="mt-4 rounded-[1.5rem] border border-dashed border-app-line bg-app-surface-raised p-7">
          <h4 className="font-semibold text-app-ink">这个造型还没有动作</h4>
          <p className="mt-2 text-sm leading-6 text-app-muted">生成并保存动作后会显示在这里。</p>
        </div>
      ) : (
        <>
          <div
            aria-label="动作卡组"
            className="mt-2 flex min-h-44 items-start overflow-x-auto px-2 pb-4 pt-3"
          >
            {outfit.actions.map((action, index) => {
              const expanded = selectedAction?.id === action.id
              const previewFrame = orderedFrames(action)[0]
              return (
                <article
                  key={action.id}
                  aria-label={`动作 ${action.name}`}
                  className={`group relative w-44 shrink-0 transition-[transform,margin] duration-500 ease-[cubic-bezier(.2,.9,.25,1)] ${index ? '-ml-9' : ''} ${expanded ? '-translate-y-1 rotate-0' : index % 2 ? 'translate-y-1 rotate-[2deg]' : 'rotate-[-2deg]'}`}
                  style={{ zIndex: expanded ? outfit.actions.length + 1 : index + 1 }}
                >
                  <button
                    type="button"
                    aria-label={`${expanded ? '收起' : '展开'}${action.name}`}
                    aria-expanded={expanded}
                    onClick={() => setSelectedActionId(expanded ? null : action.id)}
                    className={`block w-full overflow-hidden rounded-[1.4rem] border bg-app-surface-raised text-left transition duration-500 group-hover:-translate-y-2 ${expanded ? 'border-app-accent ring-4 ring-app-accent-soft' : 'border-app-line'}`}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-app-surface-muted">
                      {previewFrame ? (
                        <img
                          src={previewFrame.imageUrl}
                          alt={`${action.name}帧预览`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-contain p-2 [image-rendering:pixelated]"
                        />
                      ) : (
                        <span className="grid h-full place-items-center text-xs text-app-muted">
                          暂无帧
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-semibold text-app-ink">{action.name}</h4>
                        <span className="text-sm text-app-muted">{expanded ? '−' : '↗'}</span>
                      </div>
                      <p className="mt-1 text-xs text-app-faint">
                        {actionTypeLabel(action.type)} · {action.fps} FPS · {action.frameCount} 帧 ·{' '}
                        {action.loop ? '循环' : '单次'}
                      </p>
                    </div>
                  </button>
                </article>
              )
            })}
          </div>

          {selectedAction ? (
            <section
              aria-label={`${selectedAction.name}完整帧序列`}
              className="action-reveal overflow-hidden rounded-[1.35rem] border border-app-line bg-app-surface-raised p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-lg font-semibold text-app-ink">{selectedAction.name}</h4>
                    <span className="rounded-full bg-app-surface-muted px-2.5 py-1 text-[0.68rem] font-semibold text-app-ink-soft">
                      {actionTypeLabel(selectedAction.type)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-app-faint">
                    {selectedAction.fps} FPS · {selectedAction.frameCount} 帧 ·{' '}
                    {selectedAction.loop ? '循环播放' : '单次播放'}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    aria-label={`重新生成${selectedAction.name}`}
                    disabled
                    title="需要原 WorkflowRun 的步骤上下文"
                    className="cursor-not-allowed rounded-full border border-app-line px-3 py-1.5 text-xs font-semibold text-app-faint"
                  >
                    重新生成
                  </button>
                  <button
                    type="button"
                    disabled
                    aria-label="保存为动作模板"
                    title="动作模板后端未提供"
                    className="cursor-not-allowed rounded-full border border-app-line px-3 py-1.5 text-xs font-semibold text-app-faint"
                  >
                    保存为动作模板
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[0.65rem] text-app-faint">动作模板后端未提供</p>
              <p className="mt-2 text-[0.68rem] font-medium text-app-muted">
                {characterName(character)} / {outfit.name} / {selectedAction.name}
              </p>
              <div className="mt-3 overflow-x-auto pb-1">
                <ol className="flex min-w-max gap-2.5">
                  {orderedFrames(selectedAction).map((frame) => (
                    <li key={`${selectedAction.id}-${frame.index}`} className="w-20 shrink-0">
                      <div className="overflow-hidden rounded-xl border border-app-line">
                        <img
                          src={frame.imageUrl}
                          alt={`${selectedAction.name}第 ${frame.index + 1} 帧`}
                          loading="lazy"
                          decoding="async"
                          className="aspect-square w-full object-contain p-1 [image-rendering:pixelated]"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-1 text-[0.65rem] text-app-faint">
                        <span>#{String(frame.index + 1).padStart(2, '0')}</span>
                        <span>
                          {frame.durationMs === null
                            ? `按 ${selectedAction.fps} FPS`
                            : `${frame.durationMs} ms`}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  )
}
