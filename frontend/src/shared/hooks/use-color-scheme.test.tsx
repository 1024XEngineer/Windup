// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useColorScheme } from './use-color-scheme'

afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty('color-scheme')
  vi.unstubAllGlobals()
})

function systemAppearance(initialDark: boolean) {
  let dark = initialDark
  const changes = new EventTarget()
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return dark
    },
    addEventListener: changes.addEventListener.bind(changes),
    removeEventListener: changes.removeEventListener.bind(changes),
  }))
  return (value: boolean) => {
    dark = value
    changes.dispatchEvent(new Event('change'))
  }
}

describe('useColorScheme', () => {
  it('uses dark appearance on the first render and follows both system changes in place', () => {
    const change = systemAppearance(true)
    const { result } = renderHook(useColorScheme)
    expect(result.current).toBe('dark')
    act(() => change(false))
    expect(result.current).toBe('light')
    act(() => change(true))
    expect(result.current).toBe('dark')
  })

  it('aligns canvas colors with explicit CSS appearance and resumes following the system', async () => {
    const change = systemAppearance(false)
    const { result } = renderHook(useColorScheme)
    document.documentElement.style.colorScheme = 'dark'
    await waitFor(() => expect(result.current).toBe('dark'))
    document.documentElement.style.colorScheme = 'light'
    act(() => change(true))
    await waitFor(() => expect(result.current).toBe('light'))
    document.documentElement.style.removeProperty('color-scheme')
    await waitFor(() => expect(result.current).toBe('dark'))
  })

  it('falls back to light when media preferences are unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(renderHook(useColorScheme).result.current).toBe('light')
  })
})
