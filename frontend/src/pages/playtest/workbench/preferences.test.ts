import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PLAYTEST_PREFERENCES,
  readPlaytestPreferences,
  rebindPlaytestCommand,
  removePlaytestPreferences,
  setPlaytestActionType,
  writePlaytestPreferences,
  type PlaytestPreferences,
} from './preferences'

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const customPreferences: PlaytestPreferences = {
  version: 1,
  bindings: {
    move_up: { code: 'ArrowUp' },
    move_down: { code: 'ArrowDown' },
    move_left: { code: 'ArrowLeft' },
    move_right: { code: 'ArrowRight' },
    primary_action: { code: 'KeyJ', actionType: 'attack' },
    secondary_action: { code: 'KeyK', actionType: 'jump' },
  },
}

describe('Playtest local account preferences', () => {
  it('isolates persisted preferences by authenticated user', () => {
    const storage = new MemoryStorage()

    expect(writePlaytestPreferences('7', customPreferences, storage)).toBe(true)
    expect(readPlaytestPreferences('7', storage)).toEqual(customPreferences)
    expect(readPlaytestPreferences('8', storage)).toEqual(DEFAULT_PLAYTEST_PREFERENCES)
  })

  it('returns fresh defaults for missing, corrupt, unknown-version, and duplicate-key data', () => {
    const storage = new MemoryStorage()

    expect(readPlaytestPreferences('7', storage)).toEqual(DEFAULT_PLAYTEST_PREFERENCES)

    storage.setItem('windup.playtest.keybindings.v1:7', '{')
    expect(readPlaytestPreferences('7', storage)).toEqual(DEFAULT_PLAYTEST_PREFERENCES)

    storage.setItem(
      'windup.playtest.keybindings.v1:7',
      JSON.stringify({ ...customPreferences, version: 2 }),
    )
    expect(readPlaytestPreferences('7', storage)).toEqual(DEFAULT_PLAYTEST_PREFERENCES)

    storage.setItem(
      'windup.playtest.keybindings.v1:7',
      JSON.stringify({
        ...customPreferences,
        bindings: {
          ...customPreferences.bindings,
          move_right: { code: 'ArrowLeft' },
        },
      }),
    )
    const recovered = readPlaytestPreferences('7', storage)
    expect(recovered).toEqual(DEFAULT_PLAYTEST_PREFERENCES)
    expect(recovered).not.toBe(DEFAULT_PLAYTEST_PREFERENCES)
  })

  it('reports unavailable persistence without throwing or pretending success', () => {
    const blocked = new MemoryStorage()
    blocked.setItem = () => {
      throw new Error('storage blocked')
    }

    expect(writePlaytestPreferences('7', customPreferences, blocked)).toBe(false)
    expect(writePlaytestPreferences('', customPreferences, blocked)).toBe(false)
    expect(removePlaytestPreferences('7', null)).toBe(false)
  })

  it('swaps commands when a captured physical code is already used', () => {
    const next = rebindPlaytestCommand(DEFAULT_PLAYTEST_PREFERENCES, 'move_up', 'KeyD')

    expect(next.bindings.move_up.code).toBe('KeyD')
    expect(next.bindings.move_right.code).toBe('KeyW')
    expect(next.bindings.move_down.code).toBe('KeyS')
  })

  it('clears action controls but refuses to clear movement controls', () => {
    expect(
      rebindPlaytestCommand(DEFAULT_PLAYTEST_PREFERENCES, 'primary_action', null).bindings
        .primary_action,
    ).toEqual({ code: null, actionType: 'jump' })
    expect(rebindPlaytestCommand(DEFAULT_PLAYTEST_PREFERENCES, 'move_up', null)).toEqual(
      DEFAULT_PLAYTEST_PREFERENCES,
    )
  })

  it('stores semantic action types without character-specific action ids', () => {
    const next = setPlaytestActionType(DEFAULT_PLAYTEST_PREFERENCES, 'primary_action', 'attack')

    expect(next.bindings.primary_action).toEqual({ code: 'Space', actionType: 'attack' })
    expect(next.bindings.secondary_action).toEqual({ code: 'ShiftLeft', actionType: 'crouch' })
  })
})
