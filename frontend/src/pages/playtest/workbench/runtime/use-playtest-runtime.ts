import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DirectionalMovement } from '@/entities'

import {
  createDefaultActionBindings,
  type PlaytestActionBindings,
  type PlaytestControlKey,
} from '../bindings'
import type { PlaytestAction } from '../model'
import {
  advanceRuntime,
  createRuntime,
  playbackForFacing,
  selectRuntimeAction,
  setControlInput,
  setMovementInput,
  type Direction,
  type MovementDirection,
  type StageBounds,
} from './runtime'

const MOVEMENT_SPEED = 150
const MAX_FRAME_DELTA_MS = 50
const INITIAL_BOUNDS: StageBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
const MOVEMENT_DIRECTIONS: readonly MovementDirection[] = ['up', 'down', 'left', 'right']

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

function keyboardInput(key: string, code: string): MovementDirection | PlaytestControlKey | null {
  const normalized = key.toLowerCase()
  if (normalized === 'arrowleft' || normalized === 'a') return 'left'
  if (normalized === 'arrowright' || normalized === 'd') return 'right'
  if (normalized === 'arrowup' || normalized === 'w') return 'up'
  if (normalized === 'arrowdown' || normalized === 's') return 'down'
  if (code === 'Space' || key === ' ' || normalized === 'spacebar') return 'space'
  if (code === 'ShiftLeft' || code === 'ShiftRight' || normalized === 'shift') return 'shift'
  return null
}

function isMovementDirection(
  input: MovementDirection | PlaytestControlKey,
): input is MovementDirection {
  return MOVEMENT_DIRECTIONS.includes(input as MovementDirection)
}

function actionImageUrls(action: PlaytestAction): readonly string[] {
  return [
    ...action.frames.map((frame) => frame.imageUrl),
    ...Object.values(action.sequences ?? {}).flatMap(
      (playback) => playback?.frames.map((frame) => frame.imageUrl) ?? [],
    ),
  ]
}

export function preloadActionFrames(
  actions: readonly PlaytestAction[],
  preferredActionId: string | null,
  createImage?: () => HTMLImageElement,
): readonly HTMLImageElement[] {
  const imageFactory = createImage ?? (typeof Image === 'undefined' ? null : () => new Image())
  if (imageFactory === null) return []

  const preferredAction = actions.find((action) => action.id === preferredActionId)
  const orderedActions = preferredAction
    ? [preferredAction, ...actions.filter((action) => action.id !== preferredAction.id)]
    : actions
  const preferredUrls = new Set(
    preferredAction === undefined ? [] : actionImageUrls(preferredAction),
  )
  const imageUrls = [...new Set(orderedActions.flatMap(actionImageUrls))]

  return imageUrls.map((imageUrl) => {
    const image = imageFactory()
    image.decoding = 'async'
    image.fetchPriority = preferredUrls.has(imageUrl) ? 'high' : 'low'
    image.src = imageUrl
    if (typeof image.decode === 'function') void image.decode().catch(() => undefined)
    return image
  })
}

