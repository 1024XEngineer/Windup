import { useMemo, type PointerEvent, type ReactNode } from 'react'

import type { Character } from '@/entities'

import { createPlaytestModel, type PlaytestModel } from './model'
import type { Direction } from './runtime/runtime'
import { usePlaytestRuntime } from './runtime/use-playtest-runtime'
import { PlaytestStage } from './stage'

export interface PlaytestWorkbenchProps {
  readonly character: Character
  readonly outfitId: string
  readonly initialActionId?: string | null
  readonly toolbar?: ReactNode
}

const directionLabels: Readonly<Record<Direction, string>> = {
  left: '向左',
  right: '向右',
}

export function PlaytestWorkbench({
  character,
  outfitId,
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
    <PlaytestExperience model={result.model} toolbar={toolbar} initialActionId={initialActionId} />
  )
}

function PlaytestExperience({
  model,
  toolbar,
  initialActionId,
}: {
  readonly model: PlaytestModel
  readonly toolbar: ReactNode
  readonly initialActionId: string | null
}) {
  const runtime = usePlaytestRuntime(model.actions, initialActionId)

  const holdDirection = (direction: Direction, pressed: boolean, source: string) => {
    runtime.setDirection(direction, pressed, source)
  }
  const releasePointer = (event: PointerEvent<HTMLButtonElement>, direction: Direction) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    holdDirection(direction, false, `pointer:${event.pointerId}:${direction}`)
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
            <p className="text-xs text-app-muted">A / D 或方向键操控角色</p>
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
            facing={runtime.runtime.facing}
            onBoundsChange={runtime.setBounds}
          />

          <aside
            aria-label="动作绑定"
            className="absolute left-4 top-4 w-[150px] rounded-2xl border border-app-surface-raised/55 bg-app-surface/95 p-2.5 shadow-app-stage-panel backdrop-blur-xl sm:left-5 sm:top-5 sm:w-[176px]"
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
          </aside>

          <div
            role="group"
            aria-label="角色操控"
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-app-surface-raised/60 bg-app-surface/95 p-2 shadow-app-float backdrop-blur-2xl sm:bottom-5"
          >
            {(['left', 'right'] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                aria-label={directionLabels[direction]}
                aria-pressed={runtime.runtime.held[direction]}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  holdDirection(direction, true, `pointer:${event.pointerId}:${direction}`)
                }}
                onPointerUp={(event) => releasePointer(event, direction)}
                onPointerCancel={(event) => releasePointer(event, direction)}
                onLostPointerCapture={(event) =>
                  holdDirection(direction, false, `pointer:${event.pointerId}:${direction}`)
                }
                className={`grid h-11 w-14 touch-none place-items-center rounded-full border font-mono text-sm transition-colors ${
                  runtime.runtime.held[direction]
                    ? 'border-app-accent bg-app-accent text-app-on-accent'
                    : 'border-app-line bg-app-surface-raised/80 text-app-ink-soft hover:border-app-line-strong'
                }`}
              >
                {direction === 'left' ? '←' : '→'}
              </button>
            ))}
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
