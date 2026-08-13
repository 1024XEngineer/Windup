import { useLocation, useNavigate } from 'react-router'

function fallbackPath(pathname: string): string {
  if (/^\/quick-start\/[^/]+$/.test(pathname)) return '/quick-start'
  if (/^\/playtest\/[^/]+\/[^/]+$/.test(pathname)) return '/playtest'
  if (pathname === '/projects/new') return '/projects'
  if (pathname.startsWith('/workflow-editor/')) return '/workspace'
  if (pathname === '/workspace') return '/'
  return '/workspace'
}

function hasInternalHistory(): boolean {
  const state = window.history.state as { idx?: unknown } | null
  return typeof state?.idx === 'number' && state.idx > 0
}

/**
 * 产品页统一后退入口。
 * React Router 提醒 navigate(-1) 可能没有历史项或退到站外，因此直达页面使用稳定父级兜底。
 */
export function PageBackButton() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  function goBack() {
    if (hasInternalHistory()) {
      navigate(-1)
      return
    }
    navigate(fallbackPath(pathname), { replace: true })
  }

  return (
    <button
      type="button"
      aria-label="返回上一页"
      title="返回上一页"
      onClick={goBack}
      className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-md border border-app-accent/12 bg-app-surface-raised/35 text-app-ink-soft transition-[background-color,color,transform] duration-150 hover:bg-app-surface-raised/75 hover:text-app-accent-hover active:translate-y-px active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent motion-reduce:transform-none"
    >
      <span aria-hidden="true" className="text-[1.2rem] leading-none">
        ←
      </span>
    </button>
  )
}
