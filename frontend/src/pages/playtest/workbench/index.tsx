import { useCallback, useEffect, useMemo, useState, type PointerEvent, type ReactNode } from 'react'

import type { Character, DirectionalMovement } from '@/entities'

import {
  playtestPreferenceActionType,
  PLAYTEST_CONTROL_KEYS,
  resolvePlaytestActionBindings,
  type PlaytestControlKey,
} from './bindings'
import { createPlaytestModel, isLocomotionAction, type PlaytestModel } from './model'
import {
  PLAYTEST_COMMANDS,
  readPlaytestPreferences,
  rebindPlaytestCommand,
  removePlaytestPreferences,
  setPlaytestActionType,
  writePlaytestPreferences,
  type PlaytestActionCommand,
  type PlaytestCommand,
  type PlaytestPreferences,
} from './preferences'
import { usePlaytestRuntime } from './runtime/use-playtest-runtime'
import { playbackForFacing, type MovementDirection } from './runtime/runtime'
import { PlaytestStage } from './stage'

export interface PlaytestWorkbenchProps {
  readonly character: Character
  readonly outfitId: string
  readonly movementMode: DirectionalMovement
  readonly userId?: string | null
  readonly initialActionId?: string | null
  readonly toolbar?: ReactNode
}

const actionControls: Readonly<
  Record<PlaytestControlKey, { readonly command: PlaytestActionCommand; readonly label: string }>
> = {
  space: { command: 'primary_action', label: '主动作' },
  shift: { command: 'secondary_action', label: '次动作' },
}

const movementControls: readonly {
  command: Extract<PlaytestCommand, `move_${string}`>
  direction: MovementDirection
  label: string
  gridClass: string
}[] = [
  {
    command: 'move_up',
    direction: 'up',
    label: '向上移动',
    gridClass: 'col-start-2 row-start-1',
  },
  {
    command: 'move_left',
    direction: 'left',
    label: '向左移动',
    gridClass: 'col-start-1 row-start-2',
  },
  {
    command: 'move_down',
    direction: 'down',
    label: '向下移动',
    gridClass: 'col-start-2 row-start-2',
  },
  {
    command: 'move_right',
    direction: 'right',
    label: '向右移动',
    gridClass: 'col-start-3 row-start-2',
  },
]

const commandLabels: Readonly<Record<PlaytestCommand, string>> = {
  move_up: '向上移动',
  move_down: '向下移动',
  move_left: '向左移动',
  move_right: '向右移动',
  primary_action: '主动作',
  secondary_action: '次动作',
}

function keyLabel(code: string | null): string {
  if (code === null) return '未绑定'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Space'
  if (code === 'ShiftLeft') return 'L Shift'
  if (code === 'ShiftRight') return 'R Shift'
  if (code.startsWith('Arrow')) return code.slice(5)
  return code
}

export function PlaytestWorkbench({
  character,
  outfitId,
  movementMode,
  userId = null,
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
      userId={userId}
      toolbar={toolbar}
      initialActionId={initialActionId}
    />
  )
}

