import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router'

import { getRouteMotionDirection } from './route-motion-model'

function motionPathname(pathname: string): string {
  return /^\/projects\/[^/]+$/.test(pathname) ? `${pathname}/assets` : pathname
}

/** 页面只在真实 pathname 变化后进入；search、hash 与索引补全不重复播放。 */
export function RouteMotionSurface({
  as: Component = 'div',
  children,
  className = '',
}: {
  as?: 'div' | 'main'
  children: ReactNode
  className?: string
}) {
  const { pathname } = useLocation()
  const routeKey = motionPathname(pathname)
  const previousPathname = useRef(routeKey)
  const changed = previousPathname.current !== routeKey
  const direction = changed
    ? getRouteMotionDirection(previousPathname.current, routeKey)
    : 'lateral'

  useEffect(() => {
    previousPathname.current = routeKey
  }, [routeKey])

  return (
    <Component
      key={routeKey}
      data-testid="route-motion-surface"
      data-motion-active={changed ? 'true' : 'false'}
      data-motion-direction={direction}
      className={`route-motion-surface ${className}`}
    >
      {children}
    </Component>
  )
}
