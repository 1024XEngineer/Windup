import { useCallback, useEffect, useReducer } from 'react'

import type { FrameRootMotion } from '@/entities/character'

import type { PreviewFrame } from './model/types'

export interface StageOffset {
  x: number
  /** Positive values move the character upward in world coordinates. */
  y: number
}

export interface HorizontalStageBounds {
  minX: number
  maxX: number
}

export interface StageMotionState {
  offset: StageOffset
  /** The latest automatic playback tick already reflected in offset. */
  consumedTick: number
  mirrored: boolean
  bounds: HorizontalStageBounds | null
}

export type StageMotionAction =
  | { type: 'consume-frame'; tick: number; rootMotion: FrameRootMotion | null }
  | { type: 'set-mirrored'; mirrored: boolean }
  | { type: 'set-bounds'; bounds: HorizontalStageBounds | null }
  | { type: 'reset'; baselineTick: number }

export function createStageMotionState(baselineTick = 0): StageMotionState {
  return {
    offset: { x: 0, y: 0 },
    consumedTick: baselineTick,
    mirrored: false,
    bounds: null,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

export function reduceStageMotion(
  state: StageMotionState,
  action: StageMotionAction,
): StageMotionState {
  if (action.type === 'reset') {
    return { ...createStageMotionState(action.baselineTick), bounds: state.bounds }
  }
  if (action.type === 'set-mirrored') return { ...state, mirrored: action.mirrored }
  if (action.type === 'set-bounds') {
    if (action.bounds === null) return { ...state, bounds: null }

    const minX = Math.min(action.bounds.minX, action.bounds.maxX)
    const maxX = Math.max(action.bounds.minX, action.bounds.maxX)
    const x = clamp(state.offset.x, minX, maxX)
    const mirrored = state.offset.x > maxX ? true : state.offset.x < minX ? false : state.mirrored
    return { ...state, offset: { ...state.offset, x }, mirrored, bounds: { minX, maxX } }
  }
  if (action.tick <= state.consumedTick) return state

  const rootMotion = action.rootMotion ?? { dx: 0, dy: 0 }
  const horizontalIncrement = state.mirrored ? -rootMotion.dx : rootMotion.dx
  const candidateX = state.offset.x + horizontalIncrement
  const nextX =
    state.bounds === null ? candidateX : clamp(candidateX, state.bounds.minX, state.bounds.maxX)
  const mirrored =
    state.bounds === null || horizontalIncrement === 0
      ? state.mirrored
      : horizontalIncrement > 0 && candidateX >= state.bounds.maxX
        ? true
        : horizontalIncrement < 0 && candidateX <= state.bounds.minX
          ? false
          : state.mirrored
  return {
    ...state,
    offset: {
      x: nextX,
      y: state.offset.y + rootMotion.dy,
    },
    mirrored,
    consumedTick: action.tick,
  }
}

export interface UseStageMotionInput {
  frame: PreviewFrame | null
  /** Only timed playback contributes root-motion increments. */
  playing: boolean
  /** Monotonically increases only when timed playback advances to a frame. */
  frameTick: number
  /** A character/outfit identity supplied by the owner of the preview. */
  resetKey: string
}

export interface StageMotion {
  offset: StageOffset
  mirrored: boolean
  setMirrored(mirrored: boolean): void
  setBounds(bounds: HorizontalStageBounds | null): void
}

export function useStageMotion({
  frame,
  playing,
  frameTick,
  resetKey,
}: UseStageMotionInput): StageMotion {
  const [state, dispatch] = useReducer(reduceStageMotion, frameTick, createStageMotionState)

  useEffect(() => {
    dispatch({ type: 'reset', baselineTick: frameTick })
    // resetKey deliberately captures the tick at the identity transition only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => {
    if (!playing || frame === null) return
    dispatch({ type: 'consume-frame', tick: frameTick, rootMotion: frame.rootMotion })
  }, [frame, frameTick, playing])

  return {
    offset: state.offset,
    mirrored: state.mirrored,
    setMirrored: useCallback(
      (mirrored: boolean) => dispatch({ type: 'set-mirrored', mirrored }),
      [],
    ),
    setBounds: useCallback(
      (bounds: HorizontalStageBounds | null) => dispatch({ type: 'set-bounds', bounds }),
      [],
    ),
  }
}
