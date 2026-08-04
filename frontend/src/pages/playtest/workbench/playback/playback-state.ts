import type {
  PlaytestActionType,
  PlaytestDirection,
  PreviewAction,
  PreviewSequence,
} from '../model/types'

export interface PlaybackState {
  actionId: string | null
  direction: PlaytestDirection | null
  frameIndex: number
  playing: boolean
  loop: boolean
}

export function selectedAction(
  actions: readonly PreviewAction[],
  actionId: string | null,
): PreviewAction | null {
  return actions.find((action) => action.id === actionId) ?? null
}

export function selectedSequence(
  actions: readonly PreviewAction[],
  state: PlaybackState,
): PreviewSequence | null {
  const action = selectedAction(actions, state.actionId)
  return action?.sequences.find((sequence) => sequence.direction === state.direction) ?? null
}

function initialStateFor(action: PreviewAction | null, loop: boolean): PlaybackState {
  return {
    actionId: action?.id ?? null,
    direction: action?.sequences[0]?.direction ?? null,
    frameIndex: 0,
    playing: false,
    loop,
  }
}

function initialPlayableStateFor(action: PreviewAction, loop: boolean): PlaybackState {
  const sequence = action.sequences.find((candidate) => candidate.frames.length > 0)
  return {
    actionId: action.id,
    direction: sequence?.direction ?? null,
    frameIndex: 0,
    playing: true,
    loop,
  }
}

function frameCount(actions: readonly PreviewAction[], state: PlaybackState): number {
  return selectedSequence(actions, state)?.frames.length ?? 0
}

export function createPlaybackState(
  actions: readonly PreviewAction[],
  initialActionId: string | null,
): PlaybackState {
  return initialStateFor(selectedAction(actions, initialActionId) ?? actions[0] ?? null, true)
}

export function selectAction(
  state: PlaybackState,
  actions: readonly PreviewAction[],
  actionId: string,
): PlaybackState {
  const action = selectedAction(actions, actionId)
  return action === null ? state : initialStateFor(action, state.loop)
}

export function playActionType(
  state: PlaybackState,
  actions: readonly PreviewAction[],
  type: PlaytestActionType,
): PlaybackState {
  const action = actions.find(
    (candidate) =>
      candidate.type === type && candidate.sequences.some((sequence) => sequence.frames.length > 0),
  )
  return action === undefined ? state : initialPlayableStateFor(action, state.loop)
}

export function continueActionType(
  state: PlaybackState,
  actions: readonly PreviewAction[],
  type: PlaytestActionType,
): PlaybackState {
  const action = selectedAction(actions, state.actionId)
  if (action?.type === type && frameCount(actions, state) > 0) {
    return { ...state, playing: true }
  }

  return playActionType(state, actions, type)
}

export function selectDirection(
  state: PlaybackState,
  actions: readonly PreviewAction[],
  direction: PlaytestDirection,
): PlaybackState {
  const action = selectedAction(actions, state.actionId)
  if (action?.sequences.some((sequence) => sequence.direction === direction) !== true) return state

  return { ...state, direction, frameIndex: 0, playing: false }
}

export function selectFrame(
  state: PlaybackState,
  actions: readonly PreviewAction[],
  index: number,
): PlaybackState {
  const count = frameCount(actions, state)
  if (count === 0) return { ...state, frameIndex: 0, playing: false }

  return { ...state, frameIndex: Math.min(Math.max(index, 0), count - 1), playing: false }
}

export function previousFrame(
  state: PlaybackState,
  actions: readonly PreviewAction[],
): PlaybackState {
  const count = frameCount(actions, state)
  if (count === 0) return { ...state, frameIndex: 0, playing: false }
  if (state.frameIndex > 0) return { ...state, frameIndex: state.frameIndex - 1, playing: false }
  return { ...state, frameIndex: state.loop ? count - 1 : 0, playing: false }
}

export function nextFrame(state: PlaybackState, actions: readonly PreviewAction[]): PlaybackState {
  const count = frameCount(actions, state)
  if (count === 0) return { ...state, frameIndex: 0, playing: false }
  if (state.frameIndex < count - 1)
    return { ...state, frameIndex: state.frameIndex + 1, playing: false }
  return { ...state, frameIndex: state.loop ? 0 : count - 1, playing: false }
}

export function firstFrame(state: PlaybackState, actions: readonly PreviewAction[]): PlaybackState {
  return selectFrame(state, actions, 0)
}

export function lastFrame(state: PlaybackState, actions: readonly PreviewAction[]): PlaybackState {
  return selectFrame(state, actions, frameCount(actions, state) - 1)
}

export function togglePlaying(
  state: PlaybackState,
  actions: readonly PreviewAction[],
): PlaybackState {
  if (frameCount(actions, state) === 0) return { ...state, playing: false }
  return { ...state, playing: !state.playing }
}

export function toggleLoop(state: PlaybackState): PlaybackState {
  return { ...state, loop: !state.loop }
}
