// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InspectionPreview } from './index'

describe('InspectionPreview 模块契约', () => {
  afterEach(() => {
    cleanup()
  })

  it('不依赖 Router 也能通过公开接口渲染', () => {
    render(<InspectionPreview characterId={42} onOpenWorkflowAtFrame={vi.fn()} />)

    expect(screen.getByText(/检查\/预览台待实现（角色 42）/)).toBeTruthy()
  })
})
