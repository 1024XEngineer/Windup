import { describe, expect, it } from 'vitest'

import {
  advanceCharacterSetupState,
  createWorkflowRunState,
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
  it('creates the fixed workflow with normalized Quick Start input', () => {
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
      { type: 'action-setup', status: 'locked' },
      { type: 'first-frame', status: 'locked' },
      { type: 'complete-animation', status: 'locked' },
      { type: 'review', status: 'locked' },
      { type: 'export', status: 'locked' },
    ])
    expect(run.revisions[0]?.steps[0]?.input).toEqual({
      description: 'pixel knight',
      referenceMedia: [],
    })
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

  it('activates character-template with its generation input snapshot', () => {
    const run = updateCharacterSetupState(createRun(), {
      description: 'revised knight',
      referenceMedia: [],
    })

    const transitioned = advanceCharacterSetupState(run)

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
        },
      },
      { type: 'template-candidate', status: 'locked' },
    ])
  })
})
