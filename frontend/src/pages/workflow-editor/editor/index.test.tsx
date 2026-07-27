// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWorkflowRun } from '@/entities'
import { WorkflowEditor } from './index'

describe('WorkflowEditor 模块契约', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('不依赖 Router 也能通过公开接口加载工作流', async () => {
    const run = await createWorkflowRun({ projectId: 1, driver: 'manual' })

    render(
      <WorkflowEditor
        runId={run.id}
        focus={{ kind: 'step', stepId: run.steps[0].id }}
        onOpenPreview={vi.fn()}
      />,
    )

    expect(await screen.findByText(`定位步骤 ${run.steps[0].id}`)).toBeTruthy()
    expect(screen.getByText(/generate-template/)).toBeTruthy()
  })

  it('focus 变化时同步新的帧定位', async () => {
    const run = await createWorkflowRun({ projectId: 1, driver: 'manual' })
    const onOpenPreview = vi.fn()
    const view = render(
      <WorkflowEditor
        runId={run.id}
        focus={{ kind: 'step', stepId: 'step-1' }}
        onOpenPreview={onOpenPreview}
      />,
    )

    expect(await screen.findByText('定位步骤 step-1')).toBeTruthy()

    view.rerender(
      <WorkflowEditor
        runId={run.id}
        focus={{ kind: 'frame', stepId: 'step-2', actionId: 7, frameIndex: 2 }}
        onOpenPreview={onOpenPreview}
      />,
    )

    expect(await screen.findByText('定位步骤 step-2／动作 7 第 3 帧')).toBeTruthy()
  })
})
