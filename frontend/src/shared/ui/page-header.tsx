import type { ReactNode } from 'react'

export interface PageHeaderProps {
  /** 页面标题。 */
  title: string
  /** 补充说明，如「项目 3 · 生成动作」。 */
  subtitle?: string
  /** 不传则不显示返回。 */
  onBack?: () => void
  /** 本页特有操作。 */
  actions?: ReactNode
}

/** 页内头部。 */
export function PageHeader({ title, subtitle, onBack, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex items-start justify-between">
      <div>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="mb-1 text-sm text-slate-500 hover:text-slate-900"
          >
            ← 返回
          </button>
        ) : null}
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  )
}
