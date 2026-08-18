import { describe, expect, it } from 'vitest'

import type { Character, Generation, Project, WorkflowRun } from '@/entities'

import { createProgressiveExportModel } from './progressive-export'

const project: Project = {
  id: 'project-1',
  workflowId: null,
  name: '像素项目',
  perspective: 'side',
  directionalMovement: 'single',
  spriteSize: { width: 32, height: 40 },
  gameStyle: null,
  sampleImageUrl: null,
  createdAt: '2026-08-01T08:00:00Z',
  updatedAt: '2026-08-01T08:00:00Z',
}

const character: Character = {
  id: 'character-1',
  projectId: project.id,
  workflowRunId: 'run-1',
  name: null,
  description: null,
  referenceImageUrl: '/master.png',
  dataVersion: 1,
  status: 1,
  outfits: [
    {
      id: 'outfit-1',
      characterId: 'character-1',
      name: '默认造型',
      description: null,
      previewUrl: '/master.png',
      model3dUrl: null,
      actions: [],
    },
  ],
}

const run: WorkflowRun = {
  id: 'run-1',
  projectId: project.id,
  version: 3,
  storageStatus: 'active',
  nodes: [
    {
      id: 'setup',
      type: 'character-setup',
      status: 'passed',
      phase: 'completed',
      dependsOnNodeIds: [],
      generations: [],
      error: null,
      input: { name: '无名旅人', characterId: 'character-1', prompt: '', referenceMedia: [] },
    },
    {
      id: 'template',
      type: 'character-template',
      status: 'passed',
      phase: 'completed',
      dependsOnNodeIds: ['setup'],
      generations: [{ taskId: 'generation-template', role: 'character_template' }],
      error: null,
      selectedImageUrl: '/master.png',
    },
    {
      id: 'walk-first',
      type: 'action-first-frame',
      status: 'passed',
      phase: 'completed',
      dependsOnNodeIds: ['template'],
      generations: [{ taskId: 'generation-first', role: 'first_frame' }],
      error: null,
      input: {
        outfitId: 'outfit-1',
        name: '行走',
        type: 'walk',
        prompt: null,
        fps: 10,
      },
      selectedFirstFrameUrl: '/walk-first.png',
    },
  ],
}

