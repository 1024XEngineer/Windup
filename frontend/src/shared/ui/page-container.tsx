import type { ReactNode } from 'react'

export interface PageContainerProps {
  children: ReactNode
}

/**
 * 内容页的居中容器，页面按需套用；外壳不再统一施加宽度与留白。
 *
 * 最大宽度 1280px（`max-w-7xl`）取自应用型界面 1200–1440px 的常见区间，
 * 与以正文阅读为主的 640–720px 不是一档——首屏、Playtest 这类满幅页面不套本组件。
 * 只提供一种尺寸：出现第二种真实需求时再加参数，不预留档位。
 */
export function PageContainer({ children }: PageContainerProps) {
  return <div className="mx-auto w-full max-w-7xl px-6 py-8">{children}</div>
}
