import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from 'react'

import type { Character, DirectionalMovement } from '@/entities'

import {
  createDefaultActionBindings,
  PLAYTEST_CONTROL_KEYS,
  type PlaytestControlKey,
} from './bindings'
import { createPlaytestModel, type PlaytestModel } from './model'
import { usePlaytestRuntime } from './runtime/use-playtest-runtime'
import { playbackForFacing, type MovementDirection } from './runtime/runtime'
import { PlaytestStage } from './stage'

export interface PlaytestWorkbenchProps {
  readonly character: Character
  readonly outfitId: string
  readonly movementMode: DirectionalMovement
  readonly initialActionId?: string | null
  readonly toolbar?: ReactNode
}

const controlLabels: Readonly<Record<PlaytestControlKey, string>> = {
  space: '空格键',
  shift: 'Shift 键',
}

const controlKeyLabels: Readonly<Record<PlaytestControlKey, string>> = {
  space: 'Space',
  shift: 'Shift',
}

const assignmentLabels: Readonly<Record<PlaytestControlKey, string>> = {
  space: '空格键分配动作',
  shift: 'Shift 分配动作',
}

const assignmentKeyWidths: Readonly<Record<PlaytestControlKey, string>> = {
  space: 'w-14',
  shift: 'w-12',
}

const controlButtonWidths: Readonly<Record<PlaytestControlKey, string>> = {
  space: 'w-16',
  shift: 'w-14',
}

const movementControls: readonly {
  key: 'w' | 'a' | 's' | 'd'
  direction: MovementDirection
  label: string
  gridClass: string
}[] = [
  { key: 'w', direction: 'up', label: '向上移动', gridClass: 'col-start-2 row-start-1' },
  { key: 'a', direction: 'left', label: '向左移动', gridClass: 'col-start-1 row-start-2' },
  { key: 's', direction: 'down', label: '向下移动', gridClass: 'col-start-2 row-start-2' },
  { key: 'd', direction: 'right', label: '向右移动', gridClass: 'col-start-3 row-start-2' },
]

export function PlaytestWorkbench({
  character,
  outfitId,
  movementMode,
  initialActionId = null,
  toolbar = null,
}: PlaytestWorkbenchProps) {
  const result = useMemo(() => createPlaytestModel(character, outfitId), [character, outfitId])

  if (!result.ok) {
    return (
      <main
        aria-label="预览台"
        className="grid min-h-screen place-items-center bg-app-surface-strong p-6"
      >
        <p className="rounded-full border border-app-line bg-app-surface px-5 py-3 text-sm text-app-ink-soft">
          找不到指定造型，无法进入预览台。
        </p>
      </main>
    )
  }

  return (
    <PlaytestExperience
      model={result.model}
      movementMode={movementMode}
      toolbar={toolbar}
      initialActionId={initialActionId}
    />
  )
}

