import { describe, expect, it } from 'vitest'

import { buildPlaytestPath, buildPublishedActionId } from './index'

describe('publish navigation helpers', () => {
  it('encodes asset identifiers and adds an optional action query', () => {
    expect(buildPlaytestPath({ characterId: '角色/1', outfitId: '造型 1' })).toBe(
      '/playtest/%E8%A7%92%E8%89%B2%2F1/%E9%80%A0%E5%9E%8B%201',
    )
    expect(
      buildPlaytestPath({ characterId: 'character-1', outfitId: 'outfit-1', actionId: 'walk 1' }),
    ).toBe('/playtest/character-1/outfit-1?actionId=walk+1')
  })

  it('keeps published actions unique per character, run, and node', () => {
    expect(buildPublishedActionId('character-1', 'run-2', 'action-3')).toBe(
      'character-1-run-2-action-3',
    )
  })
})
