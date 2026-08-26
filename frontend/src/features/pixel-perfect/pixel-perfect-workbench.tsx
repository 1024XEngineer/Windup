import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DownloadSimple, GridFour, Stack } from '@phosphor-icons/react'

import type { Action } from '@/entities'
import { pixelPerfectApis } from '@/entities/pixel-perfect'

export interface PixelPerfectWorkbenchProps {
  actions: Action[]
  id?: string
}

type ScopeMode = 'single' | 'all'
type FrameStatus = 'working' | 'success' | 'failure'

interface FrameTarget {
  key: string
  actionId: string
  actionName: string
  frameIndex: number
  imageUrl: string
}

interface ActionGroup {
  id: string
  name: string
  fps: number
  frames: FrameTarget[]
}

interface FrameResult {
  filename: string
  previewUrl: string
}

type BatchState =
  | { status: 'idle' }
  | { status: 'working'; completed: number; total: number }
  | { status: 'complete'; failed: number; total: number }

function toActionGroups(actions: Action[]): ActionGroup[] {
  return actions
    .map((action) => ({
      id: action.id,
      name: action.name,
      fps: action.fps,
      frames: [...action.frames]
        .sort((left, right) => left.index - right.index)
        .map((frame) => ({
          key: `${action.id}:${frame.index}`,
          actionId: action.id,
          actionName: action.name,
          frameIndex: frame.index,
          imageUrl: frame.imageUrl,
        })),
    }))
    .filter((action) => action.frames.length > 0)
}

