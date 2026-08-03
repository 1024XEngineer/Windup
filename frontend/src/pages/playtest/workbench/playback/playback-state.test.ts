import { describe, expect, it } from 'vitest'

import type { PreviewAction } from '../model/types'
import {
  createPlaybackState,
  firstFrame,
  lastFrame,
  nextFrame,
  playActionType,
  previousFrame,
  selectAction,
  selectDirection,
  selectFrame,
  toggleLoop,
} from './playback-state'
import * as playbackState from './playback-state'

const actions: readonly PreviewAction[] = [
  {
    id: 'walk',
    name: 'Walk',
    type: 'walk',
    fps: 12,
    sequences: [
      {
        direction: 'south',
        frames: [
          {
            imageUrl: '/walk-s-0.png',
            durationMs: 80,
            rootMotion: null,
            keyFrame: true,
          },
          {
            imageUrl: '/walk-s-1.png',
            durationMs: 160,
            rootMotion: null,
            keyFrame: false,
          },
          {
            imageUrl: '/walk-s-2.png',
            durationMs: 120,
            rootMotion: null,
            keyFrame: false,
          },
        ],
      },
      {
        direction: 'north',
        frames: [
          {
            imageUrl: '/walk-n-0.png',
            durationMs: 100,
            rootMotion: null,
            keyFrame: true,
          },
          {
            imageUrl: '/walk-n-1.png',
            durationMs: 100,
            rootMotion: null,
            keyFrame: false,
          },
        ],
      },
    ],
  },
  {
    id: 'idle',
    name: 'Idle',
    type: 'idle',
    fps: 10,
    sequences: [
      {
        direction: 'default',
        frames: [
          {
            imageUrl: '/idle-0.png',
            durationMs: 100,
            rootMotion: null,
            keyFrame: true,
          },
        ],
      },
    ],
  },
  {
    id: 'jump',
    name: 'Jump',
    type: 'jump',
    fps: 10,
    sequences: [
      {
        direction: 'default',
        frames: [
          {
            imageUrl: '/jump-0.png',
            durationMs: 100,
            rootMotion: { dx: 0, dy: 12 },
            keyFrame: true,
          },
        ],
      },
    ],
  },
  {
    id: 'crouch',
    name: 'Crouch',
    type: 'crouch',
    fps: 10,
    sequences: [
      {
        direction: 'default',
        frames: [
          {
            imageUrl: '/crouch-0.png',
            durationMs: 100,
            rootMotion: null,
            keyFrame: true,
          },
        ],
      },
    ],
  },
]

