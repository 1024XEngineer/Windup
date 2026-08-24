import { hasPlayableFrames, type PlaytestAction } from './model'
import type { PlaytestPreferences } from './preferences'

export const PLAYTEST_CONTROL_KEYS = ['space', 'shift'] as const

export type PlaytestControlKey = (typeof PLAYTEST_CONTROL_KEYS)[number]
export type PlaytestActionBindings = Readonly<Record<PlaytestControlKey, string | null>>

const CROUCH_TYPES = new Set(['crouch', 'duck', 'squat'])

export function playtestPreferenceActionType(actionType: string): string {
  return CROUCH_TYPES.has(actionType) ? 'crouch' : actionType
}

export function createDefaultActionBindings(
  actions: readonly PlaytestAction[],
): PlaytestActionBindings {
  return {
    space: findAction(actions, (action) => action.type === 'jump')?.id ?? null,
    shift: findAction(actions, (action) => CROUCH_TYPES.has(action.type))?.id ?? null,
  }
}

export function resolvePlaytestActionBindings(
  actions: readonly PlaytestAction[],
  preferences: PlaytestPreferences,
): PlaytestActionBindings {
  return {
    space:
      findActionByPreferenceType(actions, preferences.bindings.primary_action.actionType ?? null)
        ?.id ?? null,
    shift:
      findActionByPreferenceType(actions, preferences.bindings.secondary_action.actionType ?? null)
        ?.id ?? null,
  }
}

function findActionByPreferenceType(actions: readonly PlaytestAction[], actionType: string | null) {
  if (actionType === null) return undefined
  return findAction(actions, (action) => {
    return playtestPreferenceActionType(action.type) === actionType
  })
}

function findAction(
  actions: readonly PlaytestAction[],
  predicate: (action: PlaytestAction) => boolean,
) {
  return actions.find((action) => hasPlayableFrames(action) && predicate(action))
}
