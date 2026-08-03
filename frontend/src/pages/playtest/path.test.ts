import { describe, expect, it } from 'vitest'

import { buildPlaytestPath } from './path'

describe('buildPlaytestPath', () => {
  it('encodes resource identities and keeps the selected action in the query string', () => {
    expect(
      buildPlaytestPath({
        characterId: 'character/1',
        outfitId: 'default outfit',
        actionId: 'walk left',
      }),
    ).toBe('/playtest/character%2F1/default%20outfit?actionId=walk+left')
  })
})
