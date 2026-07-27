// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InspectionPreview } from './index'

describe('InspectionPreview 模块契约', () => {
  afterEach(cleanup)

  it('不依赖 Router 即可记录非阻断核验结论', () => {
    const onRecordStatus = vi.fn(async () => undefined)
    render(
      <InspectionPreview
        characterId="character-42"
        runId="run-1"
        revisionId="revision-1"
        status="not_tested"
        onRecordStatus={onRecordStatus}
        onOpenReview={vi.fn()}
      />,
    )

    expect(screen.getByText(/来源 run-1 \/ revision-1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '记录发现问题' }))
    expect(onRecordStatus).toHaveBeenCalledWith('issues_found')
  })
})
