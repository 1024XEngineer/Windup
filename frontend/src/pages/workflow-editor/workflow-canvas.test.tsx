/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'

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

  it('角色描述输入区清晰可见，并为长文本提供稳定的多行布局', () => {
    const run = createCandidateRun()
    const steps = run.revisions[0]!.steps
    steps[0]!.status = 'active'
    steps[0]!.input = null
    steps[1]!.status = 'locked'

    render(
      <WorkflowCanvas
        controller={new NodeCanvasController()}
        run={run}
        unavailableReason={null}
        onStepAction={vi.fn()}
      />,
    )

    const description = screen.getByRole('textbox', { name: '角色描述' })
    expect(description.classList.contains('node-brief-form__textarea')).toBe(true)
    expect(description.getAttribute('rows')).toBe('5')
    expect(description.getAttribute('aria-describedby')).toBe('characterSetupDescriptionHint')
    expect(screen.getByText('支持多行输入，最多 500 字。')).toBeTruthy()

    const css = readFileSync('src/pages/workflow-editor/workflow-editor.css', 'utf8')
    const rule = css.match(/\.node-brief-form__textarea\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(rule).toContain('width: 100%')
    expect(rule).toContain('background:')
    expect(rule).toContain('white-space: pre-wrap')
    expect(rule).toContain('overflow-wrap: anywhere')
  })
})
