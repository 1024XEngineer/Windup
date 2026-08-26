import { useCallback, useEffect, useState } from 'react'

export type ProductPopoverMotionState = 'closed' | 'open' | 'closing'

const PRODUCT_POPOVER_EXIT_MS = 110

/** 浮层关闭时先保留节点完成退出动画，再从布局与可访问树中移除。 */
export function useProductPopoverMotion() {
  const [state, setState] = useState<ProductPopoverMotionState>('closed')

  useEffect(() => {
    if (state !== 'closing') return
    const timer = window.setTimeout(() => setState('closed'), PRODUCT_POPOVER_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [state])

  const toggle = useCallback(() => {
    setState((current) => (current === 'open' ? 'closing' : 'open'))
  }, [])
  const close = useCallback(() => {
    setState((current) => (current === 'open' ? 'closing' : current))
  }, [])
  const finish = useCallback(() => {
    setState((current) => (current === 'closing' ? 'closed' : current))
  }, [])

  return {
    state,
    expanded: state === 'open',
    mounted: state !== 'closed',
    toggle,
    close,
    finish,
  }
}
