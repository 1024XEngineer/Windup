import { useCallback, useEffect, useState } from 'react'

import type {
  PlaytestActionType,
  PlaytestDirection,
  PreviewAction,
  PreviewFrame,
  PreviewSequence,
} from '../model/types'
import {
  createPlaybackState,
  continueActionType,
  firstFrame,
  lastFrame,
  nextFrame,
  playActionType,
  previousFrame,
  selectAction,
  selectDirection,
  selectFrame,
  selectedAction,
  selectedSequence,
  toggleLoop,
  togglePlaying,
  type PlaybackState,
} from './playback-state'

export interface PlaybackController {
  state: PlaybackState
  frameTick: number
  action: PreviewAction | null
  sequence: PreviewSequence | null
  frame: PreviewFrame | null
  playActionType(type: PlaytestActionType): void
  continueActionType(type: PlaytestActionType): void
  selectAction(actionId: string): void
  selectDirection(direction: PlaytestDirection): void
  selectFrame(index: number): void
  previousFrame(): void
  nextFrame(): void
  firstFrame(): void
  lastFrame(): void
  togglePlaying(): void
  toggleLoop(): void
}

export function usePlaybackController(
  actions: readonly PreviewAction[],
  initialActionId: string | null,
): PlaybackController {
  const [state, setState] = useState(() => createPlaybackState(actions, initialActionId))
  const [frameTick, setFrameTick] = useState(0)
  const action = selectedAction(actions, state.actionId)
  const sequence = selectedSequence(actions, state)
  const frame = sequence?.frames[state.frameIndex] ?? null

  useEffect(() => {
    if (!state.playing || frame === null) return

    const timeoutId = window.setTimeout(() => {
      const finalFrameIndex = (sequence?.frames.length ?? 1) - 1
      if (state.loop || state.frameIndex < finalFrameIndex) {
        setFrameTick((tick) => tick + 1)
      }
      setState((current) => {
        const currentSequence = selectedSequence(actions, current)
        const currentFinalFrameIndex = (currentSequence?.frames.length ?? 1) - 1
        const advanced = nextFrame(current, actions)

        if (!current.loop && current.frameIndex >= currentFinalFrameIndex) return advanced
        return { ...advanced, playing: true }
      })
    }, frame.durationMs)

    return () => window.clearTimeout(timeoutId)
  }, [actions, frame, sequence, state.frameIndex, state.loop, state.playing])

  const chooseAction = useCallback(
    (actionId: string) => {
      setState((current) => selectAction(current, actions, actionId))
    },
    [actions],
  )

  const chooseActionType = useCallback(
    (type: PlaytestActionType) => {
      setState((current) => playActionType(current, actions, type))
    },
    [actions],
  )

  const continueAction = useCallback(
    (type: PlaytestActionType) => {
      setState((current) => continueActionType(current, actions, type))
    },
    [actions],
  )

  const chooseDirection = useCallback(
    (direction: PlaytestDirection) => {
      setState((current) => selectDirection(current, actions, direction))
    },
    [actions],
  )

  const chooseFrame = useCallback(
    (index: number) => {
      setState((current) => selectFrame(current, actions, index))
    },
    [actions],
  )

  const choosePreviousFrame = useCallback(() => {
    setState((current) => previousFrame(current, actions))
  }, [actions])

  const chooseNextFrame = useCallback(() => {
    setState((current) => nextFrame(current, actions))
  }, [actions])

  const chooseFirstFrame = useCallback(() => {
    setState((current) => firstFrame(current, actions))
  }, [actions])

  const chooseLastFrame = useCallback(() => {
    setState((current) => lastFrame(current, actions))
  }, [actions])

  const choosePlaying = useCallback(() => {
    setState((current) => togglePlaying(current, actions))
  }, [actions])

  const chooseLoop = useCallback(() => {
    setState((current) => toggleLoop(current))
  }, [])

  return {
    state,
    frameTick,
    action,
    sequence,
    frame,
    playActionType: chooseActionType,
    continueActionType: continueAction,
    selectAction: chooseAction,
    selectDirection: chooseDirection,
    selectFrame: chooseFrame,
    previousFrame: choosePreviousFrame,
    nextFrame: chooseNextFrame,
    firstFrame: chooseFirstFrame,
    lastFrame: chooseLastFrame,
    togglePlaying: choosePlaying,
    toggleLoop: chooseLoop,
  }
}
