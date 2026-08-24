import { describe, expect, it } from 'vitest'

import type {
  ActionDirection,
  Character,
  CharacterApis,
  DirectionalMovement,
  Generation,
  WorkflowRun,
} from '@/entities'

import * as exportFeature from './index'

interface ExportFeatureModule {
  createCharacterAssetPublisher(apis: Pick<CharacterApis, 'update'>): {
    publishReviewedAction(input: {
      character: Character
      workflow: WorkflowRun
      reviewNodeId: string
      generation?: Generation
      generations?: readonly Generation[]
      directionalMovement?: DirectionalMovement
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
      expect.objectContaining({
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
      }),
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

  it('publishes every real and mirrored direction into one action', async () => {
    const publisher = (
      exportFeature as unknown as ExportFeatureModule
    ).createCharacterAssetPublisher({
      async update(character) {
        return structuredClone(character)
      },
    })
    const workflow = workflowFixture()
    const fullFrame = workflow.nodes.find((node) => node.type === 'action-full-frame')!
    fullFrame.generations = [
      { taskId: 'generation-east', role: 'complete_animation', direction: 'east' },
      { taskId: 'generation-west', role: 'complete_animation', direction: 'west' },
      { taskId: 'generation-north', role: 'complete_animation', direction: 'north' },
      { taskId: 'generation-south', role: 'complete_animation', direction: 'south' },
    ]

    const published = await publisher.publishReviewedAction({
      character: characterFixture(),
      workflow,
      reviewNodeId: 'action-walk:review',
      generations: [
        directionalAnimationFixture('generation-east', 'east', 'east'),
        directionalAnimationFixture('generation-west', 'west', 'west'),
        directionalAnimationFixture('generation-north', 'north', 'north'),
        directionalAnimationFixture('generation-south', 'south', 'south'),
      ],
      directionalMovement: 'four-way',
    })

    expect(published.outfits[0]?.actions.at(-1)?.sequences).toEqual([
      {
        direction: 'east',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: 'east-0.png', durationMs: 80 }],
      },
      {
        direction: 'west',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: 'west-0.png', durationMs: 80 }],
      },
      {
        direction: 'north',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: 'north-0.png', durationMs: 80 }],
      },
      {
        direction: 'south',
        sourceDirection: null,
        mirrorX: false,
        frameCount: 1,
        frames: [{ index: 0, imageUrl: 'south-0.png', durationMs: 80 }],
      },
    ])
  })

  it('rejects a directional action when any real source direction is missing', () => {
    expect(() =>
      exportFeature.createActionSequences(
        [directionalAnimationFixture('generation-east', 'east', 'east')],
        'four-way',
      ),
    ).toThrow('完整动画方向 west 的生成结果不可发布')
  })

  it('八向导出保留八个独立序列，不生成镜像占位', () => {
    const directions = [
      'east',
      'west',
      'north',
      'south',
      'north_east',
      'north_west',
      'south_east',
      'south_west',
    ] as const

    const sequences = exportFeature.createActionSequences(
      directions.map((direction) =>
        directionalAnimationFixture(`generation-${direction}`, direction, direction),
      ),
      'eight-way',
    )

    expect(sequences.map((sequence) => sequence.direction)).toEqual(directions)
    expect(sequences.every((sequence) => sequence.sourceDirection === null)).toBe(true)
    expect(sequences.every((sequence) => !sequence.mirrorX && sequence.frames.length === 1)).toBe(
      true,
    )
  })

  it('拒绝未携带任何生成结果的发布请求', async () => {
    const publisher = createRejectingPublisher()

    await expect(
      publisher.publishReviewedAction({
        character: characterFixture(),
        workflow: workflowFixture(),
        reviewNodeId: 'action-walk:review',
      }),
    ).rejects.toThrow('Generation 与当前 WorkflowRun 不匹配')
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
    ).rejects.toThrow('完整动画方向 east 的生成结果不可发布')
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
        model3dUrl: null,
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

function directionalAnimationFixture(
  id: string,
  direction: ActionDirection,
  prefix: string,
): Generation<'complete_animation'> {
  return {
    id,
    projectId: '42',
    type: 'complete_animation',
    status: 'completed',
    error: null,
    result: {
      type: 'complete_animation',
      direction,
      frames: [{ index: 0, url: `${prefix}-0.png`, durationMs: 80 }],
    },
  }
}
