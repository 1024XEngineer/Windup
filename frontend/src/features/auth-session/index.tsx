/* oxlint-disable react/only-export-components -- 该模块的公共契约同时导出 Provider、路由守卫和 hook。 */
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
import { Navigate, useLocation } from 'react-router'

import type { AuthTokens, User, UserApis } from '@/entities/user'
import { registerApiAccessTokenProvider, registerApiUnauthorizedRecovery } from '@/shared/api'
import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from './session-storage'

export type AuthSessionState =
  | { status: 'booting'; user: null }
  | { status: 'guest'; user: null }
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

export type AuthMode = 'local' | 'backend'

interface RefreshInFlight {
  refreshToken: string
  promise: Promise<AuthTokens>
}

interface BootstrapResult {
  user: User
}

const AuthSessionContext = createContext<AuthSessionValue | null>(null)

/**
 * 本地开发默认使用浏览器内的开发登录，生产环境始终连接真实认证接口。
 * 开发者仍可通过 VITE_AUTH_MODE=backend 在本地完整调试登录流程。
 */
export function resolveAuthMode(
  value = import.meta.env.VITE_AUTH_MODE,
  development = import.meta.env.DEV,
): AuthMode {
  if (!development) return 'backend'
  return value === 'backend' ? 'backend' : 'local'
}

/**
 * 按运行模式装配认证上下文；本地与后端适配器共用同一份会话逻辑。
 */
export function AuthModeProvider({ apis, children }: { apis: UserApis; children: ReactNode }) {
  return <AuthSessionProvider apis={apis}>{children}</AuthSessionProvider>
}

const LOCAL_USER_STORAGE_KEY = 'windup.auth.local-user'

/**
 * 本地开发认证适配器。
 *
 * 它只保存可展示的用户资料，不保存或校验密码、验证码；生产构建不会装配它。
 * 后端认证可用后只需切换 VITE_AUTH_MODE=backend，页面和会话逻辑无需重写。
 */
export function createLocalUserApis(): UserApis {
  let currentUser = readLocalUser()

  const authenticate = (email: string, nickname?: string): AuthTokens => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) throw new Error('请输入邮箱')
    currentUser = {
      id: currentUser?.email === normalizedEmail ? currentUser.id : 1,
      email: normalizedEmail,
      nickname: nickname?.trim() || currentUser?.nickname || normalizedEmail.split('@')[0] || null,
      emailVerifiedAt: currentUser?.emailVerifiedAt ?? new Date().toISOString(),
      status: 'normal',
    }
    saveLocalUser(currentUser)
    return localTokens(currentUser)
  }

  return {
    async sendCode() {},
    async register(input) {
      return authenticate(input.email, input.nickname)
    },
    async login(input) {
      return authenticate(input.email)
    },
    async loginByCode(input) {
      return authenticate(input.email)
    },
    async refresh(refreshToken) {
      currentUser = readLocalUser()
      if (!currentUser || refreshToken !== localRefreshToken(currentUser)) {
        throw new Error('本地登录已失效')
      }
      return localTokens(currentUser)
    },
    async logout() {},
    async me() {
      currentUser = readLocalUser()
      if (!currentUser) throw new Error('本地用户不存在')
      return currentUser
    },
    async changePassword() {
      if (!currentUser) throw new Error('请先登录')
    },
  }
}

function localTokens(user: User): AuthTokens {
  return {
    accessToken: `local-access:${user.id}`,
    refreshToken: localRefreshToken(user),
    user,
  }
}

function localRefreshToken(user: User): string {
  return `local-refresh:${user.id}`
}

function readLocalUser(): User | null {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_USER_STORAGE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      typeof value.id !== 'number' ||
      typeof value.email !== 'string' ||
      (typeof value.nickname !== 'string' && value.nickname !== null) ||
      (typeof value.emailVerifiedAt !== 'string' && value.emailVerifiedAt !== null) ||
      (value.status !== 'normal' && value.status !== 'banned')
    ) {
      return null
    }
    return value as unknown as User
  } catch {
    return null
  }
}

function saveLocalUser(user: User): void {
  globalThis.localStorage?.setItem(LOCAL_USER_STORAGE_KEY, JSON.stringify(user))
}

