// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KineticCopyCycle } from './kinetic-copy-cycle'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('KineticCopyCycle', () => {
  it('layers optional mirrored character motion over the shared transition', () => {
    const characterView = render(
      <KineticCopyCycle
        active={false}
        motionMode="characters"
        messages={[
          {
            prefix: '试试',
            lines: ['银色卷发的裁缝'],
          },
        ]}
      />,
    )

    expect(
      characterView.container
        .querySelector('[data-copy-motion-mode]')
        ?.getAttribute('data-copy-motion-mode'),
    ).toBe('characters')
    const characters =
      characterView.container.querySelectorAll<HTMLElement>('.kinetic-copy-character')
    expect(characters).toHaveLength(7)
    expect(characters[0].style.getPropertyValue('--kinetic-copy-character-reverse-index')).toBe('6')
    expect(characters[6].style.getPropertyValue('--kinetic-copy-character-reverse-index')).toBe('0')
    expect(screen.getByText('试试').querySelector('.kinetic-copy-character')).toBeNull()
    expect(characterView.container.textContent).toBe('试试银色卷发的裁缝')

    characterView.unmount()
    const lineView = render(
      <KineticCopyCycle active={false} messages={[{ lines: ['登录页原动画'] }]} />,
    )
    expect(lineView.container.querySelectorAll('.kinetic-copy-character')).toHaveLength(0)
    expect(lineView.container.textContent).toBe('登录页原动画')
  })

  it('vertically centers a compact prefix beside the main subtitle', () => {
    render(
      <KineticCopyCycle
        active={false}
        messages={[
          {
            prefix: '试试',
            prefixClassName: 'text-[10px]',
            lines: ['银色卷发、戴星形单片眼镜的裁缝'],
          },
        ]}
      />,
    )

    expect(screen.getByText('试试').parentElement?.className).toContain(
      'kinetic-copy-line-inner-prefixed',
    )
  })

  it('lets the current subtitle leave before the next complete message enters', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { container } = render(
      <KineticCopyCycle
        as="h1"
        ariaLabel="角色灵感"
        firstCycleMs={2_400}
        loopStartIndex={1}
        messages={[
          { lines: ['想做一个什么角色？'] },
          { prefix: '试试', lines: ['银色卷发、戴星形单片眼镜的裁缝'] },
          { prefix: '试试', lines: ['长着鹿角、披苔藓斗篷的邮差'] },
        ]}
      />,
    )
    const cycle = () => container.querySelector<HTMLElement>('[data-copy-phase]')
    const heading = screen.getByRole('heading', { name: '角色灵感' })

    expect(cycle()?.dataset.copyPhase).toBe('entering')
    expect(heading.textContent).toBe('想做一个什么角色？')

    act(() => vi.advanceTimersByTime(760))
    expect(cycle()?.dataset.copyPhase).toBe('resting')

    act(() => vi.advanceTimersByTime(1_640))
    expect(cycle()?.dataset.copyPhase).toBe('exiting')
    expect(heading.textContent).toBe('想做一个什么角色？')

    act(() => vi.advanceTimersByTime(460))
    expect(cycle()?.dataset.copyPhase).toBe('entering')
    expect(heading.textContent).toBe('试试银色卷发、戴星形单片眼镜的裁缝')

    act(() => vi.advanceTimersByTime(4_200))
    expect(heading.textContent).toBe('试试长着鹿角、披苔藓斗篷的邮差')

    act(() => vi.advanceTimersByTime(4_200))
    expect(heading.textContent).toBe('试试银色卷发、戴星形单片眼镜的裁缝')
    expect(heading.textContent).not.toContain('想做一个什么角色？')
  })

  it('lets the current subtitle exit before a replacement sequence enters', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const ideas = [{ lines: ['想做一个什么角色？'] }, { lines: ['银色卷发的裁缝'] }] as const
    const guidance = [
      { lines: ['想做一个什么角色？'] },
      { lines: ['先写身份，再补最醒目的外形'] },
    ] as const
    const { container, rerender } = render(
      <KineticCopyCycle
        ariaLabel="角色灵感"
        firstCycleMs={2_400}
        loopStartIndex={1}
        messages={ideas}
      />,
    )
    const cycle = () => container.querySelector<HTMLElement>('[data-copy-phase]')

    act(() => vi.advanceTimersByTime(3_000))
    expect(screen.getByLabelText('角色灵感').textContent).toBe('银色卷发的裁缝')

    rerender(
      <KineticCopyCycle
        ariaLabel="角色灵感"
        firstCycleMs={2_400}
        loopStartIndex={1}
        messages={guidance}
      />,
    )
    expect(cycle()?.dataset.copyPhase).toBe('exiting')
    expect(screen.getByLabelText('角色灵感').textContent).toBe('银色卷发的裁缝')

    act(() => vi.advanceTimersByTime(460))
    expect(cycle()?.dataset.copyPhase).toBe('entering')
    expect(screen.getByLabelText('角色灵感').textContent).toBe('想做一个什么角色？')

    act(() => vi.advanceTimersByTime(2_860))
    expect(screen.getByLabelText('角色灵感').textContent).toBe('先写身份，再补最醒目的外形')
  })

  it('returns to a static first message when cycling is paused', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { rerender } = render(
      <KineticCopyCycle
        active
        as="h1"
        ariaLabel="角色灵感"
        firstCycleMs={2_400}
        messages={[{ lines: ['想做一个什么角色？'] }, { lines: ['银色卷发的裁缝'] }]}
      />,
    )

    act(() => vi.advanceTimersByTime(3_000))
    expect(screen.getByRole('heading', { name: '角色灵感' }).textContent).toBe('银色卷发的裁缝')

    rerender(
      <KineticCopyCycle
        active={false}
        as="h1"
        ariaLabel="角色灵感"
        firstCycleMs={2_400}
        messages={[{ lines: ['想做一个什么角色？'] }, { lines: ['银色卷发的裁缝'] }]}
      />,
    )
    expect(screen.getByRole('heading', { name: '角色灵感' }).textContent).toBe('想做一个什么角色？')
  })
})
