import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'
import type { UserApis } from '@/entities'
import { REFRESH_TOKEN_STORAGE_KEY } from '@/features/auth-session/session-storage'

const user = {
  id: 7,
  email: 'ada@example.test',
  nickname: 'Ada',
  emailVerifiedAt: null,
  status: 'normal' as const,
}

const userApis = {
  sendCode: async () => undefined,
  register: async () => ({ accessToken: 'access', refreshToken: 'refresh', user }),
  login: async () => ({ accessToken: 'access', refreshToken: 'refresh', user }),
  loginByCode: async () => ({ accessToken: 'access', refreshToken: 'refresh', user }),
  refresh: async () => ({ accessToken: 'access', refreshToken: 'refresh', user }),
  logout: async () => undefined,
  me: async () => user,
  changePassword: async () => undefined,
} satisfies UserApis

/** 真实认证守卫下渲染产品路由，避免每个页面测试重复认证装配。 */
export function renderAuthenticatedAppRoute(route: string) {
  window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh')
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppRoutes userApis={userApis} />
    </MemoryRouter>,
  )
}
