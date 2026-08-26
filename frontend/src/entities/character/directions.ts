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
  /** 与 generationDirections 同义；保留给已有消费方。 */
  readonly sourceDirections: readonly ActionDirection[]
  readonly logicalDirections: readonly ActionDirection[]
}

export interface ResolvedActionDirection {
  readonly direction: ActionDirection
  readonly sourceDirection: ActionDirection
  readonly mirrorX: boolean
}

export interface DirectionGridLayout {
  readonly columns: 1 | 2 | 3
  readonly cells: readonly (ActionDirection | null)[]
}

const DIRECTION_PROFILES: Record<DirectionalMovement, DirectionProfile> = {
  single: {
    generationDirections: ['east'],
    derivedDirections: [{ direction: 'west', sourceDirection: 'east', mirrorX: true }],
    sourceDirections: ['east'],
    logicalDirections: ['east', 'west'],
  },
  'four-way': {
    generationDirections: ['east', 'north', 'south'],
    derivedDirections: [{ direction: 'west', sourceDirection: 'east', mirrorX: true }],
    sourceDirections: ['east', 'north', 'south'],
    logicalDirections: ['east', 'west', 'north', 'south'],
  },
  'eight-way': {
    generationDirections: ['east', 'north', 'south', 'north_east', 'south_east'],
    derivedDirections: [
      { direction: 'west', sourceDirection: 'east', mirrorX: true },
      { direction: 'north_west', sourceDirection: 'north_east', mirrorX: true },
      { direction: 'south_west', sourceDirection: 'south_east', mirrorX: true },
    ],
    sourceDirections: ['east', 'north', 'south', 'north_east', 'south_east'],
    logicalDirections: ACTION_DIRECTIONS,
  },
}

const DIRECTION_GRID_LAYOUTS: Record<DirectionalMovement, DirectionGridLayout> = {
  single: { columns: 1, cells: ['east'] },
  'four-way': {
    columns: 2,
    cells: ['north', 'south', 'west', 'east'],
  },
  'eight-way': {
    columns: 3,
    cells: [
      'north_west',
      'north',
      'north_east',
      'west',
      null,
      'east',
      'south_west',
      'south',
      'south_east',
    ],
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

export function getDirectionGridLayout(movement: DirectionalMovement): DirectionGridLayout {
  return DIRECTION_GRID_LAYOUTS[movement]
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
