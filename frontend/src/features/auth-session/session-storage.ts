export const REFRESH_TOKEN_STORAGE_KEY = 'windup.auth.refresh-token'

type RefreshTokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

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
