import { Link, Navigate, Outlet, useLocation } from 'react-router'

import { useAuthSession } from '@/features/auth-session'

/**
 * 受保护路由只消费会话三态，不读取 token，也不触发业务请求。
 * 启动恢复完成前不挂载页面；访客统一去已有账号面板，原地址交给登录成功后的安全回跳处理。
 */
export function ProtectedRoute() {
  const session = useAuthSession()
  const { pathname, search, hash } = useLocation()

  if (session.state.status === 'booting') return null
  if (session.state.status === 'authenticated') return <Outlet />

  const accountSearch = new URLSearchParams({
    account: 'login',
    returnTo: `${pathname}${search}${hash}`,
  })
  return <Navigate replace to={`/?${accountSearch}`} />
}

/** 会话最终恢复失败时给出一次明确的人类可见说明；登录成功后随会话状态自动消失。 */
export function SessionExpiredNotice() {
  const session = useAuthSession()
  const { pathname, search, hash } = useLocation()

  if (session.state.status !== 'guest' || session.state.reason !== 'session-expired') return null

  const currentSearch = new URLSearchParams(search)
  const accountPanelOpen = currentSearch.get('account') === 'login'
  const accountSearch = new URLSearchParams({
    account: 'login',
    returnTo: `${pathname}${search}${hash}`,
  })

  return (
    <aside
      role="alert"
      className="fixed right-4 bottom-4 z-[80] flex max-w-[min(24rem,calc(100vw-2rem))] items-center gap-3 rounded-xl border border-[#8a5a4d]/25 bg-[#fff8f4] px-4 py-3 text-sm text-[#6f352b] shadow-[0_14px_36px_rgba(46,30,24,0.18)]"
    >
      <span className="leading-5">登录状态已过期，请重新登录。</span>
      {!accountPanelOpen && (
        <Link
          to={`/?${accountSearch}`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 font-semibold text-[#284331] underline decoration-[#78927e] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331]"
        >
          重新登录
        </Link>
      )}
    </aside>
  )
}
