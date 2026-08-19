import { describe, expect, it } from 'vitest'

import type { Character, CharacterApis, Generation, WorkflowRun } from '@/entities'

import * as exportFeature from './index'

interface ExportFeatureModule {
  createCharacterAssetPublisher(apis: Pick<CharacterApis, 'update'>): {
    publishReviewedAction(input: {
      character: Character
      workflow: WorkflowRun
      reviewNodeId: string
      generation: Generation
    }): Promise<Character>
  }
}

describe('Character asset publisher', () => {
  it('publishes the reviewed action into the existing outfit', async () => {
    const updates: Character[] = []
    const publisher = (
      exportFeature as unknown as ExportFeatureModule
    ).createCharacterAssetPublisher({
      async update(character) {
        updates.push(structuredClone(character))
        return structuredClone(character)
      },
    })

    const published = await publisher.publishReviewedAction({
      character: characterFixture(),
      workflow: workflowFixture(),
      reviewNodeId: 'action-walk:review',
      generation: completeAnimationFixture(),
    })

    expect(updates).toHaveLength(1)
    expect(published).toMatchObject({
      description: '人工维护的角色描述',
      referenceImageUrl: 'https://assets.windup.test/current-master.png',
    })
    expect(published.outfits[0]).toMatchObject({
      id: 'outfit-default',
      previewUrl: 'https://assets.windup.test/outfit.png',
    })
    expect(published.outfits[0]?.actions).toEqual([
      expect.objectContaining({ id: 'idle', type: 'idle' }),
      {
        id: 'action-walk',
        outfitId: 'outfit-default',
        name: '行走',
        type: 'walk',
        loop: true,
        fps: 12,
        frameCount: 2,
        frames: [
          { index: 0, imageUrl: 'https://assets.windup.test/walk-01.png', durationMs: 125 },
          { index: 1, imageUrl: 'https://assets.windup.test/walk-02.png', durationMs: 80 },
        ],
        sequences: [
          {
            direction: 'east',
            sourceDirection: null,
            mirrorX: false,
            frameCount: 2,
            frames: [
              { index: 0, imageUrl: 'https://assets.windup.test/walk-01.png', durationMs: 125 },
              { index: 1, imageUrl: 'https://assets.windup.test/walk-02.png', durationMs: 80 },
            ],
          },
          {
            direction: 'west',
            sourceDirection: 'east',
            mirrorX: true,
            frameCount: 2,
            frames: [],
          },
        ],
      },
    ])
  })

  it('replaces the same stable action instead of duplicating it on retry', async () => {
    const publisher = (
      exportFeature as unknown as ExportFeatureModule
    ).createCharacterAssetPublisher({
      async update(character) {
        return structuredClone(character)
      },
    })
    const input = {
      workflow: workflowFixture(),
      reviewNodeId: 'action-walk:review',
      generation: completeAnimationFixture(),
    }

    const first = await publisher.publishReviewedAction({ character: characterFixture(), ...input })
    const retried = await publisher.publishReviewedAction({ character: first, ...input })

    expect(retried.outfits[0]?.actions.map((action) => action.id)).toEqual(['idle', 'action-walk'])
  })

  it('rejects a completed task from another project', async () => {
    const publisher = createRejectingPublisher()

    await expect(
      publisher.publishReviewedAction({
        character: characterFixture(),
        workflow: workflowFixture(),
        reviewNodeId: 'action-walk:review',
        generation: { ...completeAnimationFixture(), projectId: 'another-project' },
      }),
    ).rejects.toThrow('Generation 与当前 WorkflowRun 不匹配')
  })

  it('rejects a task whose type is not complete_animation', async () => {
    const publisher = createRejectingPublisher()
    const wrongType = {
      ...completeAnimationFixture(),
      type: 'character_template',
    } as unknown as Generation

    await expect(
      publisher.publishReviewedAction({
        character: characterFixture(),
        workflow: workflowFixture(),
        reviewNodeId: 'action-walk:review',
        generation: wrongType,
      }),
    ).rejects.toThrow('完整动画生成结果不可发布')
  })

  it('publishes every real four-way direction and derives west by mirroring east', () => {
    const workflow = workflowFixture()
    const fullFrame = workflow.nodes.find((node) => node.type === 'action-full-frame')
    if (!fullFrame || fullFrame.type !== 'action-full-frame') throw new Error('missing full frame')
    const directions = ['east', 'north', 'south'] as const
    fullFrame.generations = directions.map((direction) => ({
      taskId: `generation-${direction}`,
      role: 'complete_animation',
      direction,
    }))
    const generations = directions.map((direction) => ({
      ...completeAnimationFixture(),
      id: `generation-${direction}`,
      result: {
        type: 'complete_animation' as const,
        direction,
        frames: [
          { index: 0, url: `${direction}-0.png`, durationMs: 100 },
          { index: 1, url: `${direction}-1.png`, durationMs: 100 },
        ],
      },
    }))

    const action = exportFeature.buildReviewedAction(
      workflow,
      'action-walk:review',
      generations,
      'four-way',
    )

    expect(action.sequences?.map((sequence) => sequence.direction)).toEqual([
      'east',
      'west',
      'north',
      'south',
    ])
    expect(action.sequences?.find((sequence) => sequence.direction === 'west')).toMatchObject({
      sourceDirection: 'east',
      mirrorX: true,
      frames: [],
    })
    expect(() =>
      exportFeature.buildReviewedAction(
        workflow,
        'action-walk:review',
        [generations[0]!],
        'four-way',
      ),
    ).toThrow('缺少 north 方向动画结果')
    expect(() =>
      exportFeature.buildReviewedAction(
        workflow,
        'action-walk:review',
        [generations[0]!, { ...generations[1]!, result: generations[0]!.result }],
        'four-way',
      ),
    ).toThrow('重复的 east 方向动画结果')
  })

  it('rejects incomplete workflows and unusable directional results', () => {
    const incomplete = workflowFixture()
    const incompleteFull = incomplete.nodes.find((node) => node.type === 'action-full-frame')
    if (!incompleteFull || incompleteFull.type !== 'action-full-frame') {
      throw new Error('missing full frame')
    }
    incompleteFull.status = 'active'
    expect(() =>
      exportFeature.buildReviewedAction(incomplete, 'action-walk:review', [
        completeAnimationFixture(),
      ]),
    ).toThrow('完整动画尚未完成')

    const unconfirmed = workflowFixture()
    const template = unconfirmed.nodes.find((node) => node.type === 'character-template')
    if (!template || template.type !== 'character-template') throw new Error('missing template')
    template.selectedImageUrl = null
    expect(() =>
      exportFeature.buildReviewedAction(unconfirmed, 'action-walk:review', [
        completeAnimationFixture(),
      ]),
    ).toThrow('角色母版尚未确认')

    expect(() =>
      exportFeature.buildReviewedAction(workflowFixture(), 'action-walk:review', [
        { ...completeAnimationFixture(), status: 'failed', result: null },
      ]),
    ).toThrow('完整动画生成结果不可发布')

    expect(() =>
      exportFeature.buildReviewedAction(workflowFixture(), 'action-walk:review', [
        {
          ...completeAnimationFixture(),
          result: { type: 'complete_animation', frames: [] },
        },
      ]),
    ).toThrow('完整动画生成结果不可发布')
  })
})

