import { describe, expect, it } from 'vitest'

import type { Character, Project } from '@/entities'

import { createCharacterExportModel } from './character-export'

const project: Project = {
  id: '42',
  workflowId: null,
  name: '点灯人',
  perspective: 'side',
  directionalMovement: 'single',
  spriteSize: { width: 64, height: 80 },
  gameStyle: null,
  sampleImageUrl: null,
  createdAt: '2026-08-01T08:00:00Z',
  updatedAt: '2026-08-01T08:00:00Z',
}

const character: Character = {
  id: '51',
  projectId: '42',
  workflowRunId: '501',
  name: '轻装信使',
  description: null,
  referenceImageUrl: '/master.png',
  dataVersion: 1,
  status: 1,
  outfits: [
    {
      id: 'outfit-default',
      characterId: '51',
      name: '常态造型',
      description: null,
      previewUrl: '/master.png',
      actions: [
        {
          id: 'walk',
          outfitId: 'outfit-default',
          name: '行走',
          type: 'walk',
          loop: true,
          fps: 10,
          frameCount: 3,
          frames: [
            { index: 2, imageUrl: '/walk-03.png', durationMs: 120 },
            { index: 0, imageUrl: '/walk-01.png', durationMs: null },
            { index: 1, imageUrl: '/walk-02.png', durationMs: 90 },
          ],
        },
      ],
    },
  ],
}

describe('createCharacterExportModel', () => {
  it('maps the current Project and Character contracts without losing frame indexes', () => {
    const model = createCharacterExportModel({
      project,
      character,
      outfitId: 'outfit-default',
    })

    expect(model).toMatchObject({
      stage: 'action-assets',
      characterId: '51',
      characterName: '轻装信使',
      characterImageUrl: '/master.png',
      outfitId: 'outfit-default',
      outfitName: '常态造型',
      canvas: { width: 64, height: 80 },
      source: { workflowRunId: '501', generationIds: [] },
    })
    expect(model.actions[0]?.sequences[0]).toMatchObject({
      direction: 'east',
      mirrorX: false,
      expectedFrameCount: 3,
      loop: true,
      anchor: { x: 0.5, y: 0.92 },
      footY: 73,
      qualityStatus: 'passed',
    })
    expect(model.actions[0]?.sequences[0]?.frames).toEqual([
      { index: 0, imageUrl: '/walk-01.png', durationMs: 100 },
      { index: 1, imageUrl: '/walk-02.png', durationMs: 90 },
      { index: 2, imageUrl: '/walk-03.png', durationMs: 120 },
    ])
    expect(model.actions[0]?.sequences[1]).toMatchObject({
      direction: 'west',
      mirrorX: true,
    })
    expect(model.actions[0]?.sequences[1]?.frames).toEqual(model.actions[0]?.sequences[0]?.frames)
  })

  it('keeps legacy frame-only characters exportable after a project adopts four-way movement', () => {
    const model = createCharacterExportModel({
      project: { ...project, directionalMovement: 'four-way' },
      character,
      outfitId: 'outfit-default',
    })

    expect(model.actions[0]?.sequences.map((sequence) => sequence.direction)).toEqual([
      'east',
      'west',
    ])
  })

  it('exports every available directional sequence independently', () => {
    const directional = structuredClone(character)
    const directionalProject = { ...project, directionalMovement: 'four-way' as const }
    directional.outfits[0]!.actions[0]!.sequences = [
      {
        direction: 'east',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: '/walk-east-01.png', durationMs: 100 }],
      },
      {
        direction: 'west',
        sourceDirection: 'east',
        mirrorX: true,
        frameCount: 1,
        frames: [],
      },
      {
        direction: 'north',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: '/walk-north-01.png', durationMs: 110 }],
      },
      {
        direction: 'south',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: '/walk-south-01.png', durationMs: 120 }],
      },
    ]

    const model = createCharacterExportModel({
      project: directionalProject,
      character: directional,
      outfitId: 'outfit-default',
    })

    expect(model.actions[0]?.sequences.map((sequence) => sequence.direction)).toEqual([
      'east',
      'west',
      'north',
      'south',
    ])
    expect(model.actions[0]?.sequences[2]?.frames).toEqual([
      { index: 0, imageUrl: '/walk-north-01.png', durationMs: 110 },
    ])
  })

  it('rejects a frame sequence whose explicit backend indexes are not contiguous', () => {
    const invalid: Character = {
      ...character,
      outfits: [
        {
          ...character.outfits[0]!,
          actions: [
            {
              ...character.outfits[0]!.actions[0]!,
              frames: [
                { index: 0, imageUrl: '/walk-01.png', durationMs: 100 },
                { index: 2, imageUrl: '/walk-03.png', durationMs: 100 },
              ],
            },
          ],
        },
      ],
    }

    expect(() =>
      createCharacterExportModel({
        project,
        character: invalid,
        outfitId: 'outfit-default',
      }),
    ).toThrow('行走的帧序号必须从 0 连续排列')
  })

  it('rejects invalid project, character, outfit and timing relationships', () => {
    expect(() =>
      createCharacterExportModel({
        project,
        character: { ...character, projectId: 'other-project' },
        outfitId: 'outfit-default',
      }),
    ).toThrow('角色与项目不匹配')

    expect(
      createCharacterExportModel({
        project,
        character: { ...character, name: '   ' },
        outfitId: 'outfit-default',
      }).characterName,
    ).toBe('未命名角色')

    expect(() =>
      createCharacterExportModel({
        project,
        character,
        outfitId: 'missing-outfit',
      }),
    ).toThrow('导出造型不存在')

    const invalidTiming: Character = {
      ...character,
      outfits: [
        {
          ...character.outfits[0]!,
          actions: [
            {
              ...character.outfits[0]!.actions[0]!,
              fps: 0,
              frames: [{ index: 0, imageUrl: '/walk-01.png', durationMs: null }],
            },
          ],
        },
      ],
    }
    expect(() =>
      createCharacterExportModel({
        project,
        character: invalidTiming,
        outfitId: 'outfit-default',
      }),
    ).toThrow('行走缺少有效的帧时长和 FPS')
  })
})
