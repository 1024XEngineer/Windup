import type { AuthTokens, User, UserApis } from '.'

import { ApiError, createApiClient, getApiAccessToken } from '@/shared/api'
import type { ApiClient, ApiClientOptions } from '@/shared/api'

interface BackendUser {
  id: number
  email: string
  nickname: string | null
  email_verified_at: string | null
  status: number
}

interface BackendAuthTokens {
  access_token: string
  refresh_token: string
  user: BackendUser
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

function toUser(raw: unknown): User {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'number' ||
    typeof raw.email !== 'string' ||
    (typeof raw.nickname !== 'string' && raw.nickname !== null) ||
    (typeof raw.email_verified_at !== 'string' && raw.email_verified_at !== null) ||
    (raw.status !== 0 && raw.status !== 1)
  ) {
    invalidResponse(raw)
  }

  return {
    id: raw.id,
    email: raw.email,
    nickname: raw.nickname,
    emailVerifiedAt: raw.email_verified_at,
    status: raw.status === 1 ? 'banned' : 'normal',
  }
}

function toAuthTokens(raw: unknown): AuthTokens {
  if (
    !isRecord(raw) ||
    typeof raw.access_token !== 'string' ||
    typeof raw.refresh_token !== 'string' ||
    !isRecord(raw.user)
  ) {
    invalidResponse(raw)
  }

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    user: toUser(raw.user),
  }
}

export function createUserApis(options: CreateUserApisOptions = {}): UserApis {
  const { client, ...clientOptions } = options
  const apiClient =
    client ??
    createApiClient({
      ...clientOptions,
      getAccessToken: clientOptions.getAccessToken ?? getApiAccessToken,
      // 认证端点本身失败时不能再次触发 refresh，否则会形成递归恢复。
      recoverUnauthorized: false,
    })

  return {
    async sendCode(input): Promise<void> {
      await apiClient.request<null>('/auth/send-code', { method: 'POST', json: input })
    },

    async register(input): Promise<AuthTokens> {
      return toAuthTokens(
        await apiClient.request<BackendAuthTokens>('/auth/register', {
          method: 'POST',
          json: input,
        }),
      )
    },

    async login(input): Promise<AuthTokens> {
      return toAuthTokens(
        await apiClient.request<BackendAuthTokens>('/auth/login', {
          method: 'POST',
          json: input,
        }),
      )
    },

    async loginByCode(input): Promise<AuthTokens> {
      return toAuthTokens(
        await apiClient.request<BackendAuthTokens>('/auth/login-by-code', {
          method: 'POST',
          json: input,
        }),
      )
    },

    async refresh(refreshToken): Promise<AuthTokens> {
      return toAuthTokens(
        await apiClient.request<BackendAuthTokens>('/auth/refresh', {
          method: 'POST',
          json: { refresh_token: refreshToken },
        }),
      )
    },

    async logout(refreshToken): Promise<void> {
      await apiClient.request<null>('/auth/logout', {
        method: 'POST',
        json: { refresh_token: refreshToken },
      })
    },

    async me(): Promise<User> {
      return toUser(await apiClient.request<BackendUser>('/auth/me'))
    },

    async changePassword(input): Promise<void> {
      await apiClient.request<null>('/auth/change-password', {
        method: 'POST',
        json: { old_password: input.oldPassword, new_password: input.newPassword },
      })
    },
  }
}
