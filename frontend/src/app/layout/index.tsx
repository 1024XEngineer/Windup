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
  const { pathname, search } = useLocation()
  const isPlaytestWorkspace = pathname.startsWith('/playtest')
  const isWorkflowWorkspace = pathname.startsWith('/workflow-editor')
  const isProjectWorkspace =
    /^\/projects\/[^/]+(?:\/|$)/u.test(pathname) && pathname !== '/projects/new'
  const isHomePage = pathname === '/'
  const isHomeAccountOpen = isHomePage && new URLSearchParams(search).has('account')
  const pageClassName =
    isPlaytestWorkspace || isWorkflowWorkspace || isProjectWorkspace
      ? 'w-full px-0 pb-0 pt-0'
      : isHomePage
        ? 'w-full'
        : 'mx-auto max-w-5xl px-6 pb-8 pt-24'

  return (
    <div
      aria-hidden={isHomeAccountOpen || undefined}
      inert={isHomeAccountOpen || undefined}
      className="min-h-screen bg-white text-slate-900"
    >
      {/* Playtest 保留产品导航；workflow-editor 和项目详情使用各自的工作台导航。 */}
      {!isWorkflowWorkspace && !isProjectWorkspace && <AppHeader />}
      {isPlaytestWorkspace ? (
        <div className={pageClassName}>{children}</div>
      ) : (
        <main className={pageClassName}>{children}</main>
      )}
    </div>
  )
}
