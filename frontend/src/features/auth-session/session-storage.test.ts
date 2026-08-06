// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import {
  REFRESH_TOKEN_STORAGE_KEY,
  clearRefreshToken,
  loadRefreshToken,
  saveRefreshToken,
} from './session-storage'

afterEach(() => {
  window.localStorage.clear()
})

describe('auth session storage', () => {
  it('persists only the refresh token under the authentication key', () => {
    saveRefreshToken('refresh-token')

    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-token')
    expect(loadRefreshToken()).toBe('refresh-token')
  })

  it('removes the persisted refresh token', () => {
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-token')

    clearRefreshToken()

    expect(loadRefreshToken()).toBeNull()
  })

  it('treats unavailable or failing local storage as an empty best-effort store', () => {
    const failingStorage = {
      getItem(): string | null {
        throw new DOMException('blocked')
      },
      setItem(): void {
        throw new DOMException('blocked')
      },
      removeItem(): void {
        throw new DOMException('blocked')
      },
    }

    expect(loadRefreshToken(failingStorage)).toBeNull()
    expect(() => saveRefreshToken('refresh-token', failingStorage)).not.toThrow()
    expect(() => clearRefreshToken(failingStorage)).not.toThrow()
  })
})
