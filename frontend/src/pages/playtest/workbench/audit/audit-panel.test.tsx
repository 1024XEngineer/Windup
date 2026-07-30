/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PreviewFrame } from '../model/types'
import { AuditPanel } from './audit-panel'

const frame: PreviewFrame = {
  imageUrl: '/walk-03.png',
  durationMs: 100,
  rootMotion: { dx: 4, dy: 0 },
  keyFrame: false,
}

afterEach(cleanup)

describe('AuditPanel', () => {
  it('marks the current frame and keeps automatic findings read-only', () => {
    const onAdd = vi.fn()
    render(
      <AuditPanel
        actionId="walk"
        actionName="行走"
        direction="south"
        frameIndex={2}
        frame={frame}
        automaticFindings={[
          {
            code: 'subject_cropped',
            severity: 'error',
            frameIndex: 2,
            message: '主体接触画布边缘，可能发生裁切',
            metrics: {},
          },
        ]}
        issues={[]}
        onAdd={onAdd}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText('自动')).toBeTruthy()
    expect(screen.getByText('主体接触画布边缘，可能发生裁切')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('问题类型'), {
      target: { value: 'style_inconsistent' },
    })
    fireEvent.change(screen.getByLabelText('问题说明'), {
      target: { value: '衣服颜色跳变' },
    })
    fireEvent.click(screen.getByRole('button', { name: '标记当前帧问题' }))

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'style_inconsistent',
        actionId: 'walk',
        direction: 'south',
        frameIndex: 2,
        imageUrl: '/walk-03.png',
        note: '衣服颜色跳变',
      }),
    )
  })

  it('edits and removes an existing manual issue', () => {
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    render(
      <AuditPanel
        actionId="walk"
        actionName="行走"
        direction="south"
        frameIndex={2}
        frame={frame}
        automaticFindings={[]}
        issues={[
          {
            id: 'manual-1',
            category: 'motion_discontinuity',
            actionId: 'walk',
            direction: 'south',
            frameIndex: 2,
            imageUrl: '/walk-03.png',
            note: '步幅突然变化',
          },
        ]}
        onAdd={vi.fn()}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByText('人工')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('人工问题类型'), {
      target: { value: 'motion_direction' },
    })
    fireEvent.change(screen.getByLabelText('人工问题说明'), {
      target: { value: '移动方向错误' },
    })
    fireEvent.click(screen.getByRole('button', { name: '删除人工问题' }))

    expect(onUpdate).toHaveBeenCalledWith('manual-1', 'motion_direction', '步幅突然变化')
    expect(onUpdate).toHaveBeenCalledWith('manual-1', 'motion_discontinuity', '移动方向错误')
    expect(onRemove).toHaveBeenCalledWith('manual-1')
  })
})
