/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkflowRun, WorkflowStep } from '@/entities'

import { NodeCanvasController } from './node-canvas'
import { WorkflowCanvas } from './workflow-canvas'

function createCandidateRun(): WorkflowRun {
  const common = {
    taskId: null,
    submissionId: null,
    error: null,
    referenceStepIds: [],
  }
  const steps: WorkflowStep[] = [
    {
      ...common,
      id: 'revision-1:character-setup',
      type: 'character-setup',
      status: 'passed',
      input: { description: '灯笼守夜人', referenceMedia: [] },
      output: null,
    },
    {
      ...common,
      id: 'revision-1:character-template',
      type: 'character-template',
      status: 'passed',
      input: null,
      output: {
        type: 'character_template',
        images: Array.from({ length: 6 }, (_, index) => ({
          url: `https://cdn.example.test/candidate-${index + 1}.png`,
        })),
      },
    },
    {
      ...common,
      id: 'revision-1:template-candidate',
      type: 'template-candidate',
      status: 'active',
      input: null,
      output: null,
    },
    {
      ...common,
      id: 'revision-1:action-generation',
      type: 'action-generation',
      status: 'locked',
      input: null,
      output: null,
    },
    {
      ...common,
      id: 'revision-1:review',
      type: 'review',
      status: 'locked',
      input: null,
      output: null,
    },
  ]

  return {
    id: 'run-1',
    projectId: 'project-1',
    characterId: null,
    outfitId: null,
    purpose: 'create_character',
    driver: 'manual',
    status: 'active',
    currentRevisionId: 'revision-1',
    revisions: [
      {
        id: 'revision-1',
        basedOnRevisionId: null,
        restartStepId: null,
        status: 'active',
        steps,
        generationStatus: 'completed',
        exportStatus: 'not_exported',
        createdAt: '2026-08-05T00:00:00.000Z',
      },
    ],
    prompt: null,
  }
}

afterEach(cleanup)

describe('WorkflowCanvas candidate selection', () => {
  it('只展示四张候选，并明确标记当前选中项', () => {
    const onStepAction = vi.fn()
    render(
      <WorkflowCanvas
        controller={new NodeCanvasController()}
        run={createCandidateRun()}
        unavailableReason={null}
        onStepAction={onStepAction}
      />,
    )

    expect(screen.getByText('4 选 1')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /角色图候选/ })).toHaveLength(4)
    expect(screen.queryByRole('img', { name: '角色图候选 5' })).toBeNull()

    const secondCandidate = screen.getByRole('button', { name: /角色图候选 2/ })
    fireEvent.click(secondCandidate)

    expect(secondCandidate.getAttribute('aria-pressed')).toBe('true')
    const confirm = screen.getByRole('button', { name: '使用候选 02' })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(confirm)
    expect(onStepAction).toHaveBeenCalledWith('template-candidate', 'confirm', {
      selectedImageUrl: 'https://cdn.example.test/candidate-2.png',
    })
  })
})
