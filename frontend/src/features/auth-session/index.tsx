/* oxlint-disable react/only-export-components -- Provider 与 hook 构成同一个公开会话边界。 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { AuthTokens, User, UserApis } from '@/entities'
import { registerApiAccessTokenProvider, registerApiUnauthorizedRecovery } from '@/shared/api'
import {
  REFRESH_TOKEN_STORAGE_KEY,
  clearAuthSessionScopedStorage,
  clearRefreshToken,
  loadRefreshToken,
  saveRefreshToken,
} from './session-storage'

export { AUTH_SESSION_STORAGE_PREFIX } from './session-storage'

export type AuthGuestReason = null | 'logged-out' | 'session-expired' | 'password-changed'

export type AuthSessionState =
  | { status: 'booting'; user: null }
  | { status: 'guest'; user: null; reason: AuthGuestReason }
  | { status: 'authenticated'; user: User }

export interface AuthSessionValue {
  state: AuthSessionState
  sendCode(input: Parameters<UserApis['sendCode']>[0]): Promise<void>
  register(input: Parameters<UserApis['register']>[0]): Promise<AuthTokens>
  login(input: Parameters<UserApis['login']>[0]): Promise<AuthTokens>
  loginByCode(input: Parameters<UserApis['loginByCode']>[0]): Promise<AuthTokens>
  refreshCurrentUser(): Promise<User>
  updateNickname(nickname: string): Promise<User>
  changePassword(input: Parameters<UserApis['changePassword']>[0]): Promise<void>
  logout(): Promise<void>
}

export interface AuthSessionProviderProps {
  apis: UserApis
  children: ReactNode
}

const AuthSessionContext = createContext<AuthSessionValue | null>(null)

export function AuthSessionProvider({ apis, children }: AuthSessionProviderProps) {
  const initialState: AuthSessionState = { status: 'booting', user: null }
  const [state, setState] = useState<AuthSessionState>(initialState)
  const [accessTokenVersion, setAccessTokenVersion] = useState(0)
  const stateRef = useRef<AuthSessionState>(initialState)
  const accessTokenRef = useRef<string | null>(null)
  const refreshTokenRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const refreshInFlightRef = useRef(new Map<string, Promise<AuthTokens>>())
  const recoveryInFlightRef = useRef<Promise<boolean> | null>(null)
  const bootstrapPromiseRef = useRef<Promise<AuthTokens | null> | null>(null)

  const updateState = useCallback((next: AuthSessionState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const storeTokens = useCallback((tokens: AuthTokens) => {
    accessTokenRef.current = tokens.accessToken
    refreshTokenRef.current = tokens.refreshToken
    saveRefreshToken(tokens.refreshToken)
    setAccessTokenVersion((version) => version + 1)
  }, [])

  const commitRefresh = useCallback(
    (tokens: AuthTokens, expectedGeneration: number): boolean => {
      if (!mountedRef.current || generationRef.current !== expectedGeneration) return false
      storeTokens(tokens)
      updateState({ status: 'authenticated', user: tokens.user })
      return true
    },
    [storeTokens, updateState],
  )

  const startSession = useCallback(
    (tokens: AuthTokens) => {
      generationRef.current += 1
      recoveryInFlightRef.current = null
      storeTokens(tokens)
      updateState({ status: 'authenticated', user: tokens.user })
    },
    [storeTokens, updateState],
  )

  const clearSession = useCallback(
    (reason: AuthGuestReason, persist = true) => {
      generationRef.current += 1
      recoveryInFlightRef.current = null
      accessTokenRef.current = null
      refreshTokenRef.current = null
      if (persist) clearRefreshToken()
      clearAuthSessionScopedStorage()
      setAccessTokenVersion((version) => version + 1)
      updateState({ status: 'guest', user: null, reason })
    },
    [updateState],
  )

  const rotateTokens = useCallback(
    (refreshToken: string): Promise<AuthTokens> => {
      const inFlight = refreshInFlightRef.current.get(refreshToken)
      if (inFlight) return inFlight

      const promise = apis.refresh(refreshToken)
      refreshInFlightRef.current.set(refreshToken, promise)
      const release = () => {
        if (refreshInFlightRef.current.get(refreshToken) === promise)
          refreshInFlightRef.current.delete(refreshToken)
      }
      void promise.then(release, release)
      return promise
    },
    [apis],
  )

  /** 若旧 token 输掉跨标签轮换竞态，优先跟随胜出的 token，不能清掉新会话。 */
  const rotateLatestTokens = useCallback(
    async (attemptedToken: string, expectedGeneration: number): Promise<AuthTokens | null> => {
      /** 记下本次已经换过的 token，避免把刚失败的那个当成没试过的又试一遍。 */
      const attempted = new Set([attemptedToken])
      const isCurrent = () => mountedRef.current && generationRef.current === expectedGeneration
      const takeUntriedToken = (): string | null => {
        const memoryToken = refreshTokenRef.current
        if (memoryToken && !attempted.has(memoryToken)) return memoryToken
        const storedToken = loadRefreshToken()
        if (storedToken && !attempted.has(storedToken)) return storedToken
        return null
      }

      try {
        const tokens = await rotateTokens(attemptedToken)
        if (!isCurrent()) return null
        const newerToken = takeUntriedToken()
        if (!newerToken) return tokens
        attempted.add(newerToken)
        try {
          const newerTokens = await rotateTokens(newerToken)
          return isCurrent() ? newerTokens : null
        } catch {
          // 更新的 token 用不了，不代表本次换到手的这套也用不了，退回它而不是一起丢掉。
          return isCurrent() ? tokens : null
        }
      } catch (error) {
        if (!isCurrent()) return null
        const newerToken = takeUntriedToken()
        if (!newerToken) throw error
        attempted.add(newerToken)
        refreshTokenRef.current = newerToken
        const newerTokens = await rotateTokens(newerToken)
        return isCurrent() ? newerTokens : null
      }
    },
    [rotateTokens],
  )

  const recoverUnauthorized = useCallback((): Promise<boolean> => {
    if (recoveryInFlightRef.current) return recoveryInFlightRef.current
    const refreshToken = refreshTokenRef.current
    if (!refreshToken) return Promise.resolve(false)
    const generation = generationRef.current

    const promise = rotateLatestTokens(refreshToken, generation).then(
      (tokens) => (tokens ? commitRefresh(tokens, generation) : false),
      () => {
        if (mountedRef.current && generationRef.current === generation)
          clearSession('session-expired')
        return false
      },
    )
    recoveryInFlightRef.current = promise
    const release = () => {
      if (recoveryInFlightRef.current === promise) recoveryInFlightRef.current = null
    }
    void promise.then(release, release)
    return promise
  }, [clearSession, commitRefresh, rotateLatestTokens])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => registerApiAccessTokenProvider(() => accessTokenRef.current), [])
  useEffect(() => registerApiUnauthorizedRecovery(recoverUnauthorized), [recoverUnauthorized])

  useEffect(() => {
    let active = true
    const generation = generationRef.current

    if (!bootstrapPromiseRef.current) {
      const refreshToken = loadRefreshToken()
      refreshTokenRef.current = refreshToken
      bootstrapPromiseRef.current = refreshToken
        ? rotateLatestTokens(refreshToken, generation)
        : Promise.resolve(null)
    }

    void bootstrapPromiseRef.current.then(
      (tokens) => {
        if (!active || generationRef.current !== generation) return
        if (tokens) commitRefresh(tokens, generation)
        else clearSession(null)
      },
      () => {
        if (active && generationRef.current === generation) clearSession('session-expired')
      },
    )

    return () => {
      active = false
    }
  }, [clearSession, commitRefresh, rotateLatestTokens])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== REFRESH_TOKEN_STORAGE_KEY) return
      if (event.newValue === null) {
        clearSession(null, false)
        return
      }
      if (event.newValue === refreshTokenRef.current) return

      refreshTokenRef.current = event.newValue
      if (stateRef.current.status === 'authenticated') return

      const generation = ++generationRef.current
      recoveryInFlightRef.current = null
      accessTokenRef.current = null
      updateState({ status: 'booting', user: null })
      void rotateLatestTokens(event.newValue, generation).then(
        (tokens) => {
          if (tokens) commitRefresh(tokens, generation)
        },
        () => {
          if (mountedRef.current && generationRef.current === generation)
            clearSession('session-expired')
        },
      )
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clearSession, commitRefresh, rotateLatestTokens, updateState])

  useEffect(() => {
    const refreshAt = getRefreshTime(accessTokenRef.current)
    if (refreshAt === null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      const delay = Math.max(0, refreshAt - Date.now())
      timer = setTimeout(
        () => {
          if (cancelled) return
          if (Date.now() < refreshAt) {
            schedule()
            return
          }
          const refreshToken = refreshTokenRef.current
          if (!refreshToken) return
          const generation = generationRef.current
          void rotateLatestTokens(refreshToken, generation).then(
            (tokens) => {
              if (!cancelled && tokens) commitRefresh(tokens, generation)
            },
            () => {
              if (!cancelled && generationRef.current === generation)
                clearSession('session-expired')
            },
          )
        },
        Math.min(delay, 2_147_483_647),
      )
    }

    schedule()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [accessTokenVersion, clearSession, commitRefresh, rotateLatestTokens])

  const sendCode = useCallback(
    (input: Parameters<UserApis['sendCode']>[0]) => apis.sendCode(input),
    [apis],
  )
  const register = useCallback(
    async (input: Parameters<UserApis['register']>[0]) => {
      const tokens = await apis.register(input)
      startSession(tokens)
      return tokens
    },
    [apis, startSession],
  )
  const login = useCallback(
    async (input: Parameters<UserApis['login']>[0]) => {
      const tokens = await apis.login(input)
      startSession(tokens)
      return tokens
    },
    [apis, startSession],
  )
  const loginByCode = useCallback(
    async (input: Parameters<UserApis['loginByCode']>[0]) => {
      const tokens = await apis.loginByCode(input)
      startSession(tokens)
      return tokens
    },
    [apis, startSession],
  )
  const commitCurrentUser = useCallback(
    (user: User, expectedGeneration: number): User => {
      if (
        !mountedRef.current ||
        generationRef.current !== expectedGeneration ||
        stateRef.current.status !== 'authenticated'
      ) {
        throw new Error('登录状态已变更')
      }
      updateState({ status: 'authenticated', user })
      return user
    },
    [updateState],
  )
  const refreshCurrentUser = useCallback(async () => {
    if (stateRef.current.status !== 'authenticated') throw new Error('请先登录')
    const generation = generationRef.current
    const user = await apis.me()
    return commitCurrentUser(user, generation)
  }, [apis, commitCurrentUser])
  const updateNickname = useCallback(
    async (nickname: string) => {
      if (stateRef.current.status !== 'authenticated') throw new Error('请先登录')
      const generation = generationRef.current
      const user = await apis.updateNickname(nickname)
      return commitCurrentUser(user, generation)
    },
    [apis, commitCurrentUser],
  )
  const changePassword = useCallback(
    async (input: Parameters<UserApis['changePassword']>[0]) => {
      await apis.changePassword(input)
      clearSession('password-changed')
    },
    [apis, clearSession],
  )
  const logout = useCallback(async () => {
    const refreshToken = refreshTokenRef.current
    clearSession('logged-out')
    if (refreshToken) await apis.logout(refreshToken)
  }, [apis, clearSession])

  const value = useMemo<AuthSessionValue>(
    () => ({
      state,
      sendCode,
      register,
      login,
      loginByCode,
      refreshCurrentUser,
      updateNickname,
      changePassword,
      logout,
    }),
    [
      changePassword,
      login,
      loginByCode,
      logout,
      refreshCurrentUser,
      register,
      sendCode,
      state,
      updateNickname,
    ],
  )

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>
}

export function useAuthSession(): AuthSessionValue {
  const session = useContext(AuthSessionContext)
  if (!session) throw new Error('useAuthSession 必须在 AuthSessionProvider 内使用')
  return session
}

function getRefreshTime(accessToken: string | null): number | null {
  const payload = accessToken?.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const value: unknown = JSON.parse(globalThis.atob(padded))
    if (
      typeof value !== 'object' ||
      value === null ||
      !('exp' in value) ||
      typeof value.exp !== 'number' ||
      !Number.isFinite(value.exp)
    ) {
      return null
    }
    return value.exp * 1_000 - 60_000
  } catch {
    return null
  }
}
