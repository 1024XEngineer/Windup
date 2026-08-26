import { describe, expect, it } from 'vitest'

import { ACTION_DIRECTIONS, getDirectionProfile, resolveActionDirection } from './directions'

describe('direction profiles', () => {
  it('generates east and derives west for single-direction projects', () => {
    const profile = getDirectionProfile('single')

    expect(profile.generationDirections).toEqual(['east'])
    expect(profile.logicalDirections).toEqual(['east', 'west'])
    expect(profile.derivedDirections).toEqual([
      { direction: 'west', sourceDirection: 'east', mirrorX: true },
    ])
  })

  it('requires four independent generation directions for four-way projects', () => {
    const profile = getDirectionProfile('four-way')

    expect(profile.generationDirections).toEqual(['east', 'west', 'north', 'south'])
    expect(profile.logicalDirections).toEqual(['east', 'west', 'north', 'south'])
    expect(profile.derivedDirections).toEqual([])
  })

  it('requires all eight independent generation directions for eight-way projects', () => {
    const profile = getDirectionProfile('eight-way')

    expect(profile.generationDirections).toEqual(ACTION_DIRECTIONS)
    expect(profile.logicalDirections).toEqual(ACTION_DIRECTIONS)
    expect(profile.derivedDirections).toEqual([])
  })
})

describe('legacy direction resolution', () => {
  it('keeps the current west-to-east mirror until consumers migrate to a profile', () => {
    expect(resolveActionDirection('west')).toEqual({
      direction: 'west',
      sourceDirection: 'east',
      mirrorX: true,
    })
  })

  it('keeps a current real source direction independent', () => {
    expect(resolveActionDirection('north')).toEqual({
      direction: 'north',
      sourceDirection: 'north',
      mirrorX: false,
    })
  })
})
