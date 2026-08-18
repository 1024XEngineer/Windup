export const REFRESH_TOKEN_STORAGE_KEY = 'windup.auth.refresh-token'
export const AUTH_SESSION_STORAGE_PREFIX = 'windup.auth-session.'

type RefreshTokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type SessionScopedStorage = Pick<Storage, 'key' | 'length' | 'removeItem'>

export interface RefreshTokenStore {
  load(): string | null
  save(refreshToken: string): void
  clear(): void
}

function getLocalStorage(): RefreshTokenStorage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

function getSessionStorage(): SessionScopedStorage | null {
  try {
    return globalThis.sessionStorage
  } catch {
    return null
  }
}

/** 清除只属于一次登录会话的 UI 标记；登出、过期和改密都经过这一边界。 */
export function clearAuthSessionScopedStorage(storage = getSessionStorage()): void {
  if (!storage) return
  try {
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(AUTH_SESSION_STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // sessionStorage 不可用不应阻断登出或会话失效。
  }
}

/**
 * localStorage 是跨刷新、跨标签的增强能力，不是维持当前页面登录的前提。
 * 浏览器拒绝存储访问时，闭包中的副本继续支撑本标签页会话。
 */
export function createRefreshTokenStorage(storage?: RefreshTokenStorage | null): RefreshTokenStore {
  let memoryValue: string | null = null
  let memoryOnly = false
  const resolveStorage = () => (storage === undefined ? getLocalStorage() : storage)

  return {
    load() {
      if (memoryOnly) return memoryValue
      const target = resolveStorage()
      if (!target) return memoryValue
      try {
        memoryValue = target.getItem(REFRESH_TOKEN_STORAGE_KEY)
      } catch {
        memoryOnly = true
      }
      return memoryValue
    },
    save(refreshToken) {
      memoryValue = refreshToken
      try {
        resolveStorage()?.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken)
      } catch {
        memoryOnly = true
      }
    },
    clear() {
      memoryValue = null
      try {
        resolveStorage()?.removeItem(REFRESH_TOKEN_STORAGE_KEY)
      } catch {
        memoryOnly = true
      }
    },
  }
}

const defaultRefreshTokenStorage = createRefreshTokenStorage()

export function loadRefreshToken(): string | null {
  return defaultRefreshTokenStorage.load()
}

export function saveRefreshToken(refreshToken: string): void {
  defaultRefreshTokenStorage.save(refreshToken)
}

export function clearRefreshToken(): void {
  defaultRefreshTokenStorage.clear()
}
