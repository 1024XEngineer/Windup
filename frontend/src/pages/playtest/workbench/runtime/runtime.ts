import type { PlaytestAction } from '../model'

export type Direction = 'left' | 'right'
export type Facing = -1 | 1

export interface StageBounds {
  readonly minX: number
  readonly maxX: number
}

export interface PlaytestRuntime {
  readonly actionId: string | null
  readonly frameIndex: number
  readonly frameElapsedMs: number
  readonly x: number
  readonly facing: Facing
  readonly held: Readonly<Record<Direction, boolean>>
}

const EMPTY_HELD: PlaytestRuntime['held'] = { left: false, right: false }

function actionById(
  actions: readonly PlaytestAction[],
  actionId: string | null,
): PlaytestAction | undefined {
  return actions.find((action) => action.id === actionId && action.frames.length > 0)
}

function actionByType(
  actions: readonly PlaytestAction[],
  type: PlaytestAction['type'],
): PlaytestAction | undefined {
  return actions.find((action) => action.type === type && action.frames.length > 0)
}

function initialAction(
  actions: readonly PlaytestAction[],
  requestedActionId: string | null,
): PlaytestAction | undefined {
  return (
    actionById(actions, requestedActionId) ??
    actionByType(actions, 'idle') ??
    actions.find((action) => action.frames.length > 0)
  )
}

export function createRuntime(
  actions: readonly PlaytestAction[],
  initialActionId: string | null,
): PlaytestRuntime {
  return {
    actionId: initialAction(actions, initialActionId)?.id ?? null,
    frameIndex: 0,
    frameElapsedMs: 0,
    x: 0,
    facing: 1,
    held: EMPTY_HELD,
  }
}

export function selectRuntimeAction(
  runtime: PlaytestRuntime,
  actions: readonly PlaytestAction[],
  actionId: string,
): PlaytestRuntime {
  const action = actionById(actions, actionId)
  if (action === undefined || action.id === runtime.actionId) return runtime

  return {
    ...runtime,
    actionId: action.id,
    frameIndex: 0,
    frameElapsedMs: 0,
  }
}

function horizontalAxis(held: PlaytestRuntime['held']): -1 | 0 | 1 {
  if (held.left === held.right) return 0
  return held.left ? -1 : 1
}

function frameDurationMs(action: PlaytestAction, frameIndex: number): number {
  return Math.max(1, action.frames[frameIndex]?.durationMs ?? 1)
}

export function setDirectionInput(
  runtime: PlaytestRuntime,
  actions: readonly PlaytestAction[],
  direction: Direction,
  pressed: boolean,
): PlaytestRuntime {
  if (runtime.held[direction] === pressed) return runtime

  const held = { ...runtime.held, [direction]: pressed }
  const axis = horizontalAxis(held)
  const action = axis === 0 ? actionByType(actions, 'idle') : actionByType(actions, 'walk')
  const nextActionId = action?.id ?? runtime.actionId

  return {
    ...runtime,
    held,
    facing: axis === 0 ? runtime.facing : axis,
    actionId: nextActionId,
    frameIndex: nextActionId === runtime.actionId ? runtime.frameIndex : 0,
    frameElapsedMs: nextActionId === runtime.actionId ? runtime.frameElapsedMs : 0,
  }
}

export function advanceRuntime(
  runtime: PlaytestRuntime,
  actions: readonly PlaytestAction[],
  deltaMs: number,
  bounds: StageBounds,
  movementSpeed: number,
): PlaytestRuntime {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return runtime

  const action = actionById(actions, runtime.actionId)
  if (action === undefined) return runtime

  const axis = horizontalAxis(runtime.held)
  const nextX = Math.min(
    bounds.maxX,
    Math.max(bounds.minX, runtime.x + (axis * movementSpeed * deltaMs) / 1000),
  )
  const lastFrameIndex = action.frames.length - 1
  let frameIndex = Math.min(runtime.frameIndex, lastFrameIndex)
  let frameElapsedMs = runtime.frameElapsedMs + deltaMs

  let currentFrameDurationMs = frameDurationMs(action, frameIndex)
  while (frameElapsedMs >= currentFrameDurationMs) {
    // 非循环动作走到末帧就停住：攻击、跳跃这类一次性动作回到首帧会变成假的循环动画。
    if (!action.loop && frameIndex === lastFrameIndex) {
      frameElapsedMs = currentFrameDurationMs
      break
    }
    frameElapsedMs -= currentFrameDurationMs
    frameIndex = (frameIndex + 1) % action.frames.length
    currentFrameDurationMs = frameDurationMs(action, frameIndex)
  }

  if (
    nextX === runtime.x &&
    frameIndex === runtime.frameIndex &&
    frameElapsedMs === runtime.frameElapsedMs
  ) {
    return runtime
  }

  return { ...runtime, x: nextX, frameIndex, frameElapsedMs }
}
