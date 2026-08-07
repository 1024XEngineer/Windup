import type { ReactNode } from 'react'
import { Outlet } from 'react-router'

import { AccountPanel } from '@/features/account-panel'
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
      {/*
        外壳只管顶栏。页面自己决定宽度与留白，不在这里统一夹到屏幕中间，
        也不按 pathname 分支给不同页面配不同容器。
        顶栏悬浮不占布局高度，内容页的避让由 PageContainer 统一让出，满幅页面自己让。
      */}
      <main className="w-full">{children}</main>
      <AccountPanel />
    </div>
  )
}

/**
 * 外壳的路由形态，套在一组子路由外面。
 * 哪些页面带外壳是路由决策，写在 app 的路由表里；外壳自身不读 pathname、不判断自己该不该出现。
 */
export function AppShellRoute() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
