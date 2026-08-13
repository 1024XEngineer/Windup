// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { KineticCopy } from './kinetic-copy'

afterEach(cleanup)

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
})
