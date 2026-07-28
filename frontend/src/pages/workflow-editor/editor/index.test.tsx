// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWorkflowRun, getCurrentRevision } from '@/entities'
import { WorkflowEditor } from './index'

afterEach(cleanup)

describe('WorkflowEditor', () => {
  it('稳定渲染五个节点，未进入执行线的节点保持锁定', async () => {
    const run = await createWorkflowRun({ projectId: 'project-1', driver: 'manual' })
    const revision = getCurrentRevision(run)

    render(
      <WorkflowEditor
        run={run}
        revision={revision}
        activeType="asset"
        readOnly={false}
        onSelectNode={vi.fn()}
        onOpenRevision={vi.fn()}
        onRestartNode={vi.fn()}
        onOpenPreview={vi.fn()}
      />,
    )

    expect((screen.getByRole('button', { name: /资产设置/ }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    expect((screen.getByRole('button', { name: /AI 生成/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: /导出/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/当前版本/)).toBeTruthy()
  })

  it('历史版本显示只读状态并允许从已有节点重新开始', async () => {
    const run = await createWorkflowRun({ projectId: 'quick-start', driver: 'ai', prompt: '骑士' })
    const revision = getCurrentRevision(run)
    const onRestartNode = vi.fn(async () => undefined)

    render(
      <WorkflowEditor
        run={{ ...run, currentRevisionId: 'revision-current' }}
        revision={revision}
        activeType="generation"
        readOnly
        onSelectNode={vi.fn()}
        onOpenRevision={vi.fn()}
        onRestartNode={onRestartNode}
        onOpenPreview={vi.fn()}
      />,
    )

    expect(screen.getByText(/历史只读/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '从此节点重新开始' }))
    expect(onRestartNode).toHaveBeenCalledWith(
      revision.nodes.find((node) => node.type === 'generation')!.id,
    )
  })
})
