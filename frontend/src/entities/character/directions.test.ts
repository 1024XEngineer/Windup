import { describe, expect, it } from 'vitest'

import { getDirectionProfile, resolveActionDirection, type ActionDirection } from './directions'

describe('direction profiles', () => {
  it.each([
    {
      movement: 'single' as const,
      sourceDirections: ['east'],
      logicalDirections: ['east', 'west'],
    },
    {
      movement: 'four-way' as const,
      sourceDirections: ['east', 'north', 'south'],
      logicalDirections: ['east', 'west', 'north', 'south'],
    },
    {
      movement: 'eight-way' as const,
      sourceDirections: ['east', 'north', 'south', 'north_east', 'south_east'],
      logicalDirections: [
        'east',
        'west',
        'north',
        'south',
        'north_east',
        'north_west',
        'south_east',
        'south_west',
      ],
    },
  ])('exposes the required $movement source and logical directions', (expected) => {
    expect(getDirectionProfile(expected.movement)).toEqual({
      sourceDirections: expected.sourceDirections,
      logicalDirections: expected.logicalDirections,
    })
  })

  it.each([
    ['west', 'east'],
    ['north_west', 'north_east'],
    ['south_west', 'south_east'],
  ] as const)('resolves mirrored %s frames from %s', (direction, sourceDirection) => {
    expect(resolveActionDirection(direction)).toEqual({
      direction,
      sourceDirection,
      mirrorX: true,
    })
  })

  it.each(['east', 'north', 'south', 'north_east', 'south_east'] satisfies ActionDirection[])(
    'keeps source direction %s independent',
    (direction) => {
      expect(resolveActionDirection(direction)).toEqual({
        direction,
        sourceDirection: direction,
        mirrorX: false,
      })
    },
  )
})
