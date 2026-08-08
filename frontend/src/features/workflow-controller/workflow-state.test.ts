import { describe, expect, it } from 'vitest'

import type { MediaReference, WorkflowRun } from '@/entities'

import {
  acceptUploadedCharacterTemplateState,
  advanceCharacterSetupState,
  appendActionState,
  approveReviewState,
  beginActionGenerationState,
  completeActionGenerationState,
  createWorkflowRunState,
  markActionDeletedState,
  restartWorkflowRunState,
  selectActionGenerationMethodState,
  updateCharacterSetupState,
} from './workflow-state'

const CREATED_AT = '2026-07-31T02:40:00.000Z'

function createRun() {
  return createWorkflowRunState(
    {
      projectId: 'project-1',
      purpose: 'create_character',
      prompt: '  pixel knight  ',
    },
    { runId: 'run-1', createdAt: CREATED_AT },
  )
}

function readyForReview(): WorkflowRun {
  const run = createRun()
  return {
    ...run,
    characterId: 'character-1',
    outfitId: 'outfit-1',
    generationStatus: 'completed',
    nodes: run.nodes.map((node) => ({
      ...node,
      status: node.type === 'review' ? ('active' as const) : ('passed' as const),
    })),
  }
}

describe('workflow state transitions', () => {
  it('creates one WorkflowRun with six explicit graph nodes and edges', () => {
    const run = createRun()

    expect(run).toMatchObject({
      id: 'run-1',
      projectId: 'project-1',
      status: 'active',
      prompt: 'pixel knight',
      createdAt: CREATED_AT,
    })
    expect(
      run.nodes.map(({ type, status, dependsOnNodeIds }) => ({ type, status, dependsOnNodeIds })),
    ).toEqual([
      { type: 'character-setup', status: 'active', dependsOnNodeIds: [] },
      { type: 'character-template', status: 'locked', dependsOnNodeIds: ['run-1:character-setup'] },
      {
        type: 'action-first-frame',
        status: 'locked',
        dependsOnNodeIds: ['run-1:character-template'],
      },
      {
        type: 'action-generation-method',
        status: 'locked',
        dependsOnNodeIds: ['run-1:action-first-frame'],
      },
      {
        type: 'action-full-frame',
        status: 'locked',
        dependsOnNodeIds: ['run-1:action-generation-method'],
      },
      { type: 'review', status: 'locked', dependsOnNodeIds: ['run-1:action-full-frame'] },
    ])
  })

  it('starts add_action at its own first-frame generation for the existing outfit', () => {
    const run = createWorkflowRunState(
      {
        projectId: 'project-1',
        purpose: 'add_action',
        prompt: '挥手打招呼',
        characterId: 'character-1',
        outfitId: 'outfit-1',
        characterTemplateUrl: 'https://example.com/template.png',
        baseFrameUrls: [],
      },
      { runId: 'run-action-1', createdAt: CREATED_AT },
    )

    expect(run.nodes.map(({ type, status }) => ({ type, status }))).toEqual([
      { type: 'character-setup', status: 'passed' },
      { type: 'character-template', status: 'passed' },
      { type: 'action-first-frame', status: 'active' },
      { type: 'action-generation-method', status: 'locked' },
      { type: 'action-full-frame', status: 'locked' },
      { type: 'review', status: 'locked' },
    ])
  })

  it('records the chosen video-cropping route before activating full animation', () => {
    const run = createWorkflowRunState(
      {
        projectId: 'project-1',
        purpose: 'add_action',
        prompt: '挥手',
        characterId: 'character-1',
        outfitId: 'outfit-1',
        characterTemplateUrl: 'template.png',
        baseFrameUrls: [],
      },
      { runId: 'run-method', createdAt: CREATED_AT },
    )

    const firstFrame = run.nodes.find((node) => node.type === 'action-first-frame')!
    const generated = completeActionGenerationState(
      run,
      {
        type: 'character_action',
        actionType: 'custom',
        frames: [{ index: 0, imageUrl: 'first.png', durationMs: null }],
      },
      firstFrame.id,
    )
    const selected = selectActionGenerationMethodState(generated, 'video-cropping')

    expect(selected.nodes.find((node) => node.type === 'action-generation-method')).toMatchObject({
      status: 'passed',
      input: { method: 'video-cropping' },
    })
    expect(selected.nodes.find((node) => node.type === 'action-full-frame')?.status).toBe('active')
  })

  it('normalizes setup and advances with a frozen generation input', () => {
    const updated = updateCharacterSetupState(createRun(), {
      description: '  revised knight  ',
      referenceMedia: [],
    })
    const transitioned = advanceCharacterSetupState(updated, {
      width: 64,
      height: 64,
    })

    expect(transitioned.target).toEqual({
      runId: 'run-1',
      nodeId: 'run-1:character-template',
    })
    expect(transitioned.run.nodes[1]).toMatchObject({
      type: 'character-template',
      status: 'active',
      input: {
        type: 'character_image',
        projectId: 'project-1',
        prompt: 'revised knight',
        spriteWidth: 64,
        spriteHeight: 64,
      },
    })
  })

  it('accepts an uploaded template without fabricating a generation task', () => {
    const accepted = acceptUploadedCharacterTemplateState(
      createRun(),
      'https://cdn.example.com/uploaded.png' as MediaReference,
    )

    expect(accepted.nodes[1]).toMatchObject({
      type: 'character-template',
      status: 'passed',
      taskId: null,
      output: {
        type: 'character_image',
        imageUrls: ['https://cdn.example.com/uploaded.png'],
      },
    })
    expect(accepted.nodes[2]).toMatchObject({
      type: 'action-first-frame',
      status: 'active',
      output: null,
    })
    expect(accepted.nodes[3]).toMatchObject({
      type: 'action-generation-method',
      status: 'locked',
    })
  })

  it('completes the run when the active review is approved', () => {
    const completed = approveReviewState(readyForReview())

    expect(completed.status).toBe('completed')
    expect(completed.nodes.every((node) => node.status === 'passed')).toBe(true)
  })

  it('appends an independent four-node action branch before the current action is reviewed', () => {
    const run = readyForReview()
    const appended = appendActionState(run)

    expect(appended.id).toBe('run-1')
    expect(appended.status).toBe('active')
    expect(
      appended.nodes.slice(-4).map(({ id, type, status, dependsOnNodeIds }) => ({
        id,
        type,
        status,
        dependsOnNodeIds,
      })),
    ).toEqual([
      {
        id: 'run-1:action-first-frame:2',
        type: 'action-first-frame',
        status: 'active',
        dependsOnNodeIds: ['run-1:character-template'],
      },
      {
        id: 'run-1:action-generation-method:2',
        type: 'action-generation-method',
        status: 'locked',
        dependsOnNodeIds: ['run-1:action-first-frame:2'],
      },
      {
        id: 'run-1:action-full-frame:2',
        type: 'action-full-frame',
        status: 'locked',
        dependsOnNodeIds: ['run-1:action-generation-method:2'],
      },
      {
        id: 'run-1:review:2',
        type: 'review',
        status: 'locked',
        dependsOnNodeIds: ['run-1:action-full-frame:2'],
      },
    ])
    expect(appended.nodes.filter((node) => node.status === 'active')).toHaveLength(2)
    expect(new Set(appended.nodes.map((node) => node.id)).size).toBe(appended.nodes.length)
  })

  it('approves one action branch without completing another active branch', () => {
    const run = appendActionState(readyForReview())
    const approved = approveReviewState(run, 'run-1:review')

    expect(approved.status).toBe('active')
    expect(approved.nodes.find((node) => node.id === 'run-1:review')?.status).toBe('passed')
    expect(approved.nodes.find((node) => node.id === 'run-1:action-first-frame:2')?.status).toBe(
      'active',
    )
  })

  it('marks the complete action branch deleted without erasing its generated output', () => {
    const run = readyForReview()
    const deleted = markActionDeletedState(
      run,
      'run-1:action-full-frame',
      '2026-08-08T14:00:00.000Z',
    )

    expect(deleted.nodes.filter((node) => node.deletedAt).map((node) => node.type)).toEqual([
      'action-first-frame',
      'action-generation-method',
      'action-full-frame',
      'review',
    ])
    expect(deleted.nodes.find((node) => node.id === 'run-1:action-full-frame')?.output).toEqual(
      run.nodes.find((node) => node.id === 'run-1:action-full-frame')?.output,
    )
    expect(deleted.nodes.find((node) => node.type === 'character-template')?.deletedAt).toBeFalsy()
  })

  it('records a 32-frame action without overwriting earlier action nodes', () => {
    const appended = appendActionState(approveReviewState(readyForReview()))
    const input = {
      type: 'character_action' as const,
      projectId: 'project-1',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionType: 'custom' as const,
      firstFrameUrl: 'template.png',
      prompt: '挥手',
      referenceMedia: ['template.png' as MediaReference],
      numFrames: 32,
    }
    const submitting = beginActionGenerationState(
      {
        ...appended,
        nodes: appended.nodes.map((node) =>
          node.id === 'run-1:action-first-frame:2' && node.type === 'action-first-frame'
            ? { ...node, status: 'passed' as const }
            : node.id === 'run-1:action-generation-method:2' &&
                node.type === 'action-generation-method'
              ? { ...node, status: 'passed' as const, input: { method: 'video-cropping' as const } }
              : node.id === 'run-1:action-full-frame:2' && node.type === 'action-full-frame'
                ? { ...node, status: 'active' as const }
                : node,
        ),
      },
      input,
      'submission-2',
      'run-1:action-full-frame:2',
    )
    const generated = completeActionGenerationState(submitting, {
      type: 'character_action',
      actionType: 'custom',
      frames: Array.from({ length: 32 }, (_, index) => ({
        index,
        imageUrl: `wave-${index}.png`,
        durationMs: null,
      })),
    })

    expect(generated.nodes.filter((node) => node.type === 'action-full-frame')).toHaveLength(2)
    expect(generated.nodes.at(-2)).toMatchObject({ status: 'passed' })
    expect(generated.nodes.at(-1)).toMatchObject({
      type: 'review',
      status: 'active',
    })
  })

  it('restarts a passed node in place and clears its downstream results', () => {
    const run = readyForReview()
    const restarted = restartWorkflowRunState(run, 'run-1:character-template')

    expect(restarted.id).toBe(run.id)
    expect(restarted.nodes[1]).toMatchObject({
      status: 'active',
      output: null,
    })
    expect(restarted.nodes.slice(2).every((node) => node.status === 'locked')).toBe(true)
  })
})
