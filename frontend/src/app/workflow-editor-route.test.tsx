/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Outlet } from 'react-router'

import { AuthenticatedAuthSession } from '@/test/auth-session'

afterEach(() => {
  cleanup()
  vi.doUnmock('@/pages/workflow-editor')
  vi.doUnmock('./layout')
  vi.resetModules()
})

it('只有进入 Workflow Editor 路由时才加载 React Flow 页面', async () => {
  const pageModuleFactory = vi.fn(() => ({
    WorkflowEditorPage: () => <div>懒加载 Workflow Editor</div>,
  }))
  vi.doMock('@/pages/workflow-editor', pageModuleFactory)
  vi.doMock('./layout', () => ({ AppShellRoute: () => <Outlet /> }))

  const { AppRoutes } = await import('./app')
  expect(pageModuleFactory).not.toHaveBeenCalled()

  render(
    <AuthenticatedAuthSession>
      <MemoryRouter initialEntries={['/workflow-editor/42']}>
        <AppRoutes />
      </MemoryRouter>
    </AuthenticatedAuthSession>,
  )

  expect(await screen.findByText('懒加载 Workflow Editor')).toBeTruthy()
  expect(pageModuleFactory).toHaveBeenCalledTimes(1)
})
