/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkflowRun, WorkflowNode } from '@/entities'

import { NodeCanvasController } from './node-canvas'
import { WorkflowCanvas } from './workflow-canvas'

function createCandidateRun(): WorkflowRun {
  const common = {
    taskId: null,
    submissionId: null,
    error: null,
    dependsOnNodeIds: [],
  }
  const nodes: WorkflowNode[] = [
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
        type: 'character_image',
        imageUrls: Array.from(
          { length: 6 },
          (_, index) => `https://cdn.example.test/candidate-${index + 1}.png`,
        ),
      },
    },
    {
      ...common,
      id: 'revision-1:action-first-frame',
      type: 'action-first-frame',
      status: 'active',
      input: null,
      output: null,
    },
    {
      ...common,
      id: 'revision-1:action-generation-method',
      type: 'action-generation-method',
      status: 'locked',
      input: null,
      output: null,
    },
    {
      ...common,
      id: 'revision-1:action-full-frame',
      type: 'action-full-frame',
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
    status: 'active',
    nodes,
    generationStatus: 'completed',
    exportStatus: 'not_exported',
    prompt: null,
    createdAt: '2026-08-05T00:00:00.000Z',
  }
}

afterEach(cleanup)

describe('WorkflowCanvas candidate selection', () => {
  it('renders persisted graph edges instead of inferring them from DOM order', () => {
    const run = createCandidateRun()
    run.nodes = run.nodes.map((node, index) => ({
      ...node,
      dependsOnNodeIds: index === 0 ? [] : [run.nodes[index - 1]!.id],
    }))
    const controller = new NodeCanvasController()
    const setConnections = vi.spyOn(controller, 'setConnections')

    render(
      <WorkflowCanvas
        controller={controller}
        run={run}
        unavailableReason={null}
        onStepAction={vi.fn()}
      />,
    )

    expect(setConnections).toHaveBeenLastCalledWith([
      { from: 'revision-1:character-setup', to: 'revision-1:character-template' },
      { from: 'revision-1:character-template', to: 'revision-1:action-first-frame' },
      { from: 'revision-1:action-first-frame', to: 'revision-1:action-generation-method' },
      { from: 'revision-1:action-generation-method', to: 'revision-1:action-full-frame' },
      { from: 'revision-1:action-full-frame', to: 'revision-1:review' },
    ])
  })

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

    const secondCandidate = screen.getByRole('button', {
      name: /角色图候选 2/,
    })
    fireEvent.click(secondCandidate)

    expect(secondCandidate.getAttribute('aria-pressed')).toBe('true')
    const confirm = screen.getByRole('button', { name: '使用候选 02' })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(confirm)
    expect(onStepAction).toHaveBeenCalledWith('action-first-frame', 'confirm', {
      nodeId: 'revision-1:action-first-frame',
      selectedImageUrl: 'https://cdn.example.test/candidate-2.png',
    })
  })

  it('角色描述输入区清晰可见，并为长文本提供稳定的多行布局', () => {
    const run = createCandidateRun()
    const nodes = run.nodes
    nodes[0]!.status = 'active'
    nodes[0]!.input = null
    nodes[1]!.status = 'locked'

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

  it('在首帧确认后提供两种资产生成路线', () => {
    const run = createCandidateRun()
    run.nodes = run.nodes.map((node) =>
      node.type === 'action-first-frame'
        ? { ...node, status: 'passed' as const }
        : node.type === 'action-generation-method'
          ? { ...node, status: 'active' as const }
          : node,
    )
    const onStepAction = vi.fn()

    render(
      <WorkflowCanvas
        controller={new NodeCanvasController()}
        run={run}
        unavailableReason={null}
        onStepAction={onStepAction}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '使用视频裁剪生成' }))
    expect(onStepAction).toHaveBeenCalledWith('action-generation-method', 'select', {
      method: 'video-cropping',
      nodeId: 'revision-1:action-generation-method',
    })
    expect(
      (screen.getByRole('button', { name: '使用 3D 转 2D 生成' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('为同一角色的多组动作生成唯一节点并按独立分支分行排列', () => {
    const run = createCandidateRun()
    run.nodes = [
      ...run.nodes.map((node) => ({ ...node, status: 'passed' as const })),
      {
        ...run.nodes[2]!,
        id: 'revision-1:action-first-frame:2',
        status: 'passed',
        dependsOnNodeIds: ['revision-1:character-template'],
      },
      {
        ...run.nodes[3]!,
        id: 'revision-1:action-generation-method:2',
        status: 'passed',
        dependsOnNodeIds: ['revision-1:action-first-frame:2'],
      },
      {
        ...run.nodes[4]!,
        id: 'revision-1:action-full-frame:2',
        status: 'active',
        dependsOnNodeIds: ['revision-1:action-generation-method:2'],
        input: null,
        output: null,
      },
      {
        ...run.nodes[5]!,
        id: 'revision-1:review:2',
        status: 'locked',
        dependsOnNodeIds: ['revision-1:action-full-frame:2'],
        input: null,
        output: null,
      },
    ]

    const { container } = render(
      <WorkflowCanvas
        controller={new NodeCanvasController()}
        run={run}
        unavailableReason={null}
        onStepAction={vi.fn()}
      />,
    )

    const first = container.querySelector<HTMLElement>(
      '[data-node-id="revision-1:action-full-frame"]',
    )
    const second = container.querySelector<HTMLElement>(
      '[data-node-id="revision-1:action-full-frame:2"]',
    )
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(Number(second?.dataset.x)).toBe(Number(first?.dataset.x))
    expect(Number(second?.dataset.y)).toBeGreaterThan(Number(first?.dataset.y))
  })
})
