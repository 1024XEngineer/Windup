/* oxlint-disable react/only-export-components -- Provider 与 hook 是同一会话边界。 */
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

import { AdminApiError, type AdminApis, type AdminUser } from './api'

export type AdminSessionState =
  | { status: 'booting'; admin: null }
  | { status: 'guest'; admin: null; error: string | null }
  | { status: 'authenticated'; admin: AdminUser }

interface AdminSessionValue {
  state: AdminSessionState
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
}

const AdminSessionContext = createContext<AdminSessionValue | null>(null)

export function AdminSessionProvider({ apis, children }: { apis: AdminApis; children: ReactNode }) {
  const [state, setState] = useState<AdminSessionState>({ status: 'booting', admin: null })
  const restorePromiseRef = useRef<Promise<AdminUser> | null>(null)

  useEffect(() => {
    let active = true
    if (!restorePromiseRef.current) {
      restorePromiseRef.current = (async () => {
        try {
          return await apis.me()
        } catch (error) {
          if (!(error instanceof AdminApiError) || error.code !== 401) throw error
          return apis.refresh()
        }
      })()
    }
    void restorePromiseRef.current.then(
      (admin) => {
        if (active) setState({ status: 'authenticated', admin })
      },
      (error: unknown) => {
        if (!active) return
        const isMissingSession = error instanceof AdminApiError && error.code === 401
        setState({
          status: 'guest',
          admin: null,
          error: isMissingSession ? null : '暂时无法连接管理服务',
        })
      },
    )
    return () => {
      active = false
    }
  }, [apis])

  const login = useCallback(
    async (email: string, password: string) => {
      const admin = await apis.login({ email, password })
      setState({ status: 'authenticated', admin })
    },
    [apis],
  )

  const logout = useCallback(async () => {
    try {
      await apis.logout()
    } finally {
      setState({ status: 'guest', admin: null, error: null })
    }
  }, [apis])

  const value = useMemo(() => ({ state, login, logout }), [login, logout, state])
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>
}

export function useAdminSession(): AdminSessionValue {
  const session = useContext(AdminSessionContext)
  if (!session) throw new Error('useAdminSession 必须在 AdminSessionProvider 内使用')
  return session
}