export function usePlaytestRuntime(
  actions: readonly PlaytestAction[],
  initialActionId: string | null,
  movementMode: DirectionalMovement = 'single',
  bindings?: PlaytestActionBindings,
) {
  const effectiveBindings = useMemo(
    () => bindings ?? createDefaultActionBindings(actions),
    [actions, bindings],
  )
  const [runtime, setRuntime] = useState(() =>
    createRuntime(actions, initialActionId, movementMode),
  )
  const actionsRef = useRef(actions)
  const bindingsRef = useRef(effectiveBindings)
  const boundsRef = useRef<StageBounds>(INITIAL_BOUNDS)
  const activeInputsRef = useRef(new Map<string, MovementDirection>())
  const preloadedImagesRef = useRef<readonly HTMLImageElement[]>([])
  const initialRuntimeActionId = useMemo(
    () => createRuntime(actions, initialActionId, movementMode).actionId,
    [actions, initialActionId, movementMode],
  )

  useEffect(() => {
    actionsRef.current = actions
    activeInputsRef.current.clear()
    setRuntime(createRuntime(actions, initialActionId, movementMode))
  }, [actions, initialActionId, movementMode])

  useEffect(() => {
    bindingsRef.current = effectiveBindings
  }, [effectiveBindings])

  useEffect(() => {
    preloadedImagesRef.current = preloadActionFrames(actions, initialRuntimeActionId)
    return () => {
      preloadedImagesRef.current = []
    }
  }, [actions, initialRuntimeActionId])

  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return

    let animationFrame = 0
    let previousTime: number | null = null
    const tick = (time: number) => {
      if (previousTime !== null) {
        const deltaMs = Math.min(time - previousTime, MAX_FRAME_DELTA_MS)
        setRuntime((current) =>
          advanceRuntime(current, actionsRef.current, deltaMs, boundsRef.current, MOVEMENT_SPEED),
        )
      }
      previousTime = time
      animationFrame = requestAnimationFrame(tick)
    }

    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [])

  const setControl = useCallback(
    (key: PlaytestControlKey, pressed: boolean, _source: string = key) => {
      setRuntime((current) =>
        setControlInput(current, actionsRef.current, bindingsRef.current, key, pressed),
      )
    },
    [],
  )

  const setMovement = useCallback(
    (direction: MovementDirection, pressed: boolean, source: string = direction) => {
      if (pressed) activeInputsRef.current.set(source, direction)
      else activeInputsRef.current.delete(source)
      const stillHeld = [...activeInputsRef.current.values()].includes(direction)
      setRuntime((current) => setMovementInput(current, actionsRef.current, direction, stillHeld))
    },
    [],
  )

  const setDirection = useCallback(
    (direction: Direction, pressed: boolean, source: string = direction) => {
      setMovement(direction, pressed, source)
    },
    [setMovement],
  )

  const clearDirections = useCallback(() => {
    activeInputsRef.current.clear()
    setRuntime((current) =>
      MOVEMENT_DIRECTIONS.reduce(
        (next, direction) => setMovementInput(next, actionsRef.current, direction, false),
        current,
      ),
    )
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const input = keyboardInput(event.key, event.code)
      if (input === null) return
      event.preventDefault()
      if (event.repeat) return
      const source = `keyboard:${event.code || event.key}`
      if (isMovementDirection(input)) setMovement(input, true, source)
      else setControl(input, true, source)
    }
    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      const input = keyboardInput(event.key, event.code)
      if (input === null) return
      event.preventDefault()
      const source = `keyboard:${event.code || event.key}`
      if (isMovementDirection(input)) setMovement(input, false, source)
      else setControl(input, false, source)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearDirections)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearDirections)
    }
  }, [clearDirections, setControl, setMovement])

  const selectAction = useCallback((actionId: string) => {
    setRuntime((current) => selectRuntimeAction(current, actionsRef.current, actionId))
  }, [])

  const setBounds = useCallback((bounds: StageBounds) => {
    boundsRef.current = bounds
    setRuntime((current) => ({
      ...current,
      x: Math.min(bounds.maxX, Math.max(bounds.minX, current.x)),
      y: Math.min(bounds.maxY ?? current.y, Math.max(bounds.minY ?? current.y, current.y)),
    }))
  }, [])

  const action = useMemo(
    () => actions.find((candidate) => candidate.id === runtime.actionId) ?? null,
    [actions, runtime.actionId],
  )
  const playback = action === null ? undefined : playbackForFacing(action, runtime.facing)
  const frame = playback?.frames[runtime.frameIndex] ?? playback?.frames[0] ?? null

  return {
    runtime,
    action,
    frame,
    mirrorX: playback?.mirrorX ?? false,
    selectAction,
    setControl,
    setDirection,
    setMovement,
    setBounds,
  }
}
