export type ProductControlVariant = 'accent' | 'chrome' | 'primary' | 'secondary'

const productControlBaseClass =
  'inline-flex min-h-10 items-center gap-2 rounded-app-control px-4 text-xs font-semibold transition-[color,background-color,border-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent'

const productControlVariantClass: Record<ProductControlVariant, string> = {
  accent: 'bg-app-accent-muted text-app-accent hover:bg-app-accent-soft',
  chrome: 'bg-transparent text-app-ink-soft hover:bg-app-accent-muted hover:text-app-accent',
  primary: 'border border-app-accent bg-app-accent-muted text-app-accent hover:bg-app-accent-soft',
  secondary:
    'border border-app-line-strong bg-app-surface-raised text-app-ink-soft hover:border-app-accent hover:bg-app-accent-muted hover:text-app-accent',
}

export function productControlClass(variant: ProductControlVariant, className = ''): string {
  return `${productControlBaseClass} ${productControlVariantClass[variant]} ${className}`.trim()
}

/** 与 Quick Start 方向面板共用的产品浮层表面。 */
export const productPopoverClass =
  'rounded-app-surface border border-app-line-strong bg-app-surface-raised shadow-app-panel'

export const productMenuItemClass =
  'flex min-h-10 items-center rounded-app-compact px-3 text-[13px] transition-colors hover:bg-app-accent-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-app-accent'