describe('playback state', () => {
  it('initializes the requested action at its first direction and frame', () => {
    // Catches a regression where initial selection uses a later action, direction, or frame.
    expect(createPlaybackState(actions, 'walk')).toEqual({
      actionId: 'walk',
      direction: 'south',
      frameIndex: 0,
      playing: false,
      loop: true,
    })
  })

  it('switches action or direction by pausing and returning to frame zero', () => {
    // Catches selection preserving stale playback position or playing state.
    const playingWalk = { ...createPlaybackState(actions, 'walk'), frameIndex: 2, playing: true }
    const selectedAction = selectAction(playingWalk, actions, 'idle')
    const selectedDirection = selectDirection({ ...playingWalk, playing: true }, actions, 'north')

    expect(selectedAction).toMatchObject({
      actionId: 'idle',
      direction: 'default',
      frameIndex: 0,
      playing: false,
    })
    expect(selectedDirection).toMatchObject({
      actionId: 'walk',
      direction: 'north',
      frameIndex: 0,
      playing: false,
    })
  })

  it('pauses when a frame is selected manually', () => {
    // Catches a manual scrub continuing the old timer-driven animation.
    const state = selectFrame(
      { ...createPlaybackState(actions, 'walk'), playing: true },
      actions,
      2,
    )

    expect(state).toMatchObject({ frameIndex: 2, playing: false })
  })

  it('clamps at non-looping frame boundaries', () => {
    // Catches non-loop playback wrapping around instead of stopping at the selected edge.
    const start = { ...createPlaybackState(actions, 'walk'), loop: false }
    const end = { ...start, frameIndex: 2, playing: true }

    expect(previousFrame(start, actions)).toMatchObject({ frameIndex: 0, playing: false })
    expect(nextFrame(end, actions)).toMatchObject({ frameIndex: 2, playing: false })
    expect(firstFrame(end, actions)).toMatchObject({ frameIndex: 0, playing: false })
    expect(lastFrame(start, actions)).toMatchObject({ frameIndex: 2, playing: false })
  })

  it('wraps at looping frame boundaries', () => {
    // Catches looping playback sticking on the first or last frame.
    const looped = toggleLoop({ ...createPlaybackState(actions, 'walk'), loop: false })

    expect(previousFrame(looped, actions)).toMatchObject({ frameIndex: 2, playing: false })
    expect(nextFrame({ ...looped, frameIndex: 2 }, actions)).toMatchObject({
      frameIndex: 0,
      playing: false,
    })
  })

  it('returns a safe inactive state for an empty action collection', () => {
    // Catches empty preview data dereferencing a missing action or sequence.
    const state = createPlaybackState([], 'walk')

    expect(state).toEqual({
      actionId: null,
      direction: null,
      frameIndex: 0,
      playing: false,
      loop: true,
    })
    expect(nextFrame(state, [])).toEqual(state)
    expect(selectAction(state, [], 'walk')).toEqual(state)
  })

  it('starts a playable action type at frame zero without changing the loop setting', () => {
    // Catches W/S preserving a stale frame, pausing the target action, or silently changing loop.
    const walk = { ...createPlaybackState(actions, 'walk'), frameIndex: 2, loop: false }
    const jumping = playActionType(walk, actions, 'jump')
    const crouching = playActionType(jumping, actions, 'crouch')

    expect(jumping).toMatchObject({
      actionId: 'jump',
      direction: 'default',
      frameIndex: 0,
      playing: true,
      loop: false,
    })
    expect(crouching).toMatchObject({
      actionId: 'crouch',
      direction: 'default',
      frameIndex: 0,
      playing: true,
      loop: false,
    })
  })

  it('continues a playable current walk without resetting its direction, frame, or loop', () => {
    // Catches A/D restarting an already selected walk instead of only resuming its playback.
    const current = {
      ...createPlaybackState(actions, 'walk'),
      direction: 'north' as const,
      frameIndex: 1,
      playing: false,
      loop: false,
    }
    const continueActionType = (
      playbackState as typeof playbackState & {
        continueActionType?: typeof playActionType
      }
    ).continueActionType

    expect(continueActionType).toBeTypeOf('function')
    expect(continueActionType?.(current, actions, 'walk')).toEqual({ ...current, playing: true })
  })

  it('starts the first playable walk from its first frame when the current action is not walk', () => {
    // Catches A/D trying to resume a non-walk action or selecting a walk sequence with no frames.
    const current = { ...createPlaybackState(actions, 'idle'), frameIndex: 0, loop: false }
    const continueActionType = (
      playbackState as typeof playbackState & {
        continueActionType?: typeof playActionType
      }
    ).continueActionType

    expect(continueActionType?.(current, actions, 'walk')).toMatchObject({
      actionId: 'walk',
      direction: 'south',
      frameIndex: 0,
      playing: true,
      loop: false,
    })
  })

  it('starts the first non-empty sequence of the first playable walk', () => {
    // Catches A/D selecting an empty first direction even though the chosen walk has playable frames.
    const actionsWithEmptyFirstWalkSequence: readonly PreviewAction[] = [
      {
        ...actions[0],
        sequences: [{ direction: 'south', frames: [] }, actions[0].sequences[1]],
      },
      ...actions.slice(1),
    ]
    const continueActionType = (
      playbackState as typeof playbackState & {
        continueActionType?: typeof playActionType
      }
    ).continueActionType

    expect(
      continueActionType?.(
        createPlaybackState(actionsWithEmptyFirstWalkSequence, 'idle'),
        actionsWithEmptyFirstWalkSequence,
        'walk',
      ),
    ).toMatchObject({ actionId: 'walk', direction: 'north', frameIndex: 0, playing: true })
  })

  it('keeps the exact playback state when an action type has no playable frames', () => {
    // Catches a missing W/S target clearing or replacing the action currently under inspection.
    const current = { ...createPlaybackState(actions, 'walk'), frameIndex: 1 }

    expect(playActionType(current, actions, 'attack')).toBe(current)
  })

  it('keeps the exact playback state when a matching action has only empty sequences', () => {
    // Catches type lookup selecting an action that exists but cannot show any frame.
    const current = { ...createPlaybackState(actions, 'walk'), frameIndex: 1, playing: true }
    const actionsWithEmptyAttack: readonly PreviewAction[] = [
      ...actions,
      {
        id: 'attack-empty',
        name: 'Attack',
        type: 'attack',
        fps: 10,
        sequences: [{ direction: 'default', frames: [] }],
      },
    ]

    expect(playActionType(current, actionsWithEmptyAttack, 'attack')).toBe(current)
  })

  it('chooses the first playable action when several actions share a type', () => {
    // Catches type lookup choosing a later matching action instead of the source-order first match.
    const actionsWithSecondJump: readonly PreviewAction[] = [
      ...actions,
      {
        id: 'jump-second',
        name: 'Second jump',
        type: 'jump',
        fps: 10,
        sequences: [
          {
            direction: 'default',
            frames: [
              {
                imageUrl: '/jump-second-0.png',
                durationMs: 100,
                rootMotion: null,
                keyFrame: true,
              },
            ],
          },
        ],
      },
    ]

    expect(
      playActionType(createPlaybackState(actions, 'walk'), actionsWithSecondJump, 'jump'),
    ).toMatchObject({ actionId: 'jump', direction: 'default', frameIndex: 0, playing: true })
  })
})
