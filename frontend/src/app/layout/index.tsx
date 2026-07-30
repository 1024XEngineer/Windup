import type { ReactNode } from 'react'

import { AppHeader } from './app-header'

/** 跨页面常驻导航属于应用外壳，由 app 层统一承载。 */

export interface AppShellProps {
  /** 渲染在全局导航下方的当前路由页面。 */
  children: ReactNode
}

/** 全站外壳，全局导航常驻。 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-6 pb-8 pt-24">{children}</main>
    </div>
  )
}
