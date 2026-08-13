import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PlaytestAction } from '../model'
import {
  advanceRuntime,
  createRuntime,
  selectRuntimeAction,
  setDirectionInput,
  type Direction,
  type StageBounds,
} from './runtime'

const MOVEMENT_SPEED = 150
const MAX_FRAME_DELTA_MS = 50
const INITIAL_BOUNDS: StageBounds = { minX: 0, maxX: 0 }

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

function keyDirection(key: string): Direction | null {
  const normalized = key.toLowerCase()
  if (normalized === 'a' || normalized === 'arrowleft') return 'left'
  if (normalized === 'd' || normalized === 'arrowright') return 'right'
  return null
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
  const preferredUrls = new Set(preferredAction?.frames.map((frame) => frame.imageUrl) ?? [])
  const imageUrls = [
    ...new Set(orderedActions.flatMap((action) => action.frames.map((frame) => frame.imageUrl))),
  ]

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
) {
  const [runtime, setRuntime] = useState(() => createRuntime(actions, initialActionId))
  const actionsRef = useRef(actions)
  const boundsRef = useRef<StageBounds>(INITIAL_BOUNDS)
  const activeInputsRef = useRef(new Map<string, Direction>())
  const preloadedImagesRef = useRef<readonly HTMLImageElement[]>([])
  const initialRuntimeActionId = useMemo(
    () => createRuntime(actions, initialActionId).actionId,
    [actions, initialActionId],
  )

  useEffect(() => {
    actionsRef.current = actions
    activeInputsRef.current.clear()
    setRuntime(createRuntime(actions, initialActionId))
  }, [actions, initialActionId])

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

  const setDirection = useCallback(
    (direction: Direction, pressed: boolean, source: string = direction) => {
      if (pressed) activeInputsRef.current.set(source, direction)
      else activeInputsRef.current.delete(source)

      const stillHeld = [...activeInputsRef.current.values()].includes(direction)
      setRuntime((current) => setDirectionInput(current, actionsRef.current, direction, stillHeld))
    },
    [],
  )

  const clearDirections = useCallback(() => {
    activeInputsRef.current.clear()
    setRuntime((current) => {
      const withoutLeft = setDirectionInput(current, actionsRef.current, 'left', false)
      return setDirectionInput(withoutLeft, actionsRef.current, 'right', false)
    })
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const direction = keyDirection(event.key)
      if (direction === null) return
      event.preventDefault()
      if (event.repeat) return
      setDirection(direction, true, `keyboard:${event.code || event.key}`)
    }
    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      const direction = keyDirection(event.key)
      if (direction === null) return
      event.preventDefault()
      setDirection(direction, false, `keyboard:${event.code || event.key}`)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearDirections)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearDirections)
    }
  }, [clearDirections, setDirection])

  const selectAction = useCallback((actionId: string) => {
    setRuntime((current) => selectRuntimeAction(current, actionsRef.current, actionId))
  }, [])

  const setBounds = useCallback((bounds: StageBounds) => {
    boundsRef.current = bounds
    setRuntime((current) => ({
      ...current,
      x: Math.min(bounds.maxX, Math.max(bounds.minX, current.x)),
    }))
  }, [])

  const action = useMemo(
    () => actions.find((candidate) => candidate.id === runtime.actionId) ?? null,
    [actions, runtime.actionId],
  )
  const frame = action?.frames[runtime.frameIndex] ?? action?.frames[0] ?? null

  return {
    runtime,
    action,
    frame,
    selectAction,
    setDirection,
    setBounds,
  }
}
