import type { ReactNode } from 'react'
import { Outlet } from 'react-router'

import { AccountPanel } from '@/features/account-panel'
import { SessionExpiredNotice } from '@/features/auth-guard'
import { AppHeader } from './app-header'

export interface AppShellProps {
  /** 渲染在全局导航下方的当前路由页面。 */
  children: ReactNode
}

/** 登录产品外壳；只服务工作台与受保护业务页。 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-app-canvas text-app-ink">
      <AppHeader />
      {/*
        外壳只管顶栏。页面自己决定宽度与留白，不在这里统一夹到屏幕中间，
        也不按 pathname 分支给不同页面配不同容器。
        顶栏悬浮不占布局高度，内容页的避让由 PageContainer 统一让出，满幅页面自己让。
      */}
      <main className="w-full">{children}</main>
      <AccountPanel />
      <SessionExpiredNotice />
    </div>
  )
}

/** 公开页面外壳只提供认证面板与会话提醒，宣传导航由 LandingPage 自己组合。 */
export function MarketingShell({ children }: AppShellProps) {
  return (
    <div className="min-h-[100dvh] bg-[#f6f8f3] text-[#1d2920]">
      {children}
      <AccountPanel />
      <SessionExpiredNotice />
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

export function MarketingShellRoute() {
  return (
    <MarketingShell>
      <Outlet />
    </MarketingShell>
  )
}