export function AuthSessionProvider({ apis, children }: AuthSessionProviderProps) {
  const [state, setState] = useState<AuthSessionState>({ status: 'booting', user: null })
  const [accessTokenVersion, setAccessTokenVersion] = useState(0)
  const accessTokenRef = useRef<string | null>(null)
  const refreshTokenRef = useRef<string | null>(null)
  const sessionGenerationRef = useRef(0)
  const refreshInFlightRef = useRef<RefreshInFlight | null>(null)
  const recoveryInFlightRef = useRef<Promise<boolean> | null>(null)
  const bootstrapPromiseRef = useRef<Promise<BootstrapResult | null | undefined> | null>(null)
  const bootstrapGenerationRef = useRef<number | null>(null)

  const storeTokenMaterial = useCallback((tokens: AuthTokens) => {
    accessTokenRef.current = tokens.accessToken
    refreshTokenRef.current = tokens.refreshToken
    saveRefreshToken(tokens.refreshToken)
    setAccessTokenVersion((version) => version + 1)
  }, [])

  const applyTokens = useCallback(
    (tokens: AuthTokens) => {
      sessionGenerationRef.current += 1
      storeTokenMaterial(tokens)
      setState({ status: 'authenticated', user: tokens.user })
    },
    [storeTokenMaterial],
  )

  const clearSession = useCallback(() => {
    sessionGenerationRef.current += 1
    accessTokenRef.current = null
    refreshTokenRef.current = null
    clearRefreshToken()
    setAccessTokenVersion((version) => version + 1)
    setState({ status: 'guest', user: null })
  }, [])

  const rotateTokens = useCallback(
    (refreshToken: string): Promise<AuthTokens> => {
      const inFlight = refreshInFlightRef.current
      if (inFlight?.refreshToken === refreshToken) return inFlight.promise

      const promise = apis.refresh(refreshToken)
      const current = { refreshToken, promise }
      refreshInFlightRef.current = current
      const clearInFlight = () => {
        if (refreshInFlightRef.current === current) refreshInFlightRef.current = null
      }
      void promise.then(clearInFlight, clearInFlight)
      return promise
    },
    [apis],
  )

  const recoverUnauthorized = useCallback((): Promise<boolean> => {
    if (recoveryInFlightRef.current) return recoveryInFlightRef.current
    const refreshToken = refreshTokenRef.current
    if (!refreshToken) return Promise.resolve(false)
    const generation = sessionGenerationRef.current

    const recovery = rotateTokens(refreshToken).then(
      (tokens) => {
        if (sessionGenerationRef.current !== generation) return false
        applyTokens(tokens)
        return true
      },
      () => {
        if (sessionGenerationRef.current === generation) clearSession()
        return false
      },
    )
    recoveryInFlightRef.current = recovery
    const release = () => {
      if (recoveryInFlightRef.current === recovery) recoveryInFlightRef.current = null
    }
    void recovery.then(release, release)
    return recovery
  }, [applyTokens, clearSession, rotateTokens])

  useEffect(() => registerApiAccessTokenProvider(() => accessTokenRef.current), [])
  useEffect(() => registerApiUnauthorizedRecovery(recoverUnauthorized), [recoverUnauthorized])

  useEffect(() => {
    let active = true

    if (!bootstrapPromiseRef.current) {
      const bootstrapGeneration = sessionGenerationRef.current
      bootstrapGenerationRef.current = bootstrapGeneration
      const persistedRefreshToken = loadRefreshToken()
      bootstrapPromiseRef.current = persistedRefreshToken
        ? rotateTokens(persistedRefreshToken).then(async (tokens) => {
            if (sessionGenerationRef.current !== bootstrapGeneration) return undefined
            storeTokenMaterial(tokens)
            const user = await apis.me()
            if (sessionGenerationRef.current !== bootstrapGeneration) return undefined
            return { user }
          })
        : Promise.resolve(null)
    }

    void bootstrapPromiseRef.current.then(
      (result) => {
        if (
          !active ||
          bootstrapGenerationRef.current !== sessionGenerationRef.current ||
          result === undefined
        )
          return
        if (!result) {
          clearSession()
          return
        }
        setState({ status: 'authenticated', user: result.user })
      },
      () => {
        if (active && bootstrapGenerationRef.current === sessionGenerationRef.current)
          clearSession()
      },
    )

    return () => {
      active = false
    }
  }, [apis, clearSession, rotateTokens, storeTokenMaterial])

  useEffect(() => {
    const accessToken = accessTokenRef.current
    const refreshAt = getRefreshTime(accessToken)
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
          void rotateTokens(refreshToken).then(
            (tokens) => {
              if (!cancelled && refreshTokenRef.current === refreshToken) applyTokens(tokens)
            },
            () => {
              if (!cancelled && refreshTokenRef.current === refreshToken) clearSession()
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
  }, [accessTokenVersion, applyTokens, clearSession, rotateTokens])

  const sendCode = useCallback(
    (input: Parameters<UserApis['sendCode']>[0]) => apis.sendCode(input),
    [apis],
  )

  const register = useCallback(
    async (input: Parameters<UserApis['register']>[0]) => {
      const tokens = await apis.register(input)
      applyTokens(tokens)
      return tokens
    },
    [apis, applyTokens],
  )

  const login = useCallback(
    async (input: Parameters<UserApis['login']>[0]) => {
      const tokens = await apis.login(input)
      applyTokens(tokens)
      return tokens
    },
    [apis, applyTokens],
  )

  const loginByCode = useCallback(
    async (input: Parameters<UserApis['loginByCode']>[0]) => {
      const tokens = await apis.loginByCode(input)
      applyTokens(tokens)
      return tokens
    },
    [apis, applyTokens],
  )

  const changePassword = useCallback(
    async (input: Parameters<UserApis['changePassword']>[0]) => {
      await apis.changePassword(input)
      clearSession()
    },
    [apis, clearSession],
  )

  const logout = useCallback(async () => {
    const refreshToken = refreshTokenRef.current
    clearSession()
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

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { state } = useAuthSession()
  const location = useLocation()

  if (state.status === 'booting') return null
  if (state.status === 'authenticated') return children

  const returnTo = `${location.pathname}${location.search}${location.hash}`
  const loginTarget = isSafeReturnTo(returnTo)
    ? `/?account=login&returnTo=${encodeURIComponent(returnTo)}`
    : '/?account=login'
  return <Navigate replace to={loginTarget} />
}

function isSafeReturnTo(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//')
}

function getRefreshTime(accessToken: string | null): number | null {
  if (!accessToken) return null
  const payload = accessToken.split('.')[1]
  if (!payload) return null

  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const parsed: unknown = JSON.parse(globalThis.atob(padded))
    if (!isRecord(parsed) || typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp))
      return null
    return parsed.exp * 1_000 - 60_000
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
