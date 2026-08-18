import { describe, expect, it, vi } from 'vitest'

import {
  AUTH_SESSION_STORAGE_PREFIX,
  REFRESH_TOKEN_STORAGE_KEY,
  clearAuthSessionScopedStorage,
  createRefreshTokenStorage,
} from './session-storage'

describe('refresh token storage', () => {
  it('clears only values owned by the current auth session namespace', () => {
    const values = new Map([
      [`${AUTH_SESSION_STORAGE_PREFIX}invite-hint-seen.v1`, '1'],
      ['unrelated.preference', 'keep'],
    ])
    const storage = {
      get length() {
        return values.size
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: vi.fn((key: string) => values.delete(key)),
    }

    clearAuthSessionScopedStorage(storage)

    expect(storage.removeItem).toHaveBeenCalledWith(
      `${AUTH_SESSION_STORAGE_PREFIX}invite-hint-seen.v1`,
    )
    expect(values.get('unrelated.preference')).toBe('keep')
  })

  it('does not let unavailable session storage block session teardown', () => {
    expect(() => clearAuthSessionScopedStorage(null)).not.toThrow()
    expect(() =>
      clearAuthSessionScopedStorage({
        length: 1,
        key: () => {
          throw new DOMException('Storage is disabled', 'SecurityError')
        },
        removeItem: vi.fn(),
      }),
    ).not.toThrow()
  })

  it('persists only the refresh token under the contracted key', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    }
    const tokens = createRefreshTokenStorage(storage)

    tokens.save('refresh-token')

    expect(storage.setItem).toHaveBeenCalledWith('windup.auth.refresh-token', 'refresh-token')
    expect(tokens.load()).toBe('refresh-token')
    expect(REFRESH_TOKEN_STORAGE_KEY).toBe('windup.auth.refresh-token')

    tokens.clear()
    expect(storage.removeItem).toHaveBeenCalledWith('windup.auth.refresh-token')
    expect(tokens.load()).toBeNull()
  })

  it('retains the current-tab refresh token in memory when storage throws', () => {
    const failure = new DOMException('Storage is disabled', 'SecurityError')
    const storage = {
      getItem: vi.fn(() => {
        throw failure
      }),
      setItem: vi.fn(() => {
        throw failure
      }),
      removeItem: vi.fn(() => {
        throw failure
      }),
    }
    const tokens = createRefreshTokenStorage(storage)

    expect(() => tokens.save('memory-refresh-token')).not.toThrow()
    expect(tokens.load()).toBe('memory-refresh-token')
    expect(() => tokens.clear()).not.toThrow()
    expect(tokens.load()).toBeNull()
  })

  it('uses the memory value after a previously working storage becomes unavailable', () => {
    let available = true
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => {
        if (!available) throw new DOMException('Storage is disabled', 'SecurityError')
        return values.get(key) ?? null
      },
      setItem: (key: string, value: string) => {
        if (!available) throw new DOMException('Storage is disabled', 'SecurityError')
        values.set(key, value)
      },
      removeItem: (key: string) => {
        if (!available) throw new DOMException('Storage is disabled', 'SecurityError')
        values.delete(key)
      },
    }
    const tokens = createRefreshTokenStorage(storage)

    tokens.save('refresh-token')
    available = false

    expect(tokens.load()).toBe('refresh-token')
  })

  it('does not let a readable stale value replace a token whose persistence failed', () => {
    const storage = {
      getItem: vi.fn(() => 'stale-refresh-token'),
      setItem: vi.fn(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }),
      removeItem: vi.fn(),
    }
    const tokens = createRefreshTokenStorage(storage)

    tokens.save('memory-refresh-token')

    expect(tokens.load()).toBe('memory-refresh-token')
  })

  it('keeps an in-memory tombstone when persistent removal fails', () => {
    const storage = {
      getItem: vi.fn(() => 'stale-refresh-token'),
      setItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new DOMException('Storage is disabled', 'SecurityError')
      }),
    }
    const tokens = createRefreshTokenStorage(storage)

    tokens.clear()

    expect(tokens.load()).toBeNull()
  })
})
