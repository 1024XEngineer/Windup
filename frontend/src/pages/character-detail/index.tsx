import { useEffect, useMemo, useState } from 'react'
import { DownloadSimple, Graph, GridFour, Lightning, Play, Plus, X } from '@phosphor-icons/react'
import { Link, useOutletContext, useParams } from 'react-router'

import {
  ACTION_DIRECTIONS,
  characterTemplateImages,
  characterApis,
  getDirectionProfile,
  getOutfitPlayback,
  resolveActionDirection,
  type Action,
  type ActionDirection,
  type Character,
  type CharacterTemplate,
  type Frame,
  type Outfit,
  type Project,
} from '@/entities'
import { createCharacterExportModel, ExportButton } from '@/features/export-package'
import { PixelPerfectWorkbench } from '@/features/pixel-perfect'

const ACTION_TYPE_LABELS: Record<string, string> = {
  walk: '行走',
  idle: '待机',
  attack: '攻击',
  custom: '自定义',
}

const ASSET_ACTION_SECONDARY =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-app-line bg-app-surface-raised px-5 text-xs font-semibold text-app-ink-soft transition-colors hover:border-app-line-strong hover:bg-app-surface-muted hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent'

const DIRECTION_LABELS: Record<ActionDirection, string> = {
  east: '东',
  west: '西',
  north: '北',
  south: '南',
  north_east: '东北',
  north_west: '西北',
  south_east: '东南',
  south_west: '西南',
}

function actionTypeLabel(type: string) {
  return ACTION_TYPE_LABELS[type] ?? type
}

function orderedFrames(frames: readonly Frame[]) {
  return [...frames].sort((left, right) => left.index - right.index)
}

function actionDirections(action: Action): readonly ActionDirection[] {
  if (!action.sequences?.length) return getDirectionProfile('single').logicalDirections
  const available = new Set(action.sequences.map((sequence) => sequence.direction))
  return ACTION_DIRECTIONS.filter((direction) => available.has(direction))
}

function actionFrames(action: Action, direction: ActionDirection) {
  if (!action.sequences?.length) {
    const resolution = resolveActionDirection(direction)
    return {
      frames: resolution.sourceDirection === 'east' ? orderedFrames(action.frames) : [],
      mirrorX: resolution.mirrorX,
    }
  }

  const sequence = action.sequences.find((item) => item.direction === direction)
  if (!sequence) return { frames: [], mirrorX: false }
  if (sequence.sourceDirection === null) {
    return { frames: orderedFrames(sequence.frames), mirrorX: false }
  }
  const source = action.sequences.find((item) => item.direction === sequence.sourceDirection)
  return { frames: orderedFrames(source?.frames ?? []), mirrorX: sequence.mirrorX }
}

function resolvedCharacterTemplates(templates: readonly CharacterTemplate[] = []) {
  const byDirection = new Map(templates.map((template) => [template.direction, template]))
  return ACTION_DIRECTIONS.flatMap((direction) => {
    const template = byDirection.get(direction)
    if (!template) return []
    const source =
      template.sourceDirection === null ? template : byDirection.get(template.sourceDirection)
    if (!source?.imageUrl) return []
    return [
      {
        direction,
        imageUrl: source.imageUrl,
        mirrorX: template.mirrorX,
      },
    ]
  })
}

function characterName(character: Character) {
  return character.name ?? '未命名角色'
}

