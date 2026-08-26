import type { DirectionalMovement } from '../project'

export const ACTION_DIRECTIONS = [
  'east',
  'west',
  'north',
  'south',
  'north_east',
  'north_west',
  'south_east',
  'south_west',
] as const

export type ActionDirection = (typeof ACTION_DIRECTIONS)[number]

export interface DirectionProfile {
  readonly generationDirections: readonly ActionDirection[]
  readonly derivedDirections: readonly ResolvedActionDirection[]
  /** @deprecated 工作流迁移到 generationDirections 后删除。 */
  readonly sourceDirections: readonly ActionDirection[]
  readonly logicalDirections: readonly ActionDirection[]
}

export interface ResolvedActionDirection {
  readonly direction: ActionDirection
  readonly sourceDirection: ActionDirection
  readonly mirrorX: boolean
}

const DIRECTION_PROFILES: Record<DirectionalMovement, DirectionProfile> = {
  single: {
    generationDirections: ['east'],
    derivedDirections: [{ direction: 'west', sourceDirection: 'east', mirrorX: true }],
    sourceDirections: ['east'],
    logicalDirections: ['east', 'west'],
  },
  'four-way': {
    generationDirections: ['east', 'west', 'north', 'south'],
    derivedDirections: [],
    sourceDirections: ['east', 'north', 'south'],
    logicalDirections: ['east', 'west', 'north', 'south'],
  },
  'eight-way': {
    generationDirections: ACTION_DIRECTIONS,
    derivedDirections: [],
    sourceDirections: ['east', 'north', 'south', 'north_east', 'south_east'],
    logicalDirections: ACTION_DIRECTIONS,
  },
}

const MIRROR_SOURCES: Partial<Record<ActionDirection, ActionDirection>> = {
  west: 'east',
  north_west: 'north_east',
  south_west: 'south_east',
}

export function getDirectionProfile(movement: DirectionalMovement): DirectionProfile {
  return DIRECTION_PROFILES[movement]
}

export function isActionDirection(value: unknown): value is ActionDirection {
  return typeof value === 'string' && ACTION_DIRECTIONS.includes(value as ActionDirection)
}

export function resolveActionDirection(direction: ActionDirection): ResolvedActionDirection {
  const sourceDirection = MIRROR_SOURCES[direction]
  return {
    direction,
    sourceDirection: sourceDirection ?? direction,
    mirrorX: sourceDirection !== undefined,
  }
}
