// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppShell } from './index'

afterEach(cleanup)

describe('AppShell', () => {
  it.each([
    ['/', '首页'],
    ['/playtest/demo', 'Playtest'],
    ['/workflow-editor/run-1', 'Workflow Editor'],
  ])('为%s 使用全宽页面容器', (pathname) => {
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <AppShell>
          <div>页面内容</div>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('main').className).toContain('w-full')
    expect(screen.getByRole('main').className).not.toContain('max-w-5xl')
  })
})
