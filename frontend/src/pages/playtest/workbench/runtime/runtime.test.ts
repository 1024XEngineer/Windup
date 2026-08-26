import { describe, expect, it } from 'vitest'

import type { PlaytestActionBindings } from '../bindings'
import type { PlaytestAction } from '../model'
import {
  advanceRuntime,
  createRuntime,
  framesForFacing,
  selectRuntimeAction,
  setControlInput,
  setDirectionInput,
  setMovementInput,
} from './runtime'

const actions: readonly PlaytestAction[] = [
  {
    id: 'idle',
    name: '待机',
    type: 'idle',
    loop: true,
    frames: [
      { imageUrl: '/idle-1.png', durationMs: 100 },
      { imageUrl: '/idle-2.png', durationMs: 100 },
    ],
  },
  {
    id: 'walk',
    name: '行走',
    type: 'walk',
    loop: true,
    frames: [
      { imageUrl: '/walk-1.png', durationMs: 80 },
      { imageUrl: '/walk-2.png', durationMs: 120 },
    ],
  },
  {
    id: 'attack',
    name: '攻击',
    type: 'attack',
    loop: false,
    frames: [
      { imageUrl: '/attack-1.png', durationMs: 150 },
      { imageUrl: '/attack-2.png', durationMs: 150 },
    ],
  },
]

const bindings: PlaytestActionBindings = {
  space: 'attack',
  shift: null,
}

const directionalActions: readonly PlaytestAction[] = actions.map((action) =>
  action.id === 'walk'
    ? {
        ...action,
        sequences: {
          east: { frames: action.frames, sourceDirection: 'east', mirrorX: false },
          west: { frames: action.frames, sourceDirection: 'east', mirrorX: true },
          north: {
            frames: [
              { imageUrl: '/walk-north-1.png', durationMs: 80 },
              { imageUrl: '/walk-north-2.png', durationMs: 120 },
            ],
            sourceDirection: 'north',
            mirrorX: false,
          },
          south: {
            frames: [
              { imageUrl: '/walk-south-1.png', durationMs: 80 },
              { imageUrl: '/walk-south-2.png', durationMs: 120 },
            ],
            sourceDirection: 'south',
            mirrorX: false,
          },
          north_east: {
            frames: [{ imageUrl: '/walk-north-east.png', durationMs: 100 }],
            sourceDirection: 'north_east',
            mirrorX: false,
          },
          north_west: {
            frames: [{ imageUrl: '/walk-north-east.png', durationMs: 100 }],
            sourceDirection: 'north_east',
            mirrorX: true,
          },
          south_east: {
            frames: [{ imageUrl: '/walk-south-east.png', durationMs: 100 }],
            sourceDirection: 'south_east',
            mirrorX: false,
          },
          south_west: {
            frames: [{ imageUrl: '/walk-south-east.png', durationMs: 100 }],
            sourceDirection: 'south_east',
            mirrorX: true,
          },
        },
      }
    : {
        ...action,
        sequences: {
          east: { frames: action.frames, sourceDirection: 'east', mirrorX: false },
          west: { frames: action.frames, sourceDirection: 'east', mirrorX: true },
        },
      },
)

