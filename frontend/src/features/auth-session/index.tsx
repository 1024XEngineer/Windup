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
  clearRefreshToken,
  loadRefreshToken,
  saveRefreshToken,
} from './session-storage'

export type AuthGuestReason = null | 'session-expired' | 'password-changed'

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
      try {
        const tokens = await rotateTokens(attemptedToken)
        if (!mountedRef.current || generationRef.current !== expectedGeneration) return null
        const newerToken = refreshTokenRef.current
        if (newerToken && newerToken !== attemptedToken) {
          const newerTokens = await rotateTokens(newerToken)
          return mountedRef.current && generationRef.current === expectedGeneration
            ? newerTokens
            : null
        }
        return tokens
      } catch (error) {
        if (!mountedRef.current || generationRef.current !== expectedGeneration) return null
        const memoryToken = refreshTokenRef.current
        const storedToken = loadRefreshToken()
        const newerToken =
          memoryToken && memoryToken !== attemptedToken
            ? memoryToken
            : storedToken && storedToken !== attemptedToken
              ? storedToken
              : null
        if (!newerToken) throw error
        refreshTokenRef.current = newerToken
        const newerTokens = await rotateTokens(newerToken)
        return mountedRef.current && generationRef.current === expectedGeneration
          ? newerTokens
          : null
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
  const changePassword = useCallback(
    async (input: Parameters<UserApis['changePassword']>[0]) => {
      await apis.changePassword(input)
      clearSession('password-changed')
    },
    [apis, clearSession],
  )
  const logout = useCallback(async () => {
    const refreshToken = refreshTokenRef.current
    clearSession(null)
    if (refreshToken) await apis.logout(refreshToken)
  }, [apis, clearSession])

  const value = useMemo<AuthSessionValue>(
    () => ({ state, sendCode, register, login, loginByCode, changePassword, logout }),
    [changePassword, login, loginByCode, logout, register, sendCode, state],
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
