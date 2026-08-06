import { describe, expect, it } from 'vitest'

import type { PlaytestAction } from '../model'
import { advanceRuntime, createRuntime, selectRuntimeAction, setDirectionInput } from './runtime'

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

describe('playtest runtime', () => {
  it('binds walk while a direction is held and returns to idle on release', () => {
    const idle = createRuntime(actions, 'idle')
    const walking = setDirectionInput(idle, actions, 'right', true)
    const released = setDirectionInput(walking, actions, 'right', false)

    expect(walking).toMatchObject({
      actionId: 'walk',
      frameIndex: 0,
      facing: 1,
      held: { left: false, right: true },
    })
    expect(released).toMatchObject({
      actionId: 'idle',
      frameIndex: 0,
      facing: 1,
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

  it('loops a looping action back to its first frame', () => {
    const idle = createRuntime(actions, 'idle')
    const wrapped = advanceRuntime(idle, actions, 50, { minX: 0, maxX: 0 }, 0)
    const looped = [0, 1, 2].reduce(
      (current) => advanceRuntime(current, actions, 50, { minX: 0, maxX: 0 }, 0),
      wrapped,
    )

    expect(looped.frameIndex).toBe(0)
  })

  it('stops a one-shot action on its last frame instead of restarting it', () => {
    const attacking = selectRuntimeAction(createRuntime(actions, null), actions, 'attack')
    const played = [0, 1, 2, 3, 4, 5, 6, 7].reduce(
      (current) => advanceRuntime(current, actions, 50, { minX: 0, maxX: 0 }, 0),
      attacking,
    )

    expect(played.frameIndex).toBe(1)
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