describe('playtest runtime', () => {
  it('moves diagonally at the cardinal speed and selects the last pressed direction', () => {
    const idle = createRuntime(directionalActions, 'idle', 'four-way')
    const right = setMovementInput(idle, directionalActions, 'right', true)
    const upRight = setMovementInput(right, directionalActions, 'up', true)
    const advanced = advanceRuntime(
      upRight,
      directionalActions,
      100,
      { minX: -100, maxX: 100, minY: -100, maxY: 100 },
      150,
    )

    expect(advanced.x).toBeCloseTo(10.607, 3)
    expect(advanced.y).toBeCloseTo(-10.607, 3)
    expect(advanced).toMatchObject({ facing: 'north', held: { right: true, up: true } })
  })

  it('returns to the most recently pressed direction that is still held', () => {
    const left = setMovementInput(
      createRuntime(directionalActions, 'idle', 'four-way'),
      directionalActions,
      'left',
      true,
    )
    const up = setMovementInput(left, directionalActions, 'up', true)
    const right = setMovementInput(up, directionalActions, 'right', true)
    const released = setMovementInput(right, directionalActions, 'right', false)

    expect(released).toMatchObject({
      facing: 'north',
      held: { left: true, up: true, right: false },
      heldOrder: ['left', 'up'],
    })
  })

  it('resolves horizontal mirror playback and independent north/south frames', () => {
    const walk = directionalActions.find((action) => action.id === 'walk')!

    expect(framesForFacing(walk, 'west')).toBe(walk.sequences?.west?.frames)
    expect(framesForFacing(walk, 'east')).toBe(walk.sequences?.east?.frames)
    expect(framesForFacing(walk, 'north')?.[0]?.imageUrl).toBe('/walk-north-1.png')
    expect(framesForFacing(walk, 'south')?.[0]?.imageUrl).toBe('/walk-south-1.png')
  })

  it('keeps animation progress when movement changes to another available direction', () => {
    const walking = setMovementInput(
      createRuntime(directionalActions, 'walk', 'four-way'),
      directionalActions,
      'right',
      true,
    )
    const advanced = advanceRuntime(
      walking,
      directionalActions,
      90,
      { minX: -100, maxX: 100, minY: -100, maxY: 100 },
      0,
    )
    const turned = setMovementInput(advanced, directionalActions, 'down', true)

    expect(turned).toMatchObject({ facing: 'south', frameIndex: 1, frameElapsedMs: 10 })
  })

  it('does not accept vertical movement in a single-direction project', () => {
    const sideOnly = createRuntime(actions, 'walk')

    expect(setMovementInput(sideOnly, actions, 'up', true)).toBe(sideOnly)
    expect(setMovementInput(sideOnly, actions, 'down', true)).toBe(sideOnly)
  })

  it('accepts an action whose only playable frames are directional', () => {
    const northOnly: readonly PlaytestAction[] = [
      {
        id: 'north-idle',
        name: '向上待机',
        type: 'idle',
        loop: true,
        frames: [],
        sequences: {
          north: {
            frames: [{ imageUrl: '/north-idle.png', durationMs: 100 }],
            sourceDirection: 'north',
            mirrorX: false,
          },
        },
      },
    ]

    const runtime = createRuntime(northOnly, 'north-idle', 'four-way')

    expect(runtime).toMatchObject({ actionId: 'north-idle', facing: 'north' })
    expect(framesForFacing(northOnly[0]!, runtime.facing)).toEqual([
      { imageUrl: '/north-idle.png', durationMs: 100 },
    ])
  })

  it('keeps the current action and facing when the selected action lacks that direction', () => {
    const sideOnlyAction: PlaytestAction = {
      id: 'side-attack',
      name: '侧向攻击',
      type: 'attack',
      loop: false,
      frames: [{ imageUrl: '/attack-side.png', durationMs: 100 }],
      sequences: {
        east: {
          frames: [{ imageUrl: '/attack-side.png', durationMs: 100 }],
          sourceDirection: 'east',
          mirrorX: false,
        },
        west: {
          frames: [{ imageUrl: '/attack-side.png', durationMs: 100 }],
          sourceDirection: 'east',
          mirrorX: true,
        },
      },
    }
    const actionSet = [...actions, sideOnlyAction]
    const current = { ...createRuntime(actionSet, 'idle', 'four-way'), facing: 'north' as const }

    const selected = selectRuntimeAction(current, actionSet, 'side-attack')

    expect(selected).toBe(current)
    expect(selected).toMatchObject({ actionId: 'idle', facing: 'north' })
  })

  it('does not treat a directional-only action as a side action', () => {
    const northOnly: PlaytestAction = {
      id: 'north-only',
      name: '仅向上攻击',
      type: 'attack',
      loop: false,
      frames: [{ imageUrl: '/attack-north.png', durationMs: 100 }],
      sequences: {
        north: {
          frames: [{ imageUrl: '/attack-north.png', durationMs: 100 }],
          sourceDirection: 'north',
          mirrorX: false,
        },
      },
    }

    expect(framesForFacing(northOnly, 'north')).toEqual([
      { imageUrl: '/attack-north.png', durationMs: 100 },
    ])
    expect(framesForFacing(northOnly, 'east')).toBeUndefined()
    expect(framesForFacing(northOnly, 'west')).toBeUndefined()
  })

  it('uses a diagonal facing in eight-way mode and falls back after key release', () => {
    const idle = createRuntime(directionalActions, 'idle', 'eight-way')
    const right = setMovementInput(idle, directionalActions, 'right', true)
    const diagonal = setMovementInput(right, directionalActions, 'up', true)
    const north = setMovementInput(diagonal, directionalActions, 'right', false)

    expect(diagonal).toMatchObject({ facing: 'north_east', held: { right: true, up: true } })
    expect(framesForFacing(directionalActions[1]!, diagonal.facing)?.[0]?.imageUrl).toBe(
      '/walk-north-east.png',
    )
    expect(north).toMatchObject({ facing: 'north', held: { right: false, up: true } })
  })

  it('resolves the mirrored south-west facing in eight-way mode', () => {
    const idle = createRuntime(directionalActions, 'idle', 'eight-way')
    const left = setMovementInput(idle, directionalActions, 'left', true)
    const diagonal = setMovementInput(left, directionalActions, 'down', true)

    expect(diagonal).toMatchObject({ facing: 'south_west', held: { left: true, down: true } })
    expect(framesForFacing(directionalActions[1]!, diagonal.facing)?.[0]?.imageUrl).toBe(
      '/walk-south-east.png',
    )
  })

  it('resolves north-west and cardinal south in eight-way mode', () => {
    const idle = createRuntime(directionalActions, 'idle', 'eight-way')
    const left = setMovementInput(idle, directionalActions, 'left', true)
    const northWest = setMovementInput(left, directionalActions, 'up', true)
    const south = setMovementInput(idle, directionalActions, 'down', true)

    expect(northWest.facing).toBe('north_west')
    expect(south.facing).toBe('south')
  })

  it('ignores empty directional entries and refuses to advance without facing playback', () => {
    const empty: PlaytestAction = {
      id: 'empty',
      name: '空动作',
      type: 'idle',
      loop: true,
      frames: [],
      sequences: { north: undefined },
    }
    expect(createRuntime([empty], 'empty', 'four-way').actionId).toBeNull()

    const sideOnly: PlaytestAction = {
      ...actions[1]!,
      sequences: {
        east: { frames: actions[1]!.frames, sourceDirection: 'east', mirrorX: false },
        west: { frames: actions[1]!.frames, sourceDirection: 'east', mirrorX: true },
      },
    }
    const northFacing = {
      ...createRuntime([sideOnly], 'walk', 'four-way'),
      facing: 'north' as const,
    }

    expect(advanceRuntime(northFacing, [sideOnly], 16, { minX: -10, maxX: 10 }, 100)).toBe(
      northFacing,
    )
  })

  it('binds walk while a direction is held and returns to idle on release', () => {
    const idle = createRuntime(actions, 'idle')
    const walking = setDirectionInput(idle, actions, 'right', true)
    const released = setDirectionInput(walking, actions, 'right', false)

    expect(walking).toMatchObject({
      actionId: 'walk',
      frameIndex: 0,
      facing: 'east',
      held: { left: false, right: true },
    })
    expect(released).toMatchObject({
      actionId: 'idle',
      frameIndex: 0,
      facing: 'east',
      held: { left: false, right: false },
    })
  })

  it('moves continuously from elapsed time while animation uses its own frame durations', () => {
    const walking = setDirectionInput(createRuntime(actions, 'idle'), actions, 'right', true)
    const firstTick = advanceRuntime(walking, actions, 40, { minX: -100, maxX: 100 }, 150)
    const secondTick = advanceRuntime(firstTick, actions, 40, { minX: -100, maxX: 100 }, 150)

    expect(firstTick).toMatchObject({ x: 6, frameIndex: 0, frameElapsedMs: 40 })
    expect(secondTick).toMatchObject({ x: 12, frameIndex: 1, frameElapsedMs: 0 })
  })

  it('moves with a custom action explicitly marked as locomotion', () => {
    const rollingActions: readonly PlaytestAction[] = [
      actions[0]!,
      {
        id: 'roll-forward',
        name: '向前翻滚',
        type: 'custom',
        locomotion: true,
        loop: true,
        frames: [{ imageUrl: '/roll-1.png', durationMs: 100 }],
      },
    ]
    const rolling = setMovementInput(
      createRuntime(rollingActions, 'idle'),
      rollingActions,
      'right',
      true,
    )
    const advanced = advanceRuntime(rolling, rollingActions, 100, { minX: -100, maxX: 100 }, 150)

    expect(advanced).toMatchObject({ actionId: 'roll-forward', x: 15 })
  })

  it('turns without moving when the active action is not walk or run', () => {
    const nonLocomotionActions = actions.filter((action) => action.type !== 'walk')
    const attacking = selectRuntimeAction(
      createRuntime(nonLocomotionActions, 'idle'),
      nonLocomotionActions,
      'attack',
    )
    const facingLeft = setDirectionInput(attacking, nonLocomotionActions, 'left', true)
    const advanced = advanceRuntime(
      facingLeft,
      nonLocomotionActions,
      100,
      { minX: -100, maxX: 100 },
      150,
    )

    expect(advanced).toMatchObject({ x: 0, facing: 'west', actionId: 'attack' })
  })

  it('keeps A and D reserved for movement outside the action binding contract', () => {
    const walkingLeft = setMovementInput(createRuntime(actions, 'idle'), actions, 'left', true)
    const advanced = advanceRuntime(walkingLeft, actions, 100, { minX: -100, maxX: 100 }, 150)

    expect(advanced).toMatchObject({ actionId: 'walk', facing: 'west', x: -15 })
  })

  it('triggers an assigned vertical action and ignores an unassigned control', () => {
    const idle = createRuntime(actions, 'idle')
    const attacking = setControlInput(idle, actions, bindings, 'space', true)

    expect(attacking).toMatchObject({ actionId: 'attack', frameIndex: 0 })
    expect(setControlInput(idle, actions, bindings, 'shift', true)).toBe(idle)
    expect(setControlInput(attacking, actions, bindings, 'space', false)).toBe(attacking)
    expect(setControlInput(idle, actions, { ...bindings, space: 'missing' }, 'space', true)).toBe(
      idle,
    )
    expect(setControlInput(idle, actions, { ...bindings, space: 'idle' }, 'space', true)).toBe(idle)
  })

  it('restarts a completed one-shot action when its assigned key is pressed again', () => {
    const attacking = setControlInput(
      createRuntime(actions, 'idle'),
      actions,
      bindings,
      'space',
      true,
    )
    const completed = advanceRuntime(attacking, actions, 400, { minX: -100, maxX: 100 }, 150)
    const restarted = setControlInput(completed, actions, bindings, 'space', true)

    expect(completed).toMatchObject({ actionId: 'attack', frameIndex: 1, frameElapsedMs: 150 })
    expect(restarted).toMatchObject({ actionId: 'attack', frameIndex: 0, frameElapsedMs: 0 })
  })

  it('loops a looping action back to its first frame', () => {
    const idle = createRuntime(actions, 'idle')
    const wrapped = advanceRuntime(idle, actions, 50, { minX: 0, maxX: 0 }, 0)
    const looped = [0, 1, 2].reduce(
      (current) => advanceRuntime(current, actions, 50, { minX: 0, maxX: 0 }, 0),
      wrapped,
    )

    expect(looped.frameIndex).toBe(0)
  })

  it('clamps zero duration frames inside the playback loop', () => {
    const zeroDurationActions: readonly PlaytestAction[] = [
      {
        id: 'idle',
        name: '待机',
        type: 'idle',
        loop: true,
        frames: [
          { imageUrl: '/idle-1.png', durationMs: 0 },
          { imageUrl: '/idle-2.png', durationMs: 100 },
        ],
      },
    ]
    const advanced = advanceRuntime(
      createRuntime(zeroDurationActions, 'idle'),
      zeroDurationActions,
      5,
      { minX: 0, maxX: 0 },
      0,
    )

    expect(advanced).toMatchObject({ frameIndex: 1, frameElapsedMs: 4 })
  })

  it('stops a one-shot action on its last frame instead of restarting it', () => {
    const attacking = selectRuntimeAction(createRuntime(actions, null), actions, 'attack')
    const played = [0, 1, 2, 3, 4, 5, 6, 7].reduce(
      (current) => advanceRuntime(current, actions, 50, { minX: 0, maxX: 0 }, 0),
      attacking,
    )

    expect(played.frameIndex).toBe(1)
  })

  it('keeps the same runtime reference when a stopped one-shot action does not change', () => {
    const stopped = {
      ...selectRuntimeAction(createRuntime(actions, null), actions, 'attack'),
      frameIndex: 1,
      frameElapsedMs: 150,
    }

    expect(advanceRuntime(stopped, actions, 50, { minX: 0, maxX: 0 }, 0)).toBe(stopped)
  })

  it('keeps every bound action directly selectable without extra playback state', () => {
    const selected = selectRuntimeAction(createRuntime(actions, null), actions, 'attack')

    expect(selected).toMatchObject({
      actionId: 'attack',
      frameIndex: 0,
      frameElapsedMs: 0,
    })
  })
})
