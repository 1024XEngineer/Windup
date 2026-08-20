import { describe, expect, it } from 'vitest'

import type { PlaytestAction } from './model'
import { createDefaultActionBindings } from './bindings'

function action(id: string, type: string): PlaytestAction {
  return {
    id,
    name: id,
    type,
    loop: true,
    frames: [{ imageUrl: `/${id}.png`, durationMs: 100 }],
  }
}

describe('playtest action bindings', () => {
  it('binds jump and crouch actions without putting movement keys in the assignment model', () => {
    const actions = [
      action('idle', 'idle'),
      action('walk', 'walk'),
      action('jump', 'jump'),
      action('crouch', 'crouch'),
    ]

    expect(createDefaultActionBindings(actions)).toEqual({
      space: 'jump',
      shift: 'crouch',
    })
  })

  it('leaves unsupported action controls unassigned', () => {
    const actions = [action('run', 'run'), action('custom-crouch', 'custom')]

    expect(createDefaultActionBindings(actions)).toEqual({
      space: null,
      shift: null,
    })
  })

  it('binds actions whose playable frames only exist in directional sequences', () => {
    const directionalFrame = { imageUrl: '/north.png', durationMs: 100 }
    const jump = {
      ...action('directional-jump', 'jump'),
      frames: [],
      sequences: {
        north: {
          frames: [directionalFrame],
          sourceDirection: 'north' as const,
          mirrorX: false,
        },
      },
    }
    const crouch = {
      ...action('directional-crouch', 'crouch'),
      frames: [],
      sequences: {
        south: {
          frames: [directionalFrame],
          sourceDirection: 'south' as const,
          mirrorX: false,
        },
      },
    }

    expect(createDefaultActionBindings([jump, crouch])).toEqual({
      space: 'directional-jump',
      shift: 'directional-crouch',
    })
  })
})
