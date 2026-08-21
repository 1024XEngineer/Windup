export type RouteMotionDirection = 'forward' | 'backward' | 'lateral'

function describeRoute(pathname: string): { depth: number; order: number; section: string } {
  if (pathname === '/') return { section: 'marketing', order: -1, depth: 0 }
  if (pathname === '/workspace') return { section: 'workspace', order: 0, depth: 0 }
  if (pathname === '/account') return { section: 'account', order: 4, depth: 0 }

  if (pathname.startsWith('/projects')) {
    const depth = /^\/projects\/[^/]+\/assets\/[^/]+$/.test(pathname)
      ? 2
      : pathname === '/projects'
        ? 0
        : 1
    return { section: 'projects', order: 1, depth }
  }

  if (pathname.startsWith('/playtest')) {
    return { section: 'playtest', order: 2, depth: pathname === '/playtest' ? 0 : 1 }
  }

  if (pathname.startsWith('/workflow-editor')) {
    return { section: 'create', order: 3, depth: 2 }
  }

  if (pathname.startsWith('/quick-start')) {
    return { section: 'create', order: 3, depth: pathname === '/quick-start' ? 0 : 1 }
  }

  return { section: pathname, order: 5, depth: 0 }
}

export function getRouteMotionDirection(
  currentPath: string,
  nextPath: string,
): RouteMotionDirection {
  const current = describeRoute(currentPath)
  const next = describeRoute(nextPath)

  if (current.section === next.section && current.depth !== next.depth) {
    return next.depth > current.depth ? 'forward' : 'backward'
  }
  if (current.section === next.section || current.order === next.order) return 'lateral'
  return next.order > current.order ? 'forward' : 'backward'
}
