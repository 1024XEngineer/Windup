import type { ActionDirection, DirectionalMovement } from '@/entities'

import type { PlaytestActionBindings, PlaytestControlKey } from '../bindings'
import {
  hasPlayableFrames,
  type PlaytestAction,
  type PlaytestFrame,
  type PlaytestPlayback,
} from '../model'

export type Direction = 'left' | 'right'
export type MovementDirection = 'up' | 'down' | Direction
export type Facing = ActionDirection

export interface StageBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY?: number
  readonly maxY?: number
}

export interface PlaytestRuntime {
  readonly actionId: string | null
  readonly frameIndex: number
  readonly frameElapsedMs: number
  readonly x: number
  readonly y: number
  readonly facing: Facing
  readonly movementMode: DirectionalMovement
  readonly held: Readonly<Record<MovementDirection, boolean>>
  readonly heldOrder: readonly MovementDirection[]
}

const EMPTY_HELD: PlaytestRuntime['held'] = {
  up: false,
  down: false,
  left: false,
  right: false,
}

export function framesForFacing(
  action: PlaytestAction,
  facing: Facing,
): readonly PlaytestFrame[] | undefined {
  return playbackForFacing(action, facing)?.frames
}

export function playbackForFacing(
  action: PlaytestAction,
  facing: Facing,
): PlaytestPlayback | undefined {
  const explicit = action.sequences?.[facing]
  if (explicit !== undefined) return explicit
  // 一旦动作带有方向序列，frames 只是旧调用方的兼容别名，不能再把它
  // 当成 east/west。否则 north-only 等动作会被伪装成横向动作。
  if (Object.keys(action.sequences ?? {}).length > 0) return undefined
  if (action.frames.length === 0 || (facing !== 'east' && facing !== 'west')) return undefined
  return {
    frames: action.frames,
    sourceDirection: 'east',
    mirrorX: facing === 'west',
  }
}

function actionById(
  actions: readonly PlaytestAction[],
  actionId: string | null,
): PlaytestAction | undefined {
  return actions.find((action) => action.id === actionId && hasPlayableFrames(action))
}

function actionByType(
  actions: readonly PlaytestAction[],
  type: PlaytestAction['type'],
): PlaytestAction | undefined {
  return actions.find((action) => action.type === type && hasPlayableFrames(action))
}

const FACING_FALLBACK_ORDER: readonly Facing[] = [
  'east',
  'west',
  'north',
  'south',
  'north_east',
  'north_west',
  'south_east',
  'south_west',
]

function facingForAction(action: PlaytestAction, preferred: Facing): Facing {
  const candidates = [
    preferred,
    ...FACING_FALLBACK_ORDER.filter((direction) => direction !== preferred),
  ]
  return (
    candidates.find((direction) => (framesForFacing(action, direction)?.length ?? 0) > 0) ??
    preferred
  )
}

function initialAction(
  actions: readonly PlaytestAction[],
  requestedActionId: string | null,
): PlaytestAction | undefined {
  return (
    actionById(actions, requestedActionId) ??
    actionByType(actions, 'idle') ??
    actions.find(hasPlayableFrames)
  )
}

export function createRuntime(
  actions: readonly PlaytestAction[],
  initialActionId: string | null,
  movementMode: DirectionalMovement = 'single',
): PlaytestRuntime {
  const action = initialAction(actions, initialActionId)
  return {
    actionId: action?.id ?? null,
    frameIndex: 0,
    frameElapsedMs: 0,
    x: 0,
    y: 0,
    facing: action === undefined ? 'east' : facingForAction(action, 'east'),
    movementMode,
    held: EMPTY_HELD,
    heldOrder: [],
  }
}

export function selectRuntimeAction(
  runtime: PlaytestRuntime,
  actions: readonly PlaytestAction[],
  actionId: string,
): PlaytestRuntime {
  const action = actionById(actions, actionId)
  if (
    action === undefined ||
    action.id === runtime.actionId ||
    playbackForFacing(action, runtime.facing) === undefined
  )
    return runtime

  return {
    ...runtime,
    actionId: action.id,
    frameIndex: 0,
    frameElapsedMs: 0,
  }
}

function axis(negative: boolean, positive: boolean): -1 | 0 | 1 {
  if (negative === positive) return 0
  return negative ? -1 : 1
}

function horizontalAxis(held: PlaytestRuntime['held']): -1 | 0 | 1 {
  return axis(held.left, held.right)
}

function verticalAxis(held: PlaytestRuntime['held']): -1 | 0 | 1 {
  return axis(held.up, held.down)
}

function frameDurationMs(frames: readonly PlaytestFrame[], frameIndex: number): number {
  return Math.max(1, frames[frameIndex]?.durationMs ?? 1)
}

function isLocomotionAction(action: PlaytestAction): boolean {
  return action.type === 'walk' || action.type === 'run'
}

function cardinalFacing(direction: MovementDirection): Facing {
  if (direction === 'up') return 'north'
  if (direction === 'down') return 'south'
  if (direction === 'left') return 'west'
  return 'east'
}

function diagonalFacing(horizontal: -1 | 1, vertical: -1 | 1): Facing {
  if (vertical < 0) return horizontal < 0 ? 'north_west' : 'north_east'
  return horizontal < 0 ? 'south_west' : 'south_east'
}

