/// <reference types="node" />

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  PLAYTEST_DEMO_ACTION_ID,
  PLAYTEST_DEMO_CHARACTER,
  PLAYTEST_DEMO_OUTFIT_ID,
} from './demo-character'

describe('PLAYTEST_DEMO_CHARACTER', () => {
  it('provides a confirmed boy outfit with complete idle and walk fixtures', () => {
    const outfit = PLAYTEST_DEMO_CHARACTER.outfits.find(({ id }) => id === PLAYTEST_DEMO_OUTFIT_ID)

    expect(PLAYTEST_DEMO_CHARACTER.outfits).toHaveLength(1)
    expect(PLAYTEST_DEMO_CHARACTER.outfits[0]?.id).toBe(PLAYTEST_DEMO_OUTFIT_ID)
    expect(outfit).toBeDefined()
    expect(PLAYTEST_DEMO_ACTION_ID).toBe('playtest-demo-boy-idle')
    expect(outfit!.actions.map((action) => action.type)).toEqual(['idle', 'walk'])
    expect(outfit!.actions.every((action) => action.frames.length === 8)).toBe(true)

    const walkFrames = outfit!.actions.find((action) => action.type === 'walk')!.frames
    const walkSteps = walkFrames.flatMap((frame) =>
      frame.rootMotion === null ? [] : [frame.rootMotion.dx],
    )
    expect(walkSteps).toEqual([4, 4, 4, 4, 4, 4])
    expect(walkSteps.reduce((sum, step) => sum + step, 0)).toBe(24)

    const frames = outfit!.actions.flatMap((action) => action.frames)
    expect(frames.some((frame) => frame.durationMs !== null)).toBe(true)
    expect(frames.some((frame) => frame.rootMotion !== null)).toBe(true)

    const imageUrls = [
      outfit!.characterTemplateUrl,
      ...outfit!.candidateCharacterTemplates.map((candidate) => candidate.imageUrl),
      ...outfit!.baseFrames.map((frame) => frame.imageUrl),
      ...frames.map((frame) => frame.imageUrl),
    ]
    expect(imageUrls.every((url) => url !== null && existsSync(new URL(url)))).toBe(true)
  })
})
