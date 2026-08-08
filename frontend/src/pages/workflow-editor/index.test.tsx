/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'

import { WorkflowEditorPage } from './index'

afterEach(cleanup)

describe('WorkflowEditorPage', () => {
  it('按六节点顺序展示资产生成方式选择', () => {
    const onSelect = vi.fn()
    render(
      <MemoryRouter initialEntries={['/workflow-editor/run-1']}>
        <Routes>
          <Route
            path="/workflow-editor/:runId"
            element={<WorkflowEditorPage onSelectGenerationMethod={onSelect} />}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: /视频裁剪/ }))
    fireEvent.click(screen.getByRole('button', { name: /3D 转 2D/ }))
    expect(onSelect.mock.calls).toEqual([['video-cropping'], ['3d-to-2d']])
  })

  it('没有 Controller 装配时不在页面内伪造选择', () => {
    render(
      <MemoryRouter>
        <WorkflowEditorPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /视频裁剪/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /3D 转 2D/ })).toHaveProperty('disabled', true)
  })
})
