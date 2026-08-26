import { describe, expect, it } from 'vitest'

import type { QuickStartCandidate } from './service'
import { buildDirectionSheetCandidates } from './direction-sheet'

function candidate(
  direction: QuickStartCandidate['direction'],
  index: number,
): QuickStartCandidate {
  return { direction, index, imageUrl: `${direction}-${index}.png` }
}

describe('buildDirectionSheetCandidates', () => {
  it('按候选序号组装八向方向卡，并保留八个真实方向', () => {
    const sheets = buildDirectionSheetCandidates(
      [
        candidate('east', 0),
        candidate('west', 0),
        candidate('north', 0),
        candidate('south', 0),
        candidate('north_east', 0),
        candidate('north_west', 0),
        candidate('south_east', 0),
        candidate('south_west', 0),
        candidate('east', 1),
        candidate('west', 1),
        candidate('north', 1),
        candidate('south', 1),
        candidate('north_east', 1),
        candidate('north_west', 1),
        candidate('south_east', 1),
        candidate('south_west', 1),
      ],
      'eight-way',
    )

    expect(sheets).toHaveLength(2)
    expect(sheets[0]).toMatchObject({
      index: 0,
      selections: {
        east: 'east-0.png',
        north: 'north-0.png',
        south: 'south-0.png',
        north_east: 'north_east-0.png',
        south_east: 'south_east-0.png',
      },
    })
    expect(sheets[0]?.cells).toMatchObject({
      west: { imageUrl: 'west-0.png', sourceDirection: 'west', mirrorX: false, empty: false },
      north_west: {
        imageUrl: 'north_west-0.png',
        sourceDirection: 'north_west',
        mirrorX: false,
        empty: false,
      },
      south_west: {
        imageUrl: 'south_west-0.png',
        sourceDirection: 'south_west',
        mirrorX: false,
        empty: false,
      },
    })
  })

  it('四向保留正方向并将斜向格标记为空', () => {
    const sheets = buildDirectionSheetCandidates(
      [candidate('east', 0), candidate('west', 0), candidate('north', 0), candidate('south', 0)],
      'four-way',
    )

    expect(sheets).toHaveLength(1)
    expect(sheets[0]?.selections).toEqual({
      east: 'east-0.png',
      west: 'west-0.png',
      north: 'north-0.png',
      south: 'south-0.png',
    })
    expect(new Set(Object.values(sheets[0]!.selections)).size).toBe(4)
    expect(sheets[0]?.cells).toMatchObject({
      east: { imageUrl: 'east-0.png', empty: false },
      west: { imageUrl: 'west-0.png', mirrorX: false, empty: false },
      north: { imageUrl: 'north-0.png', empty: false },
      south: { imageUrl: 'south-0.png', empty: false },
      north_east: { imageUrl: null, empty: true },
      north_west: { imageUrl: null, empty: true },
      south_east: { imageUrl: null, empty: true },
      south_west: { imageUrl: null, empty: true },
    })
  })

  it('源方向候选数量不一致时只返回完整卡片', () => {
    const sheets = buildDirectionSheetCandidates(
      [
        candidate('east', 0),
        candidate('east', 1),
        candidate('west', 0),
        candidate('north', 0),
        candidate('south', 0),
      ],
      'four-way',
    )

    expect(sheets.map((sheet) => sheet.index)).toEqual([0])
  })
})
