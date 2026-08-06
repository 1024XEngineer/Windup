import type { AuthTokens, User, UserApis } from '.'

import { ApiError, createApiClient, getApiAccessToken } from '@/shared/api'
import type { ApiClient, ApiClientOptions } from '@/shared/api'

interface UserDto {
  id: number | null
  email: string | null
  nickname: string | null
  email_verified_at: string | null
  status: number
  [key: string]: unknown
}

interface AuthTokensDto {
  access_token: string
  refresh_token: string
  user: UserDto
  [key: string]: unknown
}

export interface CreateUserApisOptions extends ApiClientOptions {
  client?: ApiClient
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(data: unknown): never {
  throw new ApiError('用户认证响应格式无效', { kind: 'invalid-response', data })
}

function toUser(value: unknown): User {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.id) ||
    (value.id as number) <= 0 ||
    typeof value.email !== 'string' ||
    (typeof value.nickname !== 'string' && value.nickname !== null) ||
    (typeof value.email_verified_at !== 'string' && value.email_verified_at !== null) ||
    !Number.isInteger(value.status)
  ) {
    invalidResponse(value)
  }

  const dto = value as unknown as UserDto
  return {
    id: String(dto.id),
    email: dto.email as string,
    nickname: dto.nickname,
    emailVerifiedAt: dto.email_verified_at,
    statusCode: dto.status,
  }
}

function toAuthTokens(value: unknown): AuthTokens {
  if (
    !isRecord(value) ||
    typeof value.access_token !== 'string' ||
    typeof value.refresh_token !== 'string' ||
    !Object.hasOwn(value, 'user')
  ) {
    invalidResponse(value)
  }

  const dto = value as unknown as AuthTokensDto
  return {
    accessToken: dto.access_token,
    refreshToken: dto.refresh_token,
    user: toUser(dto.user),
  }
}

export function createUserApis(options: CreateUserApisOptions = {}): UserApis {
  const { client, ...clientOptions } = options
  const apiClient =
    client ??
    createApiClient({
      ...clientOptions,
      getAccessToken: clientOptions.getAccessToken ?? getApiAccessToken,
      recoverUnauthorized: false,
    })

  return {
    async sendCode(input) {
      await apiClient.request<null>('/auth/send-code', { method: 'POST', json: input })
    },

    async register(input) {
      const json = {
        email: input.email,
        password: input.password,
        code: input.code,
        ...(input.nickname ? { nickname: input.nickname } : {}),
      }
      return toAuthTokens(
        await apiClient.request<AuthTokensDto>('/auth/register', { method: 'POST', json }),
      )
    },

    async login(input) {
      return toAuthTokens(
        await apiClient.request<AuthTokensDto>('/auth/login', { method: 'POST', json: input }),
      )
    },

    async loginByCode(input) {
      return toAuthTokens(
        await apiClient.request<AuthTokensDto>('/auth/login-by-code', {
          method: 'POST',
          json: input,
        }),
      )
    },

    async refresh(refreshToken) {
      return toAuthTokens(
        await apiClient.request<AuthTokensDto>('/auth/refresh', {
          method: 'POST',
          json: { refresh_token: refreshToken },
        }),
      )
    },

    async logout(refreshToken) {
      await apiClient.request<null>('/auth/logout', {
        method: 'POST',
        json: { refresh_token: refreshToken },
      })
    },

    async me() {
      return toUser(await apiClient.request<UserDto>('/auth/me'))
    },

    async changePassword(input) {
      await apiClient.request<null>('/auth/change-password', {
        method: 'POST',
        json: { old_password: input.oldPassword, new_password: input.newPassword },
      })
    },
  }
}

let defaultApis: UserApis | undefined

function getDefaultApis(): UserApis {
  defaultApis ??= createUserApis()
  return defaultApis
}

/** 延迟创建默认 client，避免仅导入 entities 时要求运行环境已经配置 API 地址。 */
export const userApis: UserApis = {
  sendCode: (input) => getDefaultApis().sendCode(input),
  register: (input) => getDefaultApis().register(input),
  login: (input) => getDefaultApis().login(input),
  loginByCode: (input) => getDefaultApis().loginByCode(input),
  refresh: (refreshToken) => getDefaultApis().refresh(refreshToken),
  logout: (refreshToken) => getDefaultApis().logout(refreshToken),
  me: () => getDefaultApis().me(),
  changePassword: (input) => getDefaultApis().changePassword(input),
}