function createRejectingPublisher() {
  return (exportFeature as unknown as ExportFeatureModule).createCharacterAssetPublisher({
    async update() {
      throw new Error('不应写入 Character')
    },
  })
}

function characterFixture(): Character {
  return {
    id: '51',
    projectId: '42',
    workflowRunId: '120',
    name: '骑士',
    description: '人工维护的角色描述',
    referenceImageUrl: 'https://assets.windup.test/current-master.png',
    dataVersion: 1,
    status: 1,
    outfits: [
      {
        id: 'outfit-default',
        characterId: '51',
        name: '常态造型',
        description: null,
        previewUrl: 'https://assets.windup.test/outfit.png',
        actions: [
          {
            id: 'idle',
            outfitId: 'outfit-default',
            name: '待机',
            type: 'idle',
            loop: true,
            fps: 8,
            frameCount: 1,
            frames: [
              {
                index: 0,
                imageUrl: 'https://assets.windup.test/idle-01.png',
                durationMs: null,
              },
            ],
          },
        ],
      },
    ],
  }
}

function workflowFixture(): WorkflowRun {
  return {
    id: '120',
    projectId: '42',
    version: 7,
    storageStatus: 'active',
    nodes: [
      {
        id: 'character-setup',
        type: 'character-setup',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: [],
        generations: [],
        error: null,
        input: { prompt: '戴红围巾的像素骑士', referenceMedia: [] },
      },
      {
        id: 'character-template',
        type: 'character-template',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['character-setup'],
        generations: [],
        error: null,
        selectedImageUrl: 'https://assets.windup.test/master.png',
      },
      {
        id: 'action-walk',
        type: 'action-first-frame',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['character-template'],
        generations: [],
        error: null,
        input: {
          outfitId: 'outfit-default',
          name: '行走',
          type: 'walk',
          prompt: '轻快地向前行走',
          fps: 12,
        },
        selectedFirstFrameUrl: 'https://assets.windup.test/walk-01.png',
      },
      {
        id: 'action-walk:action-generation-method',
        type: 'action-generation-method',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['action-walk'],
        generations: [],
        error: null,
        method: 'video-cropping',
      },
      {
        id: 'action-walk:action-full-frame',
        type: 'action-full-frame',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['action-walk:action-generation-method'],
        generations: [{ taskId: 'generation-walk', role: 'complete_animation' }],
        error: null,
      },
      {
        id: 'action-walk:review',
        type: 'review',
        status: 'active',
        phase: 'reviewing',
        dependsOnNodeIds: ['action-walk:action-full-frame'],
        generations: [],
        error: null,
      },
    ],
  }
}

function completeAnimationFixture(): Generation<'complete_animation'> {
  return {
    id: 'generation-walk',
    projectId: '42',
    type: 'complete_animation',
    status: 'completed',
    error: null,
    result: {
      type: 'complete_animation',
      frames: [
        { index: 0, url: 'https://assets.windup.test/walk-01.png', durationMs: 125 },
        { index: 1, url: 'https://assets.windup.test/walk-02.png', durationMs: 80 },
      ],
    },
  }
}
