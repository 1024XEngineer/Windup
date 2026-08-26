/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WorkspaceEntranceVisual } from './visuals'

describe('WorkspaceEntranceVisual', () => {
  it.each([
    ['quick-start', 'quick-start.png'],
    ['workflow', 'workflow.png'],
    ['asset', 'asset-library.png'],
    ['playtest', 'playtest.png'],
  ] as const)('uses the %s pixel artwork', (kind, filename) => {
    const { container } = render(<WorkspaceEntranceVisual kind={kind} />)

    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toContain(filename)
    expect(image?.getAttribute('aria-hidden')).toBe('true')
  })

  it('marks a selected entrance so its artwork can remain in color', () => {
    const { container } = render(<WorkspaceEntranceVisual kind="workflow" selected />)

    expect(container.firstElementChild?.getAttribute('data-selected')).toBe('true')
  })
})
