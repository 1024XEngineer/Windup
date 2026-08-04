import type { ReactNode } from 'react'
import { Link, Outlet } from 'react-router'

/** 跨页面常驻导航属于应用外壳，由 app 层统一承载。 */

export interface AppShellProps {
  /** 渲染在全局导航下方的当前路由页面。 */
  children: ReactNode
}

/** 全站外壳，全局导航常驻。 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#fafbf8] text-slate-900">
      <nav className="flex h-14 items-center justify-between border-b border-[#e0e3dd] bg-white px-6">
        {/* 首屏不带这条顶栏，站名是其余页面唯一的回程入口，必须是链接。 */}
        <Link
          to="/"
          className="flex items-center gap-2 font-semibold tracking-[-0.02em] hover:text-slate-600"
        >
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-lg bg-[#263f2d] text-xs font-bold text-white"
          >
            W
          </span>
          Windup
        </Link>
        <div className="flex items-center gap-1 text-sm text-[#5f685f]">
          <Link
            to="/quick-start"
            className="rounded-lg px-3 py-2 hover:bg-[#f3f5f1] hover:text-slate-900"
          >
            快速开始
          </Link>
          <Link
            to="/projects"
            className="rounded-lg px-3 py-2 hover:bg-[#f3f5f1] hover:text-slate-900"
          >
            项目
          </Link>
        </div>
      </nav>
      {/* 外壳只管顶栏。页面自己决定宽度与留白，不在这里统一夹到屏幕中间。 */}
      <main className="w-full">{children}</main>
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
