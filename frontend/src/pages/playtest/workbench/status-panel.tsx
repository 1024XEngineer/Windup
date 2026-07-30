import type { ReactNode } from 'react'

export interface StatusPanelProps {
  title: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  children: ReactNode
}

const toneClassNames = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-rose-200 bg-rose-50 text-rose-900',
} as const

/**
 * Playtest 内部状态提示，不作为 shared 公共组件向其他模块扩散。
 */
export function StatusPanel({ title, tone = 'neutral', children }: StatusPanelProps) {
  return (
    <section className={`rounded-xl border p-3 text-sm ${toneClassNames[tone]}`}>
      <strong className="block text-xs">{title}</strong>
      <div className="mt-1">{children}</div>
    </section>
  )
}
