import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-color-scheme: dark)'

function subscribe(notify: () => void) {
  const media = window.matchMedia?.(QUERY)
  media?.addEventListener('change', notify)
  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  })
  return () => {
    media?.removeEventListener('change', notify)
    observer.disconnect()
  }
}

function getSnapshot(): 'light' | 'dark' {
  const scheme = getComputedStyle(document.documentElement).colorScheme
  if (scheme === 'light' || scheme === 'dark') return scheme
  return window.matchMedia?.(QUERY).matches ? 'dark' : 'light'
}

/** CSS 负责界面配色；需要具体颜色值的绘制组件必须跟随同一外观，不能处理图片或视频像素。 */
export function useColorScheme() {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'light' as const)
}
