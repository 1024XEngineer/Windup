// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { GenerationProgressCopy } from './generation-progress-copy'

afterEach(cleanup)

describe('GenerationProgressCopy', () => {
  it('把排队提示拼进原提示语并复用逐字动画', () => {
    const view = render(
      <GenerationProgressCopy kind="character-template" label="角色生成进度" queueAhead={2} />,
    )
    const copy = screen.getByLabelText('角色生成进度，排队中，前方还有 2 个任务')
    const line = copy.querySelector('.kinetic-copy-line-inner')
    const expected = '勾勒角色轮廓（排队中，前方还有 2 个任务）'

    expect(line?.textContent?.replaceAll('\u00a0', ' ')).toBe(expected)
    expect(line?.querySelectorAll('.kinetic-copy-character')).toHaveLength(
      Array.from(expected).length,
    )
    view.unmount()

    const withoutQueue = render(
      <GenerationProgressCopy kind="character-template" label="角色生成进度" queueAhead={0} />,
    )
    expect(withoutQueue.container.textContent).not.toContain('排队中')
  })
})
