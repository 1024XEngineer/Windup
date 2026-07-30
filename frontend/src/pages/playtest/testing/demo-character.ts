import type { Character } from '../../../entities/character'

export const PLAYTEST_DEMO_CHARACTER_ID = 'playtest-demo-boy'
export const PLAYTEST_DEMO_OUTFIT_ID = 'playtest-demo-boy-default'
export const PLAYTEST_DEMO_ACTION_ID = 'playtest-demo-boy-idle'

const fixtureUrls = {
  'base.png': new URL('./fixtures/boy/base.png', import.meta.url).href,
  'idle-01.png': new URL('./fixtures/boy/idle-01.png', import.meta.url).href,
  'idle-02.png': new URL('./fixtures/boy/idle-02.png', import.meta.url).href,
  'idle-03.png': new URL('./fixtures/boy/idle-03.png', import.meta.url).href,
  'idle-04.png': new URL('./fixtures/boy/idle-04.png', import.meta.url).href,
  'idle-05.png': new URL('./fixtures/boy/idle-05.png', import.meta.url).href,
  'idle-06.png': new URL('./fixtures/boy/idle-06.png', import.meta.url).href,
  'idle-07.png': new URL('./fixtures/boy/idle-07.png', import.meta.url).href,
  'idle-08.png': new URL('./fixtures/boy/idle-08.png', import.meta.url).href,
  'walk-01.png': new URL('./fixtures/boy/walk-01.png', import.meta.url).href,
  'walk-02.png': new URL('./fixtures/boy/walk-02.png', import.meta.url).href,
  'walk-03.png': new URL('./fixtures/boy/walk-03.png', import.meta.url).href,
  'walk-04.png': new URL('./fixtures/boy/walk-04.png', import.meta.url).href,
  'walk-05.png': new URL('./fixtures/boy/walk-05.png', import.meta.url).href,
  'walk-06.png': new URL('./fixtures/boy/walk-06.png', import.meta.url).href,
  'walk-07.png': new URL('./fixtures/boy/walk-07.png', import.meta.url).href,
  'walk-08.png': new URL('./fixtures/boy/walk-08.png', import.meta.url).href,
} as const

const fixtureUrl = (name: keyof typeof fixtureUrls) => fixtureUrls[name]
const demoWalkStep = 4

const idleFrames = [
  {
    imageUrl: fixtureUrl('idle-01.png'),
    durationMs: 160,
    rootMotion: null,
  },
  {
    imageUrl: fixtureUrl('idle-02.png'),
    durationMs: null,
    rootMotion: null,
  },
  {
    imageUrl: fixtureUrl('idle-03.png'),
    durationMs: null,
    rootMotion: null,
  },
  {
    imageUrl: fixtureUrl('idle-04.png'),
    durationMs: null,
    rootMotion: null,
  },
  {
    imageUrl: fixtureUrl('idle-05.png'),
    durationMs: 160,
    rootMotion: null,
  },
  {
    imageUrl: fixtureUrl('idle-06.png'),
    durationMs: null,
    rootMotion: null,
  },
  {
    imageUrl: fixtureUrl('idle-07.png'),
    durationMs: null,
    rootMotion: null,
  },
  {
    imageUrl: fixtureUrl('idle-08.png'),
    durationMs: null,
    rootMotion: null,
  },
]

const walkFrames = [
  {
    imageUrl: fixtureUrl('walk-01.png'),
    durationMs: null,
    rootMotion: null,
  },
  {
    imageUrl: fixtureUrl('walk-02.png'),
    durationMs: null,
    rootMotion: { dx: demoWalkStep, dy: 0 },
  },
  {
    imageUrl: fixtureUrl('walk-03.png'),
    durationMs: 120,
    rootMotion: { dx: demoWalkStep * 2, dy: 0 },
  },
  {
    imageUrl: fixtureUrl('walk-04.png'),
    durationMs: null,
    rootMotion: { dx: demoWalkStep * 3, dy: 0 },
  },
  {
    imageUrl: fixtureUrl('walk-05.png'),
    durationMs: null,
    rootMotion: { dx: demoWalkStep * 4, dy: 0 },
  },
  {
    imageUrl: fixtureUrl('walk-06.png'),
    durationMs: null,
    rootMotion: { dx: demoWalkStep * 5, dy: 0 },
  },
  {
    imageUrl: fixtureUrl('walk-07.png'),
    durationMs: 120,
    rootMotion: { dx: demoWalkStep * 6, dy: 0 },
  },
  {
    imageUrl: fixtureUrl('walk-08.png'),
    durationMs: null,
    rootMotion: null,
  },
]

export const PLAYTEST_DEMO_CHARACTER: Character = {
  id: PLAYTEST_DEMO_CHARACTER_ID,
  projectId: 'playtest-demo-project',
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  outfits: [
    {
      id: PLAYTEST_DEMO_OUTFIT_ID,
      characterId: PLAYTEST_DEMO_CHARACTER_ID,
      name: '默认造型',
      candidateCharacterTemplates: [
        {
          id: 'playtest-demo-boy-template',
          imageUrl: fixtureUrl('base.png'),
          attemptId: 'playtest-demo-boy-import',
        },
      ],
      characterTemplateUrl: fixtureUrl('base.png'),
      baseFrames: [{ imageUrl: fixtureUrl('base.png') }],
      actions: [
        {
          id: PLAYTEST_DEMO_ACTION_ID,
          outfitId: PLAYTEST_DEMO_OUTFIT_ID,
          name: '待机',
          kind: 'preset',
          type: 'idle',
          fps: 8,
          keyFrameIndex: 0,
          frames: idleFrames,
        },
        {
          id: 'playtest-demo-boy-walk',
          outfitId: PLAYTEST_DEMO_OUTFIT_ID,
          name: '行走',
          kind: 'preset',
          type: 'walk',
          fps: 10,
          keyFrameIndex: 0,
          frames: walkFrames,
        },
      ],
    },
  ],
}
