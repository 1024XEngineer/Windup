import { ArrowLeft } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

const backTransitionDurationMs = 230

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
  const [transitioning, setTransitioning] = useState(false)
  const transitioningRef = useRef(false)
  const fallbackTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current)
    },
    [],
  )

  function navigateBack() {
    if (hasInternalHistory()) {
      navigate(-1)
      return
    }
    navigate(fallbackPath(pathname), { replace: true })
  }

  function finishTransition() {
    if (!transitioningRef.current) return
    transitioningRef.current = false
    if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current)
    fallbackTimerRef.current = null
    setTransitioning(false)
    navigateBack()
  }

  function requestBack() {
    if (transitioningRef.current) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      navigateBack()
      return
    }

    transitioningRef.current = true
    setTransitioning(true)
    fallbackTimerRef.current = window.setTimeout(finishTransition, backTransitionDurationMs)
  }

  return (
    <button
      type="button"
      aria-label="返回上一页"
      title="返回上一页"
      onClick={requestBack}
      className={`inline-grid h-9 w-9 shrink-0 place-items-center rounded-md bg-transparent text-app-muted transition-[background-color,color] duration-150 hover:bg-app-surface-raised/55 hover:text-app-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
        transitioning ? 'app-header-back-in-flight' : ''
      }`}
    >
      <span aria-hidden="true" className="relative block h-[18px] w-[18px] overflow-hidden">
        <span className="app-header-back-strip absolute inset-y-0 left-0 flex items-center gap-2">
          <ArrowLeft className="shrink-0" size={18} weight="regular" />
          <ArrowLeft className="shrink-0" size={18} weight="regular" />
        </span>
      </span>
    </button>
  )
}
