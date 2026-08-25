import { describe, expect, it } from 'vitest'

import { productControlClass, productMenuItemClass, productPopoverClass } from './product-control'

describe('product control styles', () => {
  it('keeps primary and secondary actions on the same control geometry', () => {
    const primary = productControlClass('primary')
    const secondary = productControlClass('secondary')

    for (const className of [primary, secondary]) {
      expect(className).toContain('rounded-app-control')
      expect(className).toContain('border')
      expect(className).not.toContain('rounded-full')
    }
    expect(primary.split(' ')).toContain('bg-app-accent-muted')
    expect(secondary).toContain('bg-app-surface-raised')
  })

  it('keeps chrome controls borderless and reserves the outlined surface for popovers', () => {
    expect(productControlClass('chrome').split(' ')).not.toContain('border')
    expect(productControlClass('chrome')).toContain('bg-transparent')
    expect(productControlClass('accent').split(' ')).not.toContain('border')
    expect(productControlClass('accent')).toContain('bg-app-accent-muted')
    expect(productPopoverClass).toContain('rounded-app-surface')
    expect(productPopoverClass).toContain('border-app-line-strong')
    expect(productMenuItemClass).toContain('rounded-app-compact')
  })
})
