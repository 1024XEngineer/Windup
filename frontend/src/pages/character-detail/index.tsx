import { useEffect, useMemo, useState } from 'react'
import { Graph, Lightning, Plus, X } from '@phosphor-icons/react'
import { Link, useOutletContext, useParams } from 'react-router'

import {
  characterTemplateImages,
  characterApis,
  type Action,
  type Character,
  type Outfit,
  type Project,
} from '@/entities'
import { createCharacterExportModel, ExportButton } from '@/features/export-package'
import { AssetPreviewSurface } from '@/shared/ui'

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
    setError(null)
    void characterApis.get(characterId).then(
      (nextCharacter) => {
        if (!active) return
        if (nextCharacter.projectId !== projectId) {
          setError('这个角色不属于当前项目')
          return
        }
        setCharacter(nextCharacter)
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
  const selectedOutfit = character.outfits[0] ?? null
  const canPlaytest = selectedOutfit?.actions.some((action) => action.frames.length > 0) ?? false

  return (
    <section aria-labelledby="character-title" className="p-4 lg:px-6 lg:py-5">
      <header className="border-b border-app-line pb-5">
        <Link
          to={`/projects/${projectId}/assets`}
          className="text-xs text-app-muted transition-colors hover:text-app-accent"
        >
          ← 返回资产库
        </Link>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.68rem] tracking-[0.12em] text-app-faint">
              {project.name} / 角色资产
            </p>
            <h2
              id="character-title"
              className="mt-1 font-serif text-3xl font-medium tracking-[-0.04em] text-app-ink"
            >
              {name}
            </h2>
          </div>
          <div className="flex flex-wrap items-start gap-2 sm:justify-end">
            {selectedOutfit ? (
              <CharacterExport project={project} character={character} outfit={selectedOutfit} />
            ) : null}
            {selectedOutfit && canPlaytest ? (
              <Link
                to={`/playtest/${character.id}/${selectedOutfit.id}`}
                aria-label="在预览台打开当前造型"
                className="inline-flex min-h-10 items-center rounded-full bg-app-accent px-5 text-xs font-semibold text-app-on-accent transition-colors hover:bg-app-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              >
                在预览台打开
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {character.outfits.length === 0 || !selectedOutfit ? (
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-app-line bg-app-surface-raised p-7">
          <h3 className="font-semibold text-app-ink">这个角色还没有造型</h3>
        </div>
      ) : (
        <>
          <div className="mt-3">
            <OutfitMaster character={character} outfit={selectedOutfit} />
          </div>
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
    <ExportButton
      model={result.model}
      idleLabel="导出资产包"
      pill
      className="inline-flex min-h-10 items-center border-app-line px-5 text-xs font-semibold text-app-ink-soft transition-colors hover:border-app-line-strong hover:text-app-accent"
    />
  )
}

function OutfitMaster({ character, outfit }: { character: Character; outfit: Outfit }) {
  const name = characterName(character)
  return (
    <section aria-labelledby="outfit-master-title" className="flex min-w-0 items-center gap-4 py-2">
      <div className="h-28 w-28 shrink-0 sm:h-32 sm:w-32">
        <AssetPreviewSurface
          previewUrl={outfit.previewUrl}
          previewAlt={`${name}的${outfit.name}预览`}
          priority
          className="h-full"
        />
      </div>
      <div className="min-w-0 flex-1">
        <h3
          id="outfit-master-title"
          className="text-lg font-semibold tracking-[-0.03em] text-app-ink"
        >
          {outfit.name}
        </h3>
        <p className="mt-2 text-[0.7rem] font-medium text-app-muted">
          {outfit.actions.length} 个动作
        </p>
      </div>
    </section>
  )
}

function ActionList({ character, outfit }: { character: Character; outfit: Outfit }) {
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const [entryOpen, setEntryOpen] = useState(false)
  const selectedAction = outfit.actions.find((action) => action.id === selectedActionId) ?? null
  const templateImages = characterTemplateImages(character.templates)
  const canCreateAction = Boolean(
    templateImages.east || outfit.previewUrl || character.referenceImageUrl,
  )
  const quickStartPath = `/quick-start/${encodeURIComponent(character.workflowRunId)}?${new URLSearchParams(
    {
      intent: 'add-action',
      outfitId: outfit.id,
    },
  )}`
  const workflowEditorPath = `/workflow-editor/${encodeURIComponent(character.workflowRunId)}`

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
            disabled={!canCreateAction}
            title={canCreateAction ? '选择动作创建方式' : '当前造型缺少角色母版'}
            onClick={() => setEntryOpen(true)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-app-line px-3 text-xs font-semibold text-app-ink-soft transition-colors hover:border-app-accent hover:text-app-accent disabled:cursor-not-allowed disabled:text-app-faint"
          >
            <Plus size={14} weight="bold" aria-hidden="true" />
            增加动作
          </button>
        </div>
      </div>

      {entryOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-app-ink/20 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEntryOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-entry-title"
            className="w-full max-w-md rounded-lg border border-app-line bg-app-surface-raised p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 id="action-entry-title" className="text-lg font-semibold text-app-ink">
                  选择动作创建方式
                </h4>
                <p className="mt-1 text-xs leading-5 text-app-muted">
                  两种方式都会进入“{outfit.name}”已有的工作流，不会创建重复流程。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭动作创建方式"
                onClick={() => setEntryOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-app-muted hover:bg-app-surface-muted hover:text-app-ink"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link
                to={quickStartPath}
                aria-label="使用 Quick Start"
                className="flex min-h-28 flex-col justify-between rounded-lg border border-app-line p-4 text-left transition-colors hover:border-app-accent hover:bg-app-accent-muted"
              >
                <Lightning size={20} weight="fill" className="text-app-accent" aria-hidden="true" />
                <span>
                  <b className="block text-sm text-app-ink">Quick Start</b>
                  <small className="mt-1 block text-xs leading-5 text-app-muted">
                    描述动作后自动生成
                  </small>
                </span>
              </Link>
              <Link
                to={workflowEditorPath}
                aria-label="使用 Workflow Editor"
                className="flex min-h-28 flex-col justify-between rounded-lg border border-app-line p-4 text-left transition-colors hover:border-app-accent hover:bg-app-accent-muted"
              >
                <Graph size={20} className="text-app-accent" aria-hidden="true" />
                <span>
                  <b className="block text-sm text-app-ink">Workflow Editor</b>
                  <small className="mt-1 block text-xs leading-5 text-app-muted">
                    手动控制每个生成节点
                  </small>
                </span>
              </Link>
            </div>
          </section>
        </div>
      ) : null}

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
              className="action-reveal grid gap-5 border-t border-app-line py-5 lg:grid-cols-[10rem_minmax(0,1fr)]"
            >
              <div>
                <p className="text-[0.68rem] font-medium tracking-[0.12em] text-app-faint">
                  当前动作
                </p>
                <h4 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-app-ink">
                  {selectedAction.name}
                </h4>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-app-faint">类型</dt>
                  <dd className="text-app-ink-soft">{actionTypeLabel(selectedAction.type)}</dd>
                  <dt className="text-app-faint">帧率</dt>
                  <dd className="tabular-nums text-app-ink-soft">{selectedAction.fps} FPS</dd>
                  <dt className="text-app-faint">帧数</dt>
                  <dd className="tabular-nums text-app-ink-soft">{selectedAction.frameCount}</dd>
                  <dt className="text-app-faint">播放</dt>
                  <dd className="text-app-ink-soft">{selectedAction.loop ? '循环' : '单次'}</dd>
                </dl>
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-4">
                  <h5 className="text-sm font-semibold text-app-ink">帧序列</h5>
                  <span className="text-[0.68rem] tabular-nums text-app-faint">
                    {selectedAction.frameCount} 帧
                  </span>
                </div>
                <div className="mt-3 overflow-x-auto pb-2">
                  <ol className="flex min-w-max gap-3">
                    {orderedFrames(selectedAction).map((frame) => (
                      <li key={`${selectedAction.id}-${frame.index}`} className="w-24 shrink-0">
                        <div className="overflow-hidden rounded-lg border border-app-line bg-app-surface-muted">
                          <img
                            src={frame.imageUrl}
                            alt={`${selectedAction.name}第 ${frame.index + 1} 帧`}
                            loading="lazy"
                            decoding="async"
                            className="aspect-square w-full object-contain p-1.5 [image-rendering:pixelated]"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-1 text-[0.65rem] tabular-nums text-app-faint">
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
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  )
}
