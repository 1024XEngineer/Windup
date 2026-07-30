import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'

/** 跨页面常驻导航属于应用外壳，由 app 层统一承载。 */

export interface AppShellProps {
  /** 渲染在全局导航下方的当前路由页面。 */
  children: ReactNode
}

/** 全站外壳，全局导航常驻。 */
export function AppShell({ children }: AppShellProps) {
  const { pathname } = useLocation()
  const isPlaytestWorkspace = pathname.startsWith('/playtest/')

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <nav className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
        <span className="font-semibold tracking-tight">Windup</span>
        <div className="flex gap-4 text-sm text-slate-600">
          <Link to="/quick-start" className="hover:text-slate-900">
            快速开始
          </Link>
          <Link to="/projects" className="hover:text-slate-900">
            项目
          </Link>
        </div>
      </nav>
      <main
        className={
          isPlaytestWorkspace ? 'w-full px-2 py-2 sm:px-4 sm:py-4' : 'mx-auto max-w-5xl px-6 py-8'
        }
      >
        {children}
      </main>
    </div>
  )
}
