export const PLAYTEST_COMMANDS = [
  'move_up',
  'move_down',
  'move_left',
  'move_right',
  'primary_action',
  'secondary_action',
] as const

export type PlaytestCommand = (typeof PLAYTEST_COMMANDS)[number]
export type PlaytestActionCommand = 'primary_action' | 'secondary_action'

export interface PlaytestPreferenceBinding {
  readonly code: string | null
  readonly actionType?: string | null
}

export interface PlaytestPreferences {
  readonly version: 1
  readonly bindings: Readonly<Record<PlaytestCommand, PlaytestPreferenceBinding>>
}

const STORAGE_PREFIX = 'windup.playtest.keybindings.v1:'
const MAX_CODE_LENGTH = 64
const MAX_ACTION_TYPE_LENGTH = 64

export const DEFAULT_PLAYTEST_PREFERENCES: PlaytestPreferences = {
  version: 1,
  bindings: {
    move_up: { code: 'KeyW' },
    move_down: { code: 'KeyS' },
    move_left: { code: 'KeyA' },
    move_right: { code: 'KeyD' },
    primary_action: { code: 'Space', actionType: 'jump' },
    secondary_action: { code: 'ShiftLeft', actionType: 'crouch' },
  },
}

function clonePreferences(value: PlaytestPreferences): PlaytestPreferences {
  return {
    version: 1,
    bindings: Object.fromEntries(
      PLAYTEST_COMMANDS.map((command) => [command, { ...value.bindings[command] }]),
    ) as unknown as PlaytestPreferences['bindings'],
  }
}

function defaults(): PlaytestPreferences {
  return clonePreferences(DEFAULT_PLAYTEST_PREFERENCES)
}

function browserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isActionCommand(command: PlaytestCommand): command is PlaytestActionCommand {
  return command === 'primary_action' || command === 'secondary_action'
}

function parsePreferences(value: unknown): PlaytestPreferences | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.bindings)) return null
  if (
    Object.keys(value.bindings).length !== PLAYTEST_COMMANDS.length ||
    !Object.keys(value.bindings).every((command) =>
      PLAYTEST_COMMANDS.includes(command as PlaytestCommand),
    )
  )
    return null

  const bindings = {} as Record<PlaytestCommand, PlaytestPreferenceBinding>
  const usedCodes = new Set<string>()
  for (const command of PLAYTEST_COMMANDS) {
    const candidate = value.bindings[command]
    if (!isRecord(candidate)) return null
    const allowedKeys = isActionCommand(command) ? ['code', 'actionType'] : ['code']
    if (!Object.keys(candidate).every((key) => allowedKeys.includes(key))) return null

    const code = candidate.code
    if (isActionCommand(command)) {
      if (code !== null && !isBoundedText(code, MAX_CODE_LENGTH)) return null
      const actionType = candidate.actionType
      if (actionType !== null && !isBoundedText(actionType, MAX_ACTION_TYPE_LENGTH)) return null
      bindings[command] = { code, actionType }
    } else {
      if (!isBoundedText(code, MAX_CODE_LENGTH)) return null
      bindings[command] = { code }
    }

    if (code !== null) {
      if (usedCodes.has(code)) return null
      usedCodes.add(code)
    }
  }
  return { version: 1, bindings }
}

export function readPlaytestPreferences(
  userId: string,
  storage: Storage | null = browserStorage(),
): PlaytestPreferences {
  if (!userId || storage === null) return defaults()
  try {
    const raw = storage.getItem(storageKey(userId))
    if (raw === null) return defaults()
    return parsePreferences(JSON.parse(raw)) ?? defaults()
  } catch {
    return defaults()
  }
}

export function writePlaytestPreferences(
  userId: string,
  value: PlaytestPreferences,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!userId || storage === null || parsePreferences(value) === null) return false
  try {
    storage.setItem(storageKey(userId), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removePlaytestPreferences(
  userId: string,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!userId || storage === null) return false
  try {
    storage.removeItem(storageKey(userId))
    return true
  } catch {
    return false
  }
}

export function rebindPlaytestCommand(
  value: PlaytestPreferences,
  command: PlaytestCommand,
  code: string | null,
): PlaytestPreferences {
  if (code === null && !isActionCommand(command)) return clonePreferences(value)
  if (code !== null && !isBoundedText(code, MAX_CODE_LENGTH)) return clonePreferences(value)

  const next = clonePreferences(value)
  const oldCode = next.bindings[command].code
  const occupied = PLAYTEST_COMMANDS.find(
    (candidate) => candidate !== command && next.bindings[candidate].code === code,
  )
  const bindings = { ...next.bindings }
  bindings[command] = { ...bindings[command], code }
  if (occupied !== undefined) bindings[occupied] = { ...bindings[occupied], code: oldCode }
  return { version: 1, bindings }
}

export function setPlaytestActionType(
  value: PlaytestPreferences,
  command: PlaytestActionCommand,
  actionType: string | null,
): PlaytestPreferences {
  if (actionType !== null && !isBoundedText(actionType, MAX_ACTION_TYPE_LENGTH)) {
    return clonePreferences(value)
  }
  const next = clonePreferences(value)
  return {
    version: 1,
    bindings: {
      ...next.bindings,
      [command]: { ...next.bindings[command], actionType },
    },
  }
}
