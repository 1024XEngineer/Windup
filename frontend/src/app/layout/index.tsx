import type { ReactNode } from 'react'
import { useLocation } from 'react-router'

import { AppHeader } from './app-header'

/** 跨页面常驻导航属于应用外壳，由 app 层统一承载。 */

export interface AppShellProps {
  /** 渲染在全局导航下方的当前路由页面。 */
  children: ReactNode
}

/** 全站外壳，全局导航常驻。 */
export function AppShell({ children }: AppShellProps) {
  const { pathname } = useLocation()
  const isPlaytestWorkspace = pathname.startsWith('/playtest/')
  const isWorkflowWorkspace = pathname.startsWith('/workflow-editor')
  const isHomePage = pathname === '/'

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* workflow-editor 有自己的 studio-bar，不显示全局 header */}
      {!isWorkflowWorkspace && <AppHeader />}
      <main
        className={
          isPlaytestWorkspace || isWorkflowWorkspace
            ? 'w-full px-0 pb-0 pt-0'
            : isHomePage
              ? 'w-full'
              : 'mx-auto max-w-5xl px-6 pb-8 pt-24'
        }
      >
        {children}
      </main>
    </div>
  )
}
