import { describe, expect, it } from 'vitest'

import type { MediaReference } from '@/entities'

import {
  acceptUploadedCharacterTemplateState,
  advanceCharacterSetupState,
  approveReviewState,
  createWorkflowRunState,
  restartWorkflowRunState,
  updateCharacterSetupState,
} from './workflow-state'

const CREATED_AT = '2026-07-31T02:40:00.000Z'

function createRun() {
  return createWorkflowRunState(
    {
      projectId: 'project-1',
      purpose: 'create_character',
      driver: 'ai',
      prompt: '  pixel knight  ',
    },
    {
      runId: 'run-1',
      revisionId: 'revision-1',
      createdAt: CREATED_AT,
    },
  )
}

describe('workflow state transitions', () => {
  it('creates the fixed five-step workflow and keeps export outside the step sequence', () => {
    const run = createRun()

    expect(run).toMatchObject({
      id: 'run-1',
      projectId: 'project-1',
      status: 'active',
      prompt: 'pixel knight',
      currentRevisionId: 'revision-1',
    })
    expect(run.revisions[0]?.createdAt).toBe(CREATED_AT)
    expect(run.revisions[0]?.steps.map(({ type, status }) => ({ type, status }))).toEqual([
      { type: 'character-setup', status: 'active' },
      { type: 'character-template', status: 'locked' },
      { type: 'template-candidate', status: 'locked' },
      { type: 'action-generation', status: 'locked' },
      { type: 'review', status: 'locked' },
    ])
    expect(run.revisions[0]?.exportStatus).toBe('not_exported')
    expect(run.revisions[0]?.steps[0]?.input).toEqual({
      description: 'pixel knight',
      referenceMedia: [],
    })
  })

  it('starts add_action directly at action generation for the existing outfit', () => {
    const run = createWorkflowRunState(
      {
        projectId: 'project-1',
        purpose: 'add_action',
        driver: 'ai',
        prompt: '挥手打招呼',
        characterId: 'character-1',
        outfitId: 'outfit-1',
        characterTemplateUrl: 'https://example.com/template.png',
        baseFrameUrls: [],
      },
      {
        runId: 'run-action-1',
        revisionId: 'revision-action-1',
        createdAt: CREATED_AT,
      },
    )

    expect(run).toMatchObject({
      purpose: 'add_action',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      prompt: '挥手打招呼',
    })
    expect(run.revisions[0]?.steps.map(({ type, status }) => ({ type, status }))).toEqual([
      { type: 'character-setup', status: 'passed' },
      { type: 'character-template', status: 'passed' },
      { type: 'template-candidate', status: 'passed' },
      { type: 'action-generation', status: 'active' },
      { type: 'review', status: 'locked' },
    ])
  })

  it('normalizes character setup input before storing it', () => {
    const updated = updateCharacterSetupState(createRun(), {
      description: '  revised knight  ',
      referenceMedia: [],
    })

    expect(updated.revisions[0]?.steps[0]?.input).toEqual({
      description: 'revised knight',
      referenceMedia: [],
    })
  })

  it('accepts an uploaded character template without fabricating an image generation task', () => {
    const accepted = acceptUploadedCharacterTemplateState(
      createRun(),
      'https://cdn.example.com/uploaded-character.png' as MediaReference,
    )
    const revision = accepted.revisions[0]!

    expect(revision.steps.map(({ type, status }) => ({ type, status }))).toEqual([
      { type: 'character-setup', status: 'passed' },
      { type: 'character-template', status: 'passed' },
      { type: 'template-candidate', status: 'passed' },
      { type: 'action-generation', status: 'active' },
      { type: 'review', status: 'locked' },
    ])
    expect(revision.steps[0]?.input).toEqual({
      description: '使用上传角色母版',
      referenceMedia: ['https://cdn.example.com/uploaded-character.png'],
    })
    expect(revision.steps[1]).toMatchObject({
      type: 'character-template',
      taskId: null,
      submissionId: null,
      input: null,
      output: {
        type: 'character_template',
        images: [{ url: 'https://cdn.example.com/uploaded-character.png' }],
      },
    })
    expect(revision.steps[2]?.output).toEqual({
      selectedImageUrl: 'https://cdn.example.com/uploaded-character.png',
    })
    expect(revision.generationStatus).toBe('not_started')
    expect(revision.steps.filter((step) => step.status === 'active')).toHaveLength(1)
  })

  it('activates character-template with its generation input snapshot', () => {
    const run = updateCharacterSetupState(createRun(), {
      description: 'revised knight',
      referenceMedia: [],
    })

    const transitioned = advanceCharacterSetupState(run, { width: 64, height: 64 })

    expect(transitioned.target).toEqual({
      revisionId: 'revision-1',
      stepId: 'revision-1:character-template',
    })
    expect(transitioned.run.revisions[0]?.steps.slice(0, 3)).toMatchObject([
      { type: 'character-setup', status: 'passed' },
      {
        type: 'character-template',
        status: 'active',
        input: {
          type: 'character_template',
          projectId: 'project-1',
          prompt: 'revised knight',
          referenceMedia: [],
          spriteWidth: 64,
          spriteHeight: 64,
        },
      },
      { type: 'template-candidate', status: 'locked' },
    ])
  })

  it('creates a new revision from a passed stage without retaining downstream outputs', () => {
    const prepared = advanceCharacterSetupState(createRun(), { width: 64, height: 64 }).run
    const sourceRevision = prepared.revisions[0]!
    const run = {
      ...prepared,
      revisions: [
        {
          ...sourceRevision,
          steps: sourceRevision.steps.map((step) =>
            step.type === 'character-template'
              ? { ...step, status: 'passed' as const }
              : step.type === 'template-candidate'
                ? { ...step, status: 'active' as const }
                : step,
          ),
        },
      ],
    }

    const restarted = restartWorkflowRunState(run, 'revision-1:character-template', {
      revisionId: 'revision-2',
      createdAt: '2026-07-31T03:00:00.000Z',
    })

    expect(restarted).toMatchObject({
      status: 'active',
      currentRevisionId: 'revision-2',
    })
    expect(restarted.revisions).toHaveLength(2)
    expect(restarted.revisions[0]?.status).toBe('abandoned')
    expect(restarted.revisions[1]).toMatchObject({
      id: 'revision-2',
      basedOnRevisionId: 'revision-1',
      restartStepId: 'revision-1:character-template',
    })
    expect(
      restarted.revisions[1]?.steps.map(({ type, status, referenceStepIds }) => ({
        type,
        status,
        referenceStepIds,
      })),
    ).toEqual([
      {
        type: 'character-setup',
        status: 'passed',
        referenceStepIds: ['revision-1:character-setup'],
      },
      {
        type: 'character-template',
        status: 'active',
        referenceStepIds: ['revision-1:character-template'],
      },
      { type: 'template-candidate', status: 'locked', referenceStepIds: [] },
      { type: 'action-generation', status: 'locked', referenceStepIds: [] },
      { type: 'review', status: 'locked', referenceStepIds: [] },
    ])
  })

  it('rejects a restart from a stage that has not passed', () => {
    expect(() =>
      restartWorkflowRunState(createRun(), 'revision-1:character-template', {
        revisionId: 'revision-2',
        createdAt: '2026-07-31T03:00:00.000Z',
      }),
    ).toThrow('只能从已通过的步骤重新开始')
  })

  it('completes the revision and run when the active review is approved', () => {
    const run = createRun()
    const readyForReview = {
      ...run,
      revisions: run.revisions.map((revision) => ({
        ...revision,
        generationStatus: 'completed' as const,
        steps: revision.steps.map((step) => ({
          ...step,
          status: step.type === 'review' ? ('active' as const) : ('passed' as const),
        })),
      })),
    }

    const completed = approveReviewState(readyForReview)

    expect(completed.status).toBe('completed')
    expect(completed.revisions[0]?.status).toBe('completed')
    expect(completed.revisions[0]?.steps.every((step) => step.status === 'passed')).toBe(true)
  })
})
