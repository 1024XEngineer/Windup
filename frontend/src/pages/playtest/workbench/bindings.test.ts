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
})