export function PixelPerfectWorkbench({ actions, id }: PixelPerfectWorkbenchProps) {
  const requestSequenceRef = useRef(0)
  const resultUrlsRef = useRef(new Map<string, string>())
  const groups = useMemo(() => toActionGroups(actions), [actions])
  const allFrames = useMemo(() => groups.flatMap((action) => action.frames), [groups])
  const [scope, setScope] = useState<ScopeMode>('single')
  const [selectedActionId, setSelectedActionId] = useState(groups[0]?.id ?? '')
  const [selectedFrameKey, setSelectedFrameKey] = useState(groups[0]?.frames[0]?.key ?? '')
  const [results, setResults] = useState<Record<string, FrameResult>>({})
  const [frameStatuses, setFrameStatuses] = useState<Record<string, FrameStatus>>({})
  const [frameErrors, setFrameErrors] = useState<Record<string, string>>({})
  const [batchState, setBatchState] = useState<BatchState>({ status: 'idle' })

  const selectedAction =
    groups.find((action) => action.id === selectedActionId) ?? groups[0] ?? null
  const selectedFrame =
    selectedAction?.frames.find((frame) => frame.key === selectedFrameKey) ??
    selectedAction?.frames[0] ??
    null
  const working = batchState.status === 'working'

  useEffect(() => {
    if (groups.some((action) => action.id === selectedActionId)) return
    const firstAction = groups[0]
    setSelectedActionId(firstAction?.id ?? '')
    setSelectedFrameKey(firstAction?.frames[0]?.key ?? '')
  }, [groups, selectedActionId])

  useEffect(
    () => () => {
      requestSequenceRef.current += 1
      for (const url of resultUrlsRef.current.values()) URL.revokeObjectURL(url)
      resultUrlsRef.current.clear()
    },
    [],
  )

  function clearTargetResults(targets: FrameTarget[]) {
    const keys = new Set(targets.map((frame) => frame.key))
    for (const [key, url] of resultUrlsRef.current) {
      if (!keys.has(key)) continue
      URL.revokeObjectURL(url)
      resultUrlsRef.current.delete(key)
    }
    setResults((current) => {
      const next = { ...current }
      for (const key of keys) delete next[key]
      return next
    })
    setFrameStatuses((current) => {
      const next = { ...current }
      for (const key of keys) delete next[key]
      return next
    })
    setFrameErrors((current) => {
      const next = { ...current }
      for (const key of keys) delete next[key]
      return next
    })
  }

  async function processSelection() {
    if (working || !selectedAction) return
    const targets = scope === 'single' ? selectedAction.frames : allFrames
    if (targets.length === 0) return

    const requestSequence = requestSequenceRef.current + 1
    requestSequenceRef.current = requestSequence
    clearTargetResults(targets)
    setBatchState({ status: 'working', completed: 0, total: targets.length })

    let completed = 0
    let failed = 0
    for (const target of targets) {
      if (requestSequenceRef.current !== requestSequence) return
      setSelectedActionId(target.actionId)
      setSelectedFrameKey(target.key)
      setFrameStatuses((current) => ({ ...current, [target.key]: 'working' }))
      try {
        const result = await pixelPerfectApis.process({ imageUrl: target.imageUrl })
        if (requestSequenceRef.current !== requestSequence) return
        const previewUrl = URL.createObjectURL(result.blob)
        resultUrlsRef.current.set(target.key, previewUrl)
        setResults((current) => ({
          ...current,
          [target.key]: { filename: result.filename, previewUrl },
        }))
        setFrameStatuses((current) => ({ ...current, [target.key]: 'success' }))
      } catch (error) {
        if (requestSequenceRef.current !== requestSequence) return
        failed += 1
        setFrameStatuses((current) => ({ ...current, [target.key]: 'failure' }))
        setFrameErrors((current) => ({
          ...current,
          [target.key]: error instanceof Error ? error.message : '未知错误',
        }))
      }
      completed += 1
      setBatchState({ status: 'working', completed, total: targets.length })
    }
    setBatchState({ status: 'complete', failed, total: targets.length })
  }

  function selectAction(action: ActionGroup) {
    setSelectedActionId(action.id)
    setSelectedFrameKey(action.frames[0]?.key ?? '')
  }

  function downloadSelectedResult() {
    if (!selectedFrame) return
    const result = results[selectedFrame.key]
    if (!result) return
    const anchor = document.createElement('a')
    anchor.href = result.previewUrl
    anchor.download = result.filename
    anchor.click()
  }

  if (!selectedAction || !selectedFrame) return null

  const selectedResult = results[selectedFrame.key]
  const selectedStatus = frameStatuses[selectedFrame.key]
  const selectedError = frameErrors[selectedFrame.key]

  return (
    <section id={id} aria-label="完美像素化" className="mt-5 border-y border-app-line py-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div role="group" aria-label="像素化范围" className="flex shrink-0 gap-2">
          <ScopeButton
            pressed={scope === 'single'}
            disabled={working}
            onClick={() => setScope('single')}
          >
            <GridFour size={14} weight="bold" aria-hidden="true" />
            单个动作
          </ScopeButton>
          <ScopeButton pressed={scope === 'all'} disabled={working} onClick={() => setScope('all')}>
            <Stack size={14} weight="bold" aria-hidden="true" />
            全部动作
          </ScopeButton>
        </div>

        <div
          role="tablist"
          aria-label="选择动作"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-1"
        >
          {groups.map((action) => {
            const resultCount = action.frames.filter((frame) => results[frame.key]).length
            return (
              <button
                key={action.id}
                type="button"
                role="tab"
                aria-selected={selectedAction.id === action.id}
                disabled={working}
                onClick={() => selectAction(action)}
                className="min-h-9 shrink-0 border-b-2 border-transparent px-3 text-xs text-app-muted transition-colors aria-selected:border-app-ink aria-selected:text-app-ink hover:text-app-ink disabled:opacity-60"
              >
                <span className="font-semibold">{action.name}</span>
                <span className="ml-1.5 text-app-faint">
                  {resultCount > 0
                    ? `${resultCount}/${action.frames.length}`
                    : action.frames.length}
                </span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          disabled={working}
          onClick={() => void processSelection()}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-app-accent px-5 text-xs font-semibold text-app-on-accent transition-colors hover:bg-app-accent-hover disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
        >
          <GridFour size={15} weight="bold" aria-hidden="true" />
          {batchState.status === 'working'
            ? `${batchState.completed}/${batchState.total}`
            : scope === 'single'
              ? '像素化当前动作'
              : '像素化全部动作'}
        </button>
      </div>

      {batchState.status === 'complete' ? (
        <p role="status" className="mt-2 text-right text-xs text-app-muted">
          {batchState.failed === 0
            ? `已完成 ${batchState.total} 帧`
            : `完成 ${batchState.total - batchState.failed} 帧，${batchState.failed} 帧失败`}
        </p>
      ) : null}

      <div className="mt-4 grid min-w-0 grid-cols-2 gap-4 max-[560px]:grid-cols-1">
        <ComparePane
          label="处理前"
          imageUrl={selectedFrame.imageUrl}
          imageAlt={`${selectedFrame.actionName}第 ${selectedFrame.frameIndex + 1} 帧原图`}
        />
        <ComparePane
          label="处理后"
          imageUrl={selectedResult?.previewUrl ?? null}
          imageAlt={`${selectedFrame.actionName}第 ${selectedFrame.frameIndex + 1} 帧像素化结果`}
          status={selectedStatus}
          error={selectedError}
        />
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-3">
        <div
          role="list"
          aria-label={`${selectedAction.name}帧`}
          className="flex min-w-0 gap-2 overflow-x-auto py-1"
        >
          {selectedAction.frames.map((frame) => (
            <FrameChoice
              key={frame.key}
              frame={frame}
              selected={selectedFrame.key === frame.key}
              status={frameStatuses[frame.key]}
              onClick={() => setSelectedFrameKey(frame.key)}
            />
          ))}
        </div>
        {selectedResult ? (
          <button
            type="button"
            aria-label="下载当前帧"
            onClick={downloadSelectedResult}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-app-line text-app-ink-soft transition-colors hover:border-app-line-strong hover:text-app-accent"
          >
            <DownloadSimple size={16} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  )
}

function ScopeButton({
  pressed,
  disabled,
  onClick,
  children,
}: {
  pressed: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-app-line px-3 text-xs font-semibold text-app-muted transition-colors aria-pressed:border-app-ink aria-pressed:bg-app-ink aria-pressed:text-app-on-ink disabled:opacity-60"
    >
      {children}
    </button>
  )
}

function ComparePane({
  label,
  imageUrl,
  imageAlt,
  status,
  error,
}: {
  label: string
  imageUrl: string | null
  imageAlt: string
  status?: FrameStatus
  error?: string
}) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-[0.68rem] font-semibold tracking-[0.12em] text-app-faint">
        {label}
      </figcaption>
      <div className="relative aspect-square overflow-hidden rounded-[1.2rem] border border-app-line bg-app-canvas">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={imageAlt}
            className="h-full w-full object-contain p-5 [image-rendering:pixelated]"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center border border-dashed border-app-line p-6 text-center">
            <p
              role={status === 'failure' ? 'alert' : status === 'working' ? 'status' : undefined}
              className={`text-xs ${status === 'failure' ? 'text-app-danger' : 'text-app-faint'}`}
            >
              {status === 'working'
                ? '处理中…'
                : status === 'failure'
                  ? `处理失败：${error ?? '未知错误'}`
                  : '等待处理'}
            </p>
          </div>
        )}
      </div>
    </figure>
  )
}

function FrameChoice({
  frame,
  selected,
  status,
  onClick,
}: {
  frame: FrameTarget
  selected: boolean
  status?: FrameStatus
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="listitem"
      aria-label={`第 ${frame.frameIndex + 1} 帧`}
      aria-pressed={selected}
      onClick={onClick}
      className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-app-line bg-app-canvas transition-colors aria-pressed:border-app-ink aria-pressed:ring-1 aria-pressed:ring-app-ink"
    >
      <img
        src={frame.imageUrl}
        alt=""
        className="h-full w-full object-contain p-2 [image-rendering:pixelated]"
      />
      <span className="absolute left-1 bottom-1 rounded bg-app-canvas/90 px-1 font-mono text-[9px] text-app-muted">
        {frame.frameIndex + 1}
      </span>
      {status ? (
        <span
          aria-hidden="true"
          className={`absolute top-1 right-1 size-2 rounded-full ${
            status === 'success'
              ? 'bg-app-accent'
              : status === 'failure'
                ? 'bg-app-danger'
                : 'animate-pulse bg-app-faint'
          }`}
        />
      ) : null}
    </button>
  )
}
