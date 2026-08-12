import { describe, expect, it } from 'vitest'

import { calculateCapabilitiesRailProgress } from './capabilities-rail-model'

describe('calculateCapabilitiesRailProgress', () => {
  it('只在窄横栏穿过视口时映射横向进度，不占用额外纵向滚动', () => {
    expect(
      calculateCapabilitiesRailProgress({
        sectionHeight: 160,
        sectionTop: 1100,
        viewportHeight: 1000,
      }),
    ).toBe(0)
    expect(
      calculateCapabilitiesRailProgress({
        sectionHeight: 160,
        sectionTop: 420,
        viewportHeight: 1000,
      }),
    ).toBe(0.5)
    expect(
      calculateCapabilitiesRailProgress({
        sectionHeight: 160,
        sectionTop: -160,
        viewportHeight: 1000,
      }),
    ).toBe(1)
  })
})
