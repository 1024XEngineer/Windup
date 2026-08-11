import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * 读取系统的"减少动态效果"偏好，并跟随它变化。
 *
 * `window.matchMedia` 并非所有渲染环境都提供；这里统一做存在性判断，避免每个
 * 动效组件各自维护一套环境兜底。
 *
 * 首帧一律返回 false：真实浏览器里 effect 会在同一次提交后立刻纠正，而 SSR 与
 * 测试环境读不到偏好，按"不减弱"渲染比闪一下更稳。
 */
export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const query = window.matchMedia(QUERY)
    setPrefersReducedMotion(query.matches)

    function handleChange(event: MediaQueryListEvent) {
      setPrefersReducedMotion(event.matches)
    }

    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return prefersReducedMotion
}
