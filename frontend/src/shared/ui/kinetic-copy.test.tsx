// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { KineticCopy } from './kinetic-copy'

const kineticCopyStyles = readFileSync(resolve('src/shared/ui/kinetic-copy.css'), 'utf8')

afterEach(() => {
  cleanup()
  document.head.querySelector('[data-kinetic-copy-styles]')?.remove()
})

describe('KineticCopy', () => {
  it.each(['entering', 'resting', 'exiting'] as const)(
    'renders both copy lines in the %s phase',
    (phase) => {
      const { container } = render(
        <KineticCopy
          lines={['继续搭建，', '属于你的角色世界。']}
          copyKey="login-0"
          phase={phase}
        />,
      )

      const cycle = container.querySelector<HTMLElement>('[data-copy-phase]')
      const lineInners = container.querySelectorAll<HTMLElement>('.auth-copy-line-inner')

      expect(cycle?.dataset.copyPhase).toBe(phase)
      expect(cycle?.className).toContain(`auth-copy-cycle-${phase}`)
      expect(cycle?.getAttribute('aria-hidden')).toBe('true')
      expect(screen.getByText('继续搭建，')).toBeTruthy()
      expect(screen.getByText('属于你的角色世界。')).toBeTruthy()
      expect(lineInners).toHaveLength(2)
      expect(lineInners[0]?.style.getPropertyValue('--auth-line-index')).toBe('0')
      expect(lineInners[1]?.style.getPropertyValue('--auth-line-index')).toBe('1')
    },
  )

  it('provides entering motion timing outside the account panel', () => {
    const style = document.createElement('style')
    style.dataset.kineticCopyStyles = 'true'
    style.textContent = kineticCopyStyles
    document.head.append(style)

    render(
      <KineticCopy
        lines={['继续搭建，', '属于你的角色世界。']}
        copyKey="shared-0"
        phase="entering"
      />,
    )

    const lineRule = Array.from(style.sheet?.cssRules ?? []).find(
      (rule) => 'selectorText' in rule && rule.selectorText === '.auth-copy-line-inner',
    ) as CSSStyleRule | undefined

    expect(lineRule?.style.animation).toMatch(
      /var\(--auth-ease-enter,\s*cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)\)/,
    )
  })
})