function PlaytestExperience({
  model,
  movementMode,
  userId,
  toolbar,
  initialActionId,
}: {
  readonly model: PlaytestModel
  readonly movementMode: DirectionalMovement
  readonly userId: string | null
  readonly toolbar: ReactNode
  readonly initialActionId: string | null
}) {
  const [preferences, setPreferences] = useState<PlaytestPreferences>(() =>
    readPlaytestPreferences(userId ?? ''),
  )
  const [capturing, setCapturing] = useState<PlaytestCommand | null>(null)
  const [persistenceMessage, setPersistenceMessage] = useState(
    userId === null ? '仅本次有效，未找到登录账号' : '键位仅保存在此浏览器',
  )
  const bindings = useMemo(
    () => resolvePlaytestActionBindings(model.actions, preferences),
    [model.actions, preferences],
  )
  const runtime = usePlaytestRuntime(model.actions, initialActionId, movementMode, bindings, {
    preferences,
    keyboardEnabled: capturing === null,
  })
  const locomotion = model.actions.find(isLocomotionAction)
  const actionChoices = useMemo(() => {
    const choices = new Map<string, string>()
    for (const action of model.actions) {
      const type = playtestPreferenceActionType(action.type)
      if (!choices.has(type)) choices.set(type, action.name)
    }
    return [...choices].map(([type, name]) => ({ type, name }))
  }, [model.actions])

  useEffect(() => {
    setPreferences(readPlaytestPreferences(userId ?? ''))
    setPersistenceMessage(userId === null ? '仅本次有效，未找到登录账号' : '键位仅保存在此浏览器')
    setCapturing(null)
  }, [userId])

  const applyPreferences = useCallback(
    (next: PlaytestPreferences) => {
      setPreferences(next)
      const saved = userId !== null && writePlaytestPreferences(userId, next)
      setPersistenceMessage(saved ? '已保存到此浏览器' : '仅本次有效，浏览器未保存')
    },
    [userId],
  )

  useEffect(() => {
    if (capturing === null) return
    const captureKey = (event: globalThis.KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        setCapturing(null)
        return
      }
      if (event.code === 'Delete' || event.code === 'Backspace') {
        if (capturing === 'primary_action' || capturing === 'secondary_action') {
          applyPreferences(rebindPlaytestCommand(preferences, capturing, null))
          setCapturing(null)
        }
        return
      }
      if (!event.code) return
      applyPreferences(rebindPlaytestCommand(preferences, capturing, event.code))
      setCapturing(null)
    }
    window.addEventListener('keydown', captureKey, true)
    return () => window.removeEventListener('keydown', captureKey, true)
  }, [applyPreferences, capturing, preferences])

  const resetPreferences = () => {
    const next = readPlaytestPreferences('', null)
    setPreferences(next)
    const removed = userId !== null && removePlaytestPreferences(userId)
    setPersistenceMessage(removed ? '已恢复此浏览器默认键位' : '仅本次有效，浏览器未保存')
    setCapturing(null)
  }

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
            <p className="text-xs text-app-muted">
              {keyLabel(preferences.bindings.move_up.code)} /{' '}
              {keyLabel(preferences.bindings.move_left.code)} /{' '}
              {keyLabel(preferences.bindings.move_down.code)} /{' '}
              {keyLabel(preferences.bindings.move_right.code)} 移动
            </p>
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
            className="absolute left-4 top-4 w-[250px] rounded-3xl border border-app-surface-raised/55 bg-app-surface/95 p-3 shadow-app-stage-panel backdrop-blur-xl sm:left-5 sm:top-5 sm:w-[270px]"
          >
            <p className="px-2 pb-2 font-mono text-[9px] font-semibold tracking-[0.16em] text-app-faint">
              BOUND ACTIONS
            </p>
            <div className="space-y-1">
              {model.actions.map((action) => {
                const selected = action.id === runtime.runtime.actionId
                const disabled = playbackForFacing(action, runtime.runtime.facing) === undefined
                return (
                  <button
                    key={action.id}
                    type="button"
                    aria-label={`绑定动作：${action.name}`}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => runtime.selectAction(action.id)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                      selected
                        ? 'bg-app-accent text-app-on-accent'
                        : 'text-app-ink-soft hover:bg-app-surface-muted'
                    } disabled:cursor-not-allowed disabled:opacity-35`}
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
              <div className="space-y-2">
                {PLAYTEST_COMMANDS.map((command) => {
                  const actionCommand =
                    command === 'primary_action' || command === 'secondary_action'
                  return (
                    <div key={command} className="flex items-center gap-2 px-1">
                      <button
                        type="button"
                        aria-label={`修改${commandLabels[command]}键位`}
                        aria-pressed={capturing === command}
                        onClick={() => setCapturing(command)}
                        className={`min-w-14 shrink-0 rounded-full border px-2.5 py-1.5 font-mono text-[10px] font-semibold shadow-sm transition duration-150 active:translate-y-px active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none ${
                          capturing === command
                            ? 'border-app-accent bg-app-accent/12 text-app-accent ring-4 ring-app-accent-soft'
                            : 'border-app-line bg-app-surface-raised/85 text-app-ink-soft hover:border-app-line-strong hover:bg-app-surface-muted'
                        }`}
                      >
                        {capturing === command
                          ? '请按新键'
                          : keyLabel(preferences.bindings[command].code)}
                      </button>
                      {actionCommand ? (
                        <select
                          aria-label={`${commandLabels[command]}分配动作`}
                          value={preferences.bindings[command].actionType ?? ''}
                          onChange={(event) =>
                            applyPreferences(
                              setPlaytestActionType(
                                preferences,
                                command,
                                event.target.value || null,
                              ),
                            )
                          }
                          className="h-7 min-w-0 flex-1 rounded-full border border-app-line bg-app-surface-raised px-2 text-[11px] text-app-ink outline-none transition-colors focus:border-app-accent"
                        >
                          <option value="">未分配</option>
                          {actionChoices.map((choice) => (
                            <option key={choice.type} value={choice.type}>
                              {choice.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="truncate text-[10px] text-app-muted">
                          {commandLabels[command]}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-app-line px-1 pt-2">
                <p aria-live="polite" className="text-[9px] leading-4 text-app-faint">
                  {persistenceMessage}
                </p>
                <button
                  type="button"
                  aria-label="恢复默认键位"
                  onClick={resetPreferences}
                  className="shrink-0 rounded-full px-2 py-1 text-[9px] font-medium text-app-muted transition-colors hover:bg-app-surface-muted hover:text-app-ink"
                >
                  恢复默认
                </button>
              </div>
            </div>
          </aside>

          <div
            role="group"
            aria-label="角色操控"
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-app-surface-raised/60 bg-app-surface/95 p-2 shadow-app-float backdrop-blur-2xl sm:bottom-5"
          >
            <div className="grid grid-cols-3 grid-rows-2 gap-1.5">
              {movementControls.map(({ command, direction, label, gridClass }) => {
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
                    key={command}
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
                    className={`${gridClass} grid h-9 min-w-11 touch-none place-items-center rounded-xl border px-2 font-mono text-[11px] font-semibold transition duration-150 active:translate-y-px active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none ${
                      pressed
                        ? 'border-app-accent bg-app-accent text-app-on-accent'
                        : 'border-app-line bg-app-surface-raised/80 text-app-ink-soft hover:border-app-line-strong'
                    } disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-app-line`}
                  >
                    {keyLabel(preferences.bindings[command].code)}
                  </button>
                )
              })}
            </div>
            <div className="h-12 w-px bg-app-line" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              {PLAYTEST_CONTROL_KEYS.map((key) => {
                const { command, label } = actionControls[key]
                const boundAction = model.actions.find((action) => action.id === bindings[key])
                const pressed = bindings[key] !== null && runtime.runtime.actionId === bindings[key]
                const disabled =
                  boundAction === undefined ||
                  playbackForFacing(boundAction, runtime.runtime.facing) === undefined

                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`${label}键`}
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
                    className={`grid h-9 min-w-14 touch-none place-items-center rounded-xl border px-3 font-mono text-[11px] font-semibold transition duration-150 active:translate-y-px active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none ${
                      pressed
                        ? 'border-app-accent bg-app-accent text-app-on-accent'
                        : 'border-app-line bg-app-surface-raised/80 text-app-ink-soft hover:border-app-line-strong'
                    } disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-app-line`}
                  >
                    {keyLabel(preferences.bindings[command].code)}
                  </button>
                )
              })}
            </div>
            <div className="hidden w-56 min-w-0 px-3 sm:block lg:w-80">
              <p className="text-[10px] text-app-faint">当前动作</p>
              <p
                className="mt-0.5 truncate text-xs font-semibold"
                title={runtime.action?.name ?? '无'}
              >
                {runtime.action?.name ?? '无'}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