export function CharacterDetailPage() {
  const { projectId, characterId } = useParams()
  const project = useOutletContext<Project>()
  const [character, setCharacter] = useState<Character | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pixelPerfectOpen, setPixelPerfectOpen] = useState(false)

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
    setPixelPerfectOpen(false)
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
  const titlePreviewUrl = selectedOutfit?.previewUrl ?? null
  const canPlaytest = selectedOutfit ? getOutfitPlayback(selectedOutfit).playable : false

  return (
    <section aria-labelledby="character-title" className="p-4 lg:px-6 lg:py-5">
      <header className="relative overflow-hidden border-b border-app-line pb-5">
        <Link
          to={`/projects/${projectId}/assets`}
          className="text-xs text-app-muted transition-colors hover:text-app-accent"
        >
          ← 返回资产库
        </Link>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="relative z-10 min-w-0 shrink-0">
            <h2
              id="character-title"
              className="font-serif text-3xl font-medium tracking-[-0.04em] text-app-ink"
            >
              {name}
            </h2>
            {selectedOutfit && titlePreviewUrl ? (
              <img
                src={titlePreviewUrl}
                alt={`${name}的${selectedOutfit.name}预览`}
                loading="eager"
                decoding="async"
                fetchPriority="high"
                className="pointer-events-none absolute bottom-[-4.5rem] left-[calc(100%+0.5rem)] hidden h-44 w-44 max-w-none object-contain opacity-85 sm:block [image-rendering:pixelated]"
              />
            ) : null}
          </div>
          <div
            role="group"
            aria-label="角色资产操作"
            className="relative z-10 flex flex-wrap items-center gap-2 sm:justify-end"
          >
            {selectedOutfit ? (
              <CharacterExport project={project} character={character} outfit={selectedOutfit} />
            ) : null}
            {selectedOutfit && canPlaytest ? (
              <button
                type="button"
                aria-expanded={pixelPerfectOpen}
                aria-controls="pixel-perfect-workbench"
                onClick={() => setPixelPerfectOpen((current) => !current)}
                className={ASSET_ACTION_SECONDARY}
              >
                <GridFour size={15} weight="bold" aria-hidden="true" />
                完美像素化
              </button>
            ) : null}
            {selectedOutfit && canPlaytest ? (
              <Link
                to={`/playtest/${character.id}/${selectedOutfit.id}`}
                aria-label="在预览台打开当前造型"
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-app-accent bg-app-accent px-5 text-xs font-semibold text-app-on-accent transition-colors hover:border-app-accent-hover hover:bg-app-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              >
                <Play size={15} weight="fill" aria-hidden="true" />
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
          <CharacterTemplateDirections character={character} />
          {pixelPerfectOpen ? (
            <PixelPerfectWorkbench id="pixel-perfect-workbench" actions={selectedOutfit.actions} />
          ) : null}
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
      icon={<DownloadSimple size={15} weight="bold" />}
      pill
      className={ASSET_ACTION_SECONDARY}
    />
  )
}

function CharacterTemplateDirections({ character }: { character: Character }) {
  const name = characterName(character)
  const directionalTemplates = resolvedCharacterTemplates(character.templates)
  if (directionalTemplates.length === 0) return null
  return (
    <section
      aria-label="角色母版方向"
      className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8"
    >
      {directionalTemplates.map((template, index) => (
        <figure
          key={template.direction}
          className="overflow-hidden rounded-xl border border-app-line bg-app-surface-raised"
        >
          <div className="aspect-square bg-app-surface-muted p-2">
            <img
              src={template.imageUrl}
              alt={`${name}${DIRECTION_LABELS[template.direction]}方向母版`}
              loading={index === 0 ? 'eager' : 'lazy'}
              decoding="async"
              fetchPriority={index === 0 ? 'high' : 'auto'}
              className={`h-full w-full object-contain [image-rendering:pixelated] ${template.mirrorX ? '-scale-x-100' : ''}`}
            />
          </div>
          <figcaption className="border-t border-app-line px-2 py-1.5 text-center text-[0.68rem] font-semibold text-app-muted">
            {DIRECTION_LABELS[template.direction]}
          </figcaption>
        </figure>
      ))}
    </section>
  )
}

function ActionList({ character, outfit }: { character: Character; outfit: Outfit }) {
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const [revealedActionId, setRevealedActionId] = useState<string | null>(null)
  const [entryOpen, setEntryOpen] = useState(false)
  const displayedActions = outfit.actions
  const selectedAction = displayedActions.find((action) => action.id === selectedActionId) ?? null
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
    <section aria-label="角色动作" className="mt-3">
      <div className="flex justify-end">
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

      {displayedActions.length === 0 ? (
        <div className="mt-4 rounded-[1.5rem] border border-dashed border-app-line bg-app-surface-raised p-7">
          <h4 className="font-semibold text-app-ink">这个造型还没有动作</h4>
          <p className="mt-2 text-sm leading-6 text-app-muted">生成并保存动作后会显示在这里。</p>
        </div>
      ) : (
        <>
          <div
            aria-label="动作卡组"
            className="mt-2 flex flex-wrap items-start gap-y-3 px-3 pb-5 pt-4"
          >
            {displayedActions.map((action, actionIndex) => {
              const expanded = selectedAction?.id === action.id
              const rendersFramePanel = revealedActionId === action.id
              const previewFrame = actionFrames(action, 'east').frames[0]
              const collapsedActions = selectedAction
                ? displayedActions.filter((item) => item.id !== selectedAction.id)
                : displayedActions
              const stackIndex = expanded
                ? 0
                : collapsedActions.findIndex((item) => item.id === action.id)
              return (
                <article
                  key={action.id}
                  aria-label={`动作 ${action.name}`}
                  className={`group relative shrink-0 overflow-hidden rounded-[1.35rem] border-[1.5px] bg-app-surface-muted transition-[width,transform,margin,border-color] duration-500 ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none ${rendersFramePanel ? 'grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] lg:grid-cols-[13rem_minmax(0,1fr)]' : ''} ${expanded ? 'order-first w-full -translate-y-1 rotate-0 border-app-accent' : `w-44 border-app-line hover:border-app-line-strong lg:w-52 ${selectedAction ? 'order-last' : ''} ${stackIndex > 0 ? '-ml-4 lg:-ml-8' : ''} ${actionIndex % 2 ? 'translate-y-1 rotate-[1.2deg]' : 'rotate-[-1.2deg]'}`}`}
                  style={{ zIndex: expanded ? displayedActions.length + 1 : actionIndex + 1 }}
                >
                  <button
                    type="button"
                    aria-label={`${expanded ? '收起' : '展开'}${action.name}`}
                    aria-expanded={expanded}
                    onClick={() => {
                      if (expanded) {
                        setSelectedActionId(null)
                        return
                      }
                      setRevealedActionId(action.id)
                      setSelectedActionId(action.id)
                    }}
                    className={`relative block w-full overflow-hidden bg-app-surface-muted text-left transition duration-300 ease-[cubic-bezier(.16,1,.3,1)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-app-accent motion-reduce:transition-none ${expanded ? 'min-h-72' : 'aspect-[4/5]'}`}
                  >
                    <div className="absolute inset-0 overflow-hidden bg-app-surface-muted">
                      {previewFrame ? (
                        <img
                          src={previewFrame.imageUrl}
                          alt={`${action.name}帧预览`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-contain p-3 pb-16 [image-rendering:pixelated] transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none group-hover:-translate-y-1 group-hover:scale-[1.035]"
                        />
                      ) : (
                        <span className="grid h-full place-items-center text-xs text-app-muted">
                          暂无帧
                        </span>
                      )}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-4 text-app-ink">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-base font-semibold tracking-[-0.02em]">
                          {action.name}
                        </h4>
                        <span className="text-sm text-app-muted">{expanded ? '−' : '↗'}</span>
                      </div>
                      <p className="mt-1.5 truncate text-[0.68rem] text-app-muted">
                        {actionTypeLabel(action.type)} · {action.fps} FPS · {action.frameCount} 帧 ·{' '}
                        {action.loop ? '循环' : '单次'}
                      </p>
                    </div>
                  </button>
                  {rendersFramePanel ? (
                    <ActionFramePanel action={action} expanded={expanded} />
                  ) : null}
                </article>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

function ActionFramePanel({ action, expanded }: { action: Action; expanded: boolean }) {
  const directions = actionDirections(action)
  const [selectedDirection, setSelectedDirection] = useState<ActionDirection>(
    directions[0] ?? 'east',
  )
  const activeDirection = directions.includes(selectedDirection)
    ? selectedDirection
    : (directions[0] ?? 'east')
  const { frames, mirrorX } = actionFrames(action, activeDirection)

  return (
    <section
      aria-label={`${action.name}完整帧序列`}
      aria-hidden={!expanded}
      className={`min-w-0 overflow-hidden transition-[height,padding,opacity] duration-200 motion-reduce:transition-none ${expanded ? 'h-full border-t border-app-line p-4 opacity-100 sm:border-t-0 sm:border-l' : 'h-0 border-0 p-0 opacity-0 pointer-events-none'}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[0.65rem] font-medium tracking-[0.12em] text-app-faint">帧序列</p>
          <p className="mt-1 text-xs text-app-muted">
            {actionTypeLabel(action.type)} · {action.fps} FPS · {action.loop ? '循环' : '单次'}
          </p>
        </div>
        <span className="text-[0.68rem] tabular-nums text-app-faint">{frames.length} 帧</span>
      </div>
      {directions.length > 1 ? (
        <fieldset aria-label={`${action.name}方向`} className="mt-3 flex flex-wrap gap-1.5">
          <legend className="sr-only">选择动作方向</legend>
          {directions.map((direction) => (
            <label
              key={direction}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-app-accent ${
                activeDirection === direction
                  ? 'border-app-accent bg-app-accent-soft text-app-accent'
                  : 'border-app-line text-app-muted hover:border-app-line-strong hover:text-app-ink'
              }`}
            >
              <input
                type="radio"
                name={`action-direction-${action.id}`}
                value={direction}
                checked={activeDirection === direction}
                onChange={() => setSelectedDirection(direction)}
                className="sr-only"
              />
              {DIRECTION_LABELS[direction]}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="mt-4 max-h-52 overflow-y-auto pr-1 pb-2">
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,7rem))] gap-x-2.5 gap-y-3">
          {frames.map((frame) => (
            <li key={`${action.id}-${activeDirection}-${frame.index}`} className="min-w-0">
              <div className="overflow-hidden rounded-lg border border-app-line bg-app-canvas">
                <img
                  src={frame.imageUrl}
                  alt={`${action.name}${DIRECTION_LABELS[activeDirection]}方向第 ${frame.index + 1} 帧`}
                  loading="lazy"
                  decoding="async"
                  className={`aspect-square w-full object-contain p-1.5 [image-rendering:pixelated] ${mirrorX ? '-scale-x-100' : ''}`}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-1 text-[0.62rem] tabular-nums text-app-faint">
                <span>#{String(frame.index + 1).padStart(2, '0')}</span>
                <span>
                  {frame.durationMs === null ? `按 ${action.fps} FPS` : `${frame.durationMs} ms`}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
