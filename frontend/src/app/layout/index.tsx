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
  const isHomePage = pathname === '/'

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <AppHeader />
      <main
        className={
          isPlaytestWorkspace
            ? 'w-full px-2 pb-2 pt-24 sm:px-4 sm:pb-4 sm:pt-24'
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