function facingForHeld(
  held: PlaytestRuntime['held'],
  heldOrder: PlaytestRuntime['heldOrder'],
  movementMode: DirectionalMovement,
  fallback: Facing,
): Facing {
  const horizontal = horizontalAxis(held)
  const vertical = verticalAxis(held)
  if (movementMode === 'eight-way') {
    if (horizontal !== 0 && vertical !== 0) return diagonalFacing(horizontal, vertical)
    if (horizontal !== 0) return horizontal < 0 ? 'west' : 'east'
    if (vertical !== 0) return vertical < 0 ? 'north' : 'south'
  }
  const remaining = [...heldOrder]
    .reverse()
    .find((direction) => movementMode !== 'single' || direction === 'left' || direction === 'right')
  return remaining === undefined ? fallback : cardinalFacing(remaining)
}

export function setMovementInput(
  runtime: PlaytestRuntime,
  actions: readonly PlaytestAction[],
  direction: MovementDirection,
  pressed: boolean,
): PlaytestRuntime {
  if (runtime.held[direction] === pressed) return runtime

  const activeAction = actionById(actions, runtime.actionId)
  const locomotion = actionByType(actions, 'walk') ?? actionByType(actions, 'run')
  const directionAction = locomotion ?? activeAction
  const held = { ...runtime.held, [direction]: pressed }
  const heldOrder = pressed
    ? [...runtime.heldOrder, direction]
    : runtime.heldOrder.filter((heldDirection) => heldDirection !== direction)
  const nextFacing = facingForHeld(held, heldOrder, runtime.movementMode, runtime.facing)
  if (
    pressed &&
    (directionAction === undefined ||
      (runtime.movementMode === 'single' && (direction === 'up' || direction === 'down')) ||
      (framesForFacing(directionAction, nextFacing)?.length ?? 0) === 0)
  ) {
    return runtime
  }

  const isMoving = horizontalAxis(held) !== 0 || verticalAxis(held) !== 0
  const shouldReturnToIdle =
    !isMoving && activeAction !== undefined && isLocomotionAction(activeAction)
  const nextAction = shouldReturnToIdle
    ? actionByType(actions, 'idle')
    : isMoving
      ? locomotion
      : activeAction
  const nextActionId = nextAction?.id ?? runtime.actionId
  const resolvedFacing =
    nextAction === undefined ? nextFacing : facingForAction(nextAction, nextFacing)
  return {
    ...runtime,
    held,
    heldOrder,
    facing: resolvedFacing,
    actionId: nextActionId,
    frameIndex: nextActionId === runtime.actionId ? runtime.frameIndex : 0,
    frameElapsedMs: nextActionId === runtime.actionId ? runtime.frameElapsedMs : 0,
  }
}

export function setDirectionInput(
  runtime: PlaytestRuntime,
  actions: readonly PlaytestAction[],
  direction: Direction,
  pressed: boolean,
): PlaytestRuntime {
  return setMovementInput(runtime, actions, direction, pressed)
}

export function setControlInput(
  runtime: PlaytestRuntime,
  actions: readonly PlaytestAction[],
  bindings: PlaytestActionBindings,
  key: PlaytestControlKey,
  pressed: boolean,
): PlaytestRuntime {
  if (!pressed || bindings[key] === null) return runtime
  const action = actionById(actions, bindings[key])
  if (action === undefined) return runtime
  if (action.id !== runtime.actionId) return selectRuntimeAction(runtime, actions, action.id)
  if (action.loop) return runtime
  return { ...runtime, frameIndex: 0, frameElapsedMs: 0 }
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
  const frames = framesForFacing(action, runtime.facing)
  if (frames === undefined || frames.length === 0) return runtime

  const rawX = isLocomotionAction(action) ? horizontalAxis(runtime.held) : 0
  const rawY = isLocomotionAction(action) ? verticalAxis(runtime.held) : 0
  const magnitude = rawX !== 0 && rawY !== 0 ? Math.SQRT1_2 : 1
  const minY = bounds.minY ?? runtime.y
  const maxY = bounds.maxY ?? runtime.y
  const nextX = Math.min(
    bounds.maxX,
    Math.max(bounds.minX, runtime.x + (rawX * magnitude * movementSpeed * deltaMs) / 1000),
  )
  const nextY = Math.min(
    maxY,
    Math.max(minY, runtime.y + (rawY * magnitude * movementSpeed * deltaMs) / 1000),
  )
  const lastFrameIndex = frames.length - 1
  let frameIndex = Math.min(runtime.frameIndex, lastFrameIndex)
  let frameElapsedMs = runtime.frameElapsedMs + deltaMs

  let currentFrameDurationMs = frameDurationMs(frames, frameIndex)
  while (frameElapsedMs >= currentFrameDurationMs) {
    if (!action.loop && frameIndex === lastFrameIndex) {
      frameElapsedMs = currentFrameDurationMs
      break
    }
    frameElapsedMs -= currentFrameDurationMs
    frameIndex = (frameIndex + 1) % frames.length
    currentFrameDurationMs = frameDurationMs(frames, frameIndex)
  }

  if (
    nextX === runtime.x &&
    nextY === runtime.y &&
    frameIndex === runtime.frameIndex &&
    frameElapsedMs === runtime.frameElapsedMs
  ) {
    return runtime
  }

  return { ...runtime, x: nextX, y: nextY, frameIndex, frameElapsedMs }
}
