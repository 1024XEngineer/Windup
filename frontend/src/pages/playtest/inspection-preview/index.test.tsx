// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InspectionPreview } from './index'

const outfit = {
  id: 'outfit-1',
  characterId: 'character-42',
  name: '默认造型',
  candidateCharacterTemplates: [],
  characterTemplateUrl: null,
  baseFrames: [],
  actions: [],
}

describe('InspectionPreview 模块契约', () => {
  afterEach(cleanup)

  it('只上报通过或发现问题，不直接修改工作流', () => {
    const onRecordStatus = vi.fn(async () => {})
    render(
      <InspectionPreview
        characterId="character-42"
        outfit={outfit}
        status={null}
        onRecordStatus={onRecordStatus}
      />,
    )

    expect(screen.getByText(/默认造型/)).toBeTruthy()
    expect(screen.getByText(/尚未记录/)).toBeTruthy()
    expect(screen.queryByRole('toolbar', { name: '预览工具' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '记录为通过' }))
    expect(onRecordStatus).toHaveBeenLastCalledWith('passed')
    fireEvent.click(screen.getByRole('button', { name: '记录发现问题' }))
    expect(onRecordStatus).toHaveBeenLastCalledWith('issues_found')
    expect(screen.queryByRole('button', { name: '返回审核' })).toBeNull()
  })
})
