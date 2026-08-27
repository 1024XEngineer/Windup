/* oxlint-disable react/only-export-components -- 测试会话组件与配套 fixture 共用一个入口。 */
import type { ReactNode } from 'react'

import type { AuthTokens, User, UserApis } from '@/entities'
import { AuthSessionProvider, useAuthSession } from '@/features/auth-session'

export const testUser: User = {
  id: '7',
  email: 'reader@example.com',
  nickname: 'Reader',
  emailVerifiedAt: '2026-08-07T01:02:03Z',
  statusCode: 0,
  hasPassword: true,
}

function tokens(): AuthTokens {
  return {
    accessToken: 'access-token-for-test',
    refreshToken: 'rotated-refresh-token',
    user: testUser,
  }
}

export function createAuthenticatedTestApis(): UserApis {
  return {
    sendCode: async () => undefined,
    register: async () => tokens(),
    login: async () => tokens(),
    loginByCode: async () => tokens(),
    refresh: async () => tokens(),
    logout: async () => undefined,
    me: async () => testUser,
    updateNickname: async () => testUser,
    setPassword: async () => undefined,
    changePassword: async () => undefined,
  }
}

const guestApis: UserApis = {
  sendCode: async () => undefined,
  register: async () => Promise.reject(new Error('guest test session does not register')),
  login: async () => Promise.reject(new Error('guest test session does not log in')),
  loginByCode: async () => Promise.reject(new Error('guest test session does not log in')),
  refresh: async () => Promise.reject(new Error('guest test session has no refresh token')),
  logout: async () => undefined,
  me: async () => Promise.reject(new Error('guest test session has no current user')),
  updateNickname: async () => Promise.reject(new Error('guest test session cannot update profile')),
  setPassword: async () => Promise.reject(new Error('guest test session cannot set password')),
  changePassword: async () =>
    Promise.reject(new Error('guest test session cannot change password')),
}

/** 为直接渲染 AppRoutes 的页面测试补齐生产组合根中的访客会话。 */
export function GuestAuthSession({ children }: { children: ReactNode }) {
  return <AuthSessionProvider apis={guestApis}>{children}</AuthSessionProvider>
}

export function AuthenticatedAuthSession({ children }: { children: ReactNode }) {
  window.localStorage.setItem('windup.auth.refresh-token', 'stored-refresh-token')
  return (
    <AuthSessionProvider apis={createAuthenticatedTestApis()}>
      <AuthenticatedChildren>{children}</AuthenticatedChildren>
    </AuthSessionProvider>
  )
}

/** 业务页面只在 access token 已恢复后挂载，避免把启动中的空 token 固化进首次 render。 */
function AuthenticatedChildren({ children }: { children: ReactNode }) {
  const session = useAuthSession()
  return session.state.status === 'authenticated' ? children : null
}
