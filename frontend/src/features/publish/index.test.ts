import { describe, expect, it } from 'vitest'

import { buildPlaytestPath } from './index'

describe('buildPlaytestPath', () => {
  it('uses one encoded route contract for every Playtest caller', () => {
    expect(
      buildPlaytestPath({
        characterId: 'character/1',
        outfitId: 'default outfit',
        actionId: 'walk left',
      }),
    ).toBe('/playtest/character%2F1/default%20outfit?actionId=walk+left')
  })
})
