export const REFRESH_TOKEN_STORAGE_KEY = 'windup.auth.refresh-token'

type RefreshTokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function getLocalStorage(): RefreshTokenStorage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function loadRefreshToken(
  storage: RefreshTokenStorage | null = getLocalStorage(),
): string | null {
  try {
    return storage?.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function saveRefreshToken(
  refreshToken: string,
  storage: RefreshTokenStorage | null = getLocalStorage(),
): void {
  try {
    storage?.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken)
  } catch {
    // 持久化不可用时仍保留当前内存会话。
  }
}

export function clearRefreshToken(storage: RefreshTokenStorage | null = getLocalStorage()): void {
  try {
    storage?.removeItem(REFRESH_TOKEN_STORAGE_KEY)
  } catch {
    // 清理是尽力而为；浏览器禁用存储时不能让应用崩溃。
  }
}