function PlaytestExperience({
  model,
  movementMode,
  toolbar,
  initialActionId,
}: {
  readonly model: PlaytestModel
  readonly movementMode: DirectionalMovement
  readonly toolbar: ReactNode
  readonly initialActionId: string | null
}) {
  const [bindings, setBindings] = useState(() => createDefaultActionBindings(model.actions))
  const runtime = usePlaytestRuntime(model.actions, initialActionId, movementMode, bindings)
  const locomotion = model.actions.find((action) => action.type === 'walk' || action.type === 'run')

  useEffect(() => {
    setBindings(createDefaultActionBindings(model.actions))
  }, [model.actions])

  const holdControl = (key: PlaytestControlKey, pressed: boolean, source: string) => {
    runtime.setControl(key, pressed, source)
  }
  const releasePointer = (event: PointerEvent<HTMLButtonElement>, key: PlaytestControlKey) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    holdControl(key, false, `pointer:${event.pointerId}:${key}`)
  }
  const releaseMovementPointer = (
    event: PointerEvent<HTMLButtonElement>,
    direction: MovementDirection,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    runtime.setMovement(direction, false, `pointer:${event.pointerId}:${direction}`)
  }

  // 顶栏悬浮不占布局高度，满幅页面自己让出避让空间；pt-24 与 PageContainer 同源，改顶栏尺寸时一起改。
  return (
    <main
      aria-label="预览台"
      className="flex h-screen flex-col bg-app-surface-strong px-3 pb-4 pt-24 text-app-ink sm:px-5 sm:pb-5"
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-app-faint">
              预览台
            </p>
            <h1
              aria-label={`${model.characterId} · ${model.outfitName}`}
              className="mt-1 font-serif text-2xl tracking-[-0.02em] sm:text-3xl"
            >
              {model.outfitName}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-app-muted">W / A / S / D 移动 · Space 跳跃 · Shift 下蹲</p>
            {toolbar}
          </div>
        </header>

        {/*
          舞台吃掉标题行之外剩下的全部高度，用 flex 分配而不是减一串魔数——
          底部操控胶囊贴着舞台内沿，舞台只要比视口高一点，胶囊就落到折叠线以下：
          页面看着是好的，操控要滚动才找得到。下限 420px 之外不设固定高度。
        */}
        <section className="relative min-h-[420px] flex-1">
          <PlaytestStage
            frame={runtime.frame}
            x={runtime.runtime.x}
            y={runtime.runtime.y}
            mirrorX={runtime.mirrorX}
            onBoundsChange={runtime.setBounds}
          />

          <aside
            aria-label="动作绑定"
            className="absolute left-4 top-4 w-[190px] rounded-2xl border border-app-surface-raised/55 bg-app-surface/95 p-2.5 shadow-app-stage-panel backdrop-blur-xl sm:left-5 sm:top-5 sm:w-[210px]"
          >
            <p className="px-2 pb-2 font-mono text-[9px] font-semibold tracking-[0.16em] text-app-faint">
              BOUND ACTIONS
            </p>
            <div className="space-y-1">
              {model.actions.map((action) => {
                const selected = action.id === runtime.runtime.actionId
                return (
                  <button
                    key={action.id}
                    type="button"
                    aria-label={`绑定动作：${action.name}`}
                    aria-pressed={selected}
                    onClick={() => runtime.selectAction(action.id)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                      selected
                        ? 'bg-app-accent text-app-on-accent'
                        : 'text-app-ink-soft hover:bg-app-surface-muted'
                    }`}
                  >
                    <span>{action.name}</span>
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${
                        selected ? 'bg-app-accent-soft' : 'bg-app-line'
                      }`}
                    />
                  </button>
                )
              })}
            </div>
            <div className="mt-2 border-t border-app-line pt-2">
              <p className="px-2 pb-1.5 text-[10px] font-medium text-app-faint">按键分配</p>
              <div className="space-y-1.5">
                {PLAYTEST_CONTROL_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 px-1">
                    <span
                      className={`grid h-7 shrink-0 place-items-center rounded-md border border-app-line bg-app-surface-raised font-mono text-[11px] font-semibold text-app-ink-soft ${assignmentKeyWidths[key]}`}
                    >
                      {controlKeyLabels[key]}
                    </span>
                    <select
                      aria-label={assignmentLabels[key]}
                      value={bindings[key] ?? ''}
                      onChange={(event) => {
                        const actionId = event.target.value || null
                        setBindings((current) => ({ ...current, [key]: actionId }))
                      }}
                      className="h-7 min-w-0 flex-1 rounded-md border border-app-line bg-app-surface-raised px-2 text-[11px] text-app-ink outline-none focus:border-app-accent"
                    >
                      <option value="">未分配</option>
                      {model.actions.map((action) => (
                        <option key={action.id} value={action.id}>
                          {action.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          </aside>

          <div
            role="group"
            aria-label="角色操控"
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-app-surface-raised/60 bg-app-surface/95 p-2 shadow-app-float backdrop-blur-2xl sm:bottom-5"
          >
            <div className="grid grid-cols-3 grid-rows-2 gap-1.5">
              {movementControls.map(({ key, direction, label, gridClass }) => {
                const pressed = runtime.runtime.held[direction]
                const facing =
                  direction === 'left'
                    ? 'west'
                    : direction === 'right'
                      ? 'east'
                      : direction === 'up'
                        ? 'north'
                        : 'south'
                const directionAction = locomotion ?? runtime.action
                const disabled =
                  directionAction === null ||
                  directionAction === undefined ||
                  (movementMode === 'single' && (direction === 'up' || direction === 'down')) ||
                  playbackForFacing(directionAction, facing) === undefined

                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={label}
                    aria-pressed={pressed}
                    disabled={disabled}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      runtime.setMovement(
                        direction,
                        true,
                        `pointer:${event.pointerId}:${direction}`,
                      )
                    }}
                    onPointerUp={(event) => releaseMovementPointer(event, direction)}
                    onPointerCancel={(event) => releaseMovementPointer(event, direction)}
                    onLostPointerCapture={(event) =>
                      runtime.setMovement(
                        direction,
                        false,
                        `pointer:${event.pointerId}:${direction}`,
                      )
                    }
                    className={`${gridClass} grid h-9 w-11 touch-none place-items-center rounded-md border font-mono text-xs font-semibold uppercase transition-colors ${
                      pressed
                        ? 'border-app-accent bg-app-accent text-app-on-accent'
                        : 'border-app-line bg-app-surface-raised/80 text-app-ink-soft hover:border-app-line-strong'
                    } disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-app-line`}
                  >
                    {key}
                  </button>
                )
              })}
            </div>
            <div className="h-12 w-px bg-app-line" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              {PLAYTEST_CONTROL_KEYS.map((key) => {
                const pressed = bindings[key] !== null && runtime.runtime.actionId === bindings[key]
                const disabled = bindings[key] === null
                const width = controlButtonWidths[key]

                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={controlLabels[key]}
                    aria-pressed={pressed}
                    disabled={disabled}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      holdControl(key, true, `pointer:${event.pointerId}:${key}`)
                    }}
                    onPointerUp={(event) => releasePointer(event, key)}
                    onPointerCancel={(event) => releasePointer(event, key)}
                    onLostPointerCapture={(event) =>
                      holdControl(key, false, `pointer:${event.pointerId}:${key}`)
                    }
                    className={`grid h-9 touch-none place-items-center rounded-md border font-mono text-xs font-semibold transition-colors ${width} ${
                      pressed
                        ? 'border-app-accent bg-app-accent text-app-on-accent'
                        : 'border-app-line bg-app-surface-raised/80 text-app-ink-soft hover:border-app-line-strong'
                    } disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-app-line`}
                  >
                    {controlKeyLabels[key]}
                  </button>
                )
              })}
            </div>
            <div className="hidden min-w-[116px] px-3 sm:block">
              <p className="text-[10px] text-app-faint">当前动作</p>
              <p className="mt-0.5 truncate text-xs font-semibold">
                {runtime.action?.name ?? '无'}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