describe('createProgressiveExportModel', () => {
  it('拒绝把其它 WorkflowRun 的完成度拼到当前角色', () => {
    expect(() =>
      createProgressiveExportModel({
        project,
        character,
        outfitId: 'outfit-1',
        run: { ...run, id: 'other-run' },
      }),
    ).toThrow('WorkflowRun 与角色或项目不匹配')
  })

  it('角色母版完成后即可构造不含动作的基础导出包', () => {
    const model = createProgressiveExportModel({
      project,
      character,
      outfitId: 'outfit-1',
    })

    expect(model).toMatchObject({
      stage: 'character',
      characterName: '未命名角色',
      characterImageUrl: '/master.png',
      firstFrames: [],
      actions: [],
      playtest: null,
    })
  })

  it('WorkflowRun 中已确认的首帧会在基础包上增量出现', () => {
    const model = createProgressiveExportModel({ project, character, outfitId: 'outfit-1', run })

    expect(model.stage).toBe('first-frame')
    expect(model.characterName).toBe('无名旅人')
    expect(model.firstFrames).toEqual([
      {
        actionId: 'walk-first',
        name: '行走',
        type: 'walk',
        fps: 10,
        imageUrl: '/walk-first.png',
      },
    ])
    expect(model.source).toEqual({
      workflowRunId: 'run-1',
      generationIds: ['generation-template', 'generation-first'],
    })
  })

  it('完整动作与 Playtest 只提升阶段，不丢失角色母版和首帧', () => {
    const withAction: Character = {
      ...character,
      outfits: [
        {
          ...character.outfits[0]!,
          actions: [
            {
              id: 'walk',
              outfitId: 'outfit-1',
              name: '行走',
              type: 'walk',
              loop: true,
              fps: 10,
              frameCount: 1,
              frames: [{ index: 0, imageUrl: '/walk-0.png', durationMs: 100 }],
            },
          ],
        },
      ],
    }

    const actionModel = createProgressiveExportModel({
      project,
      character: withAction,
      outfitId: 'outfit-1',
      run,
    })
    const playtestModel = createProgressiveExportModel({
      project,
      character: withAction,
      outfitId: 'outfit-1',
      run,
      playtest: { initialActionId: 'walk' },
    })

    expect(actionModel.stage).toBe('action-assets')
    expect(playtestModel.stage).toBe('playtest')
    expect(playtestModel.characterImageUrl).toBe(actionModel.characterImageUrl)
    expect(playtestModel.firstFrames).toEqual(actionModel.firstFrames)
    expect(playtestModel.actions).toEqual(actionModel.actions)
    expect(playtestModel.playtest).toEqual({ initialActionId: 'walk' })
  })

  it('完整动画 Generation 完成后、发布到 Character 前即可导出动作资产', () => {
    const actionRun: WorkflowRun = {
      ...run,
      nodes: [
        ...run.nodes,
        {
          id: 'walk-method',
          type: 'action-generation-method',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['walk-first'],
          generations: [],
          error: null,
          method: 'video-cropping',
        },
        {
          id: 'walk-full',
          type: 'action-full-frame',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['walk-method'],
          generations: [{ taskId: 'generation-full', role: 'complete_animation' }],
          error: null,
        },
        {
          id: 'walk-review',
          type: 'review',
          status: 'active',
          phase: 'reviewing',
          dependsOnNodeIds: ['walk-full'],
          generations: [],
          error: null,
        },
      ],
    }
    const generation = {
      id: 'generation-full',
      projectId: project.id,
      type: 'complete_animation',
      status: 'completed',
      error: null,
      result: {
        type: 'complete_animation',
        frames: [{ index: 0, url: '/walk-0.png', durationMs: 100 }],
      },
    } satisfies Generation<'complete_animation'>

    const model = createProgressiveExportModel({
      project,
      character,
      outfitId: 'outfit-1',
      run: actionRun,
      generations: [generation],
    })

    expect(model.stage).toBe('action-assets')
    expect(model.actions[0]).toMatchObject({ id: 'walk-full', name: '行走' })
    expect(model.actions[0]?.sequences[0]).toMatchObject({
      qualityStatus: 'pending',
      frames: [{ index: 0, imageUrl: '/walk-0.png', durationMs: 100 }],
    })
  })

  it('同名但不同 ID 的已发布与生成中动作不会互相覆盖', () => {
    const withPublishedAction: Character = {
      ...character,
      outfits: [
        {
          ...character.outfits[0]!,
          actions: [
            {
              id: 'published-walk',
              outfitId: 'outfit-1',
              name: '行走',
              type: 'walk',
              loop: true,
              fps: 10,
              frameCount: 1,
              frames: [{ index: 0, imageUrl: '/published-walk.png', durationMs: 100 }],
            },
          ],
        },
      ],
    }
    const actionRun: WorkflowRun = {
      ...run,
      nodes: [
        ...run.nodes,
        {
          id: 'walk-method',
          type: 'action-generation-method',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['walk-first'],
          generations: [],
          error: null,
          method: 'video-cropping',
        },
        {
          id: 'generated-walk',
          type: 'action-full-frame',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['walk-method'],
          generations: [{ taskId: 'generation-full', role: 'complete_animation' }],
          error: null,
        },
      ],
    }
    const generation = {
      id: 'generation-full',
      projectId: project.id,
      type: 'complete_animation',
      status: 'completed',
      error: null,
      result: {
        type: 'complete_animation',
        frames: [{ index: 0, url: '/generated-walk.png', durationMs: 100 }],
      },
    } satisfies Generation<'complete_animation'>

    const model = createProgressiveExportModel({
      project,
      character: withPublishedAction,
      outfitId: 'outfit-1',
      run: actionRun,
      generations: [generation],
    })

    expect(model.actions.map((action) => action.id)).toEqual(['published-walk', 'generated-walk'])
    expect(model.firstFrames.map((frame) => frame.actionId)).toEqual([
      'walk-first',
      'published-walk',
    ])
  })
})
