import type { ReactNode } from 'react'

import type { UserApis } from '@/entities'
import { AuthSessionProvider } from '@/features/auth-session'

const guestApis: UserApis = {
  sendCode: async () => undefined,
  register: async () => Promise.reject(new Error('guest test session does not register')),
  login: async () => Promise.reject(new Error('guest test session does not log in')),
  loginByCode: async () => Promise.reject(new Error('guest test session does not log in')),
  refresh: async () => Promise.reject(new Error('guest test session has no refresh token')),
  logout: async () => undefined,
  me: async () => Promise.reject(new Error('guest test session has no current user')),
  changePassword: async () =>
    Promise.reject(new Error('guest test session cannot change password')),
}

/** 为直接渲染 AppRoutes 的页面测试补齐生产组合根中的访客会话。 */
export function GuestAuthSession({ children }: { children: ReactNode }) {
  return <AuthSessionProvider apis={guestApis}>{children}</AuthSessionProvider>
}
