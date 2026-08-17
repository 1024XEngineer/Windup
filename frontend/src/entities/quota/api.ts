import type { CreditAccount, QuotaApis } from '.'

import { ApiError, createApiClient, getApiAccessToken } from '@/shared/api'
import type { ApiClient, ApiClientOptions } from '@/shared/api'

interface CreditAccountDto {
  id: number
  user_id: number
  balance: number
  frozen: number
  total_earned: number
  total_spent: number
  create_at: string
  update_at: string
}

export interface CreateQuotaApisOptions extends ApiClientOptions {
  client?: ApiClient
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function invalidResponse(data: unknown): never {
  throw new ApiError('积分账户响应格式无效', { kind: 'invalid-response', data })
}

function toCreditAccount(value: unknown): CreditAccount {
  if (
    !isRecord(value) ||
    !isPositiveInteger(value.id) ||
    !isPositiveInteger(value.user_id) ||
    !isNonNegativeInteger(value.balance) ||
    !isNonNegativeInteger(value.frozen) ||
    !isNonNegativeInteger(value.total_earned) ||
    !isNonNegativeInteger(value.total_spent) ||
    typeof value.create_at !== 'string' ||
    value.create_at.length === 0 ||
    typeof value.update_at !== 'string' ||
    value.update_at.length === 0
  ) {
    return invalidResponse(value)
  }

  const dto = value as unknown as CreditAccountDto
  return {
    id: String(dto.id),
    userId: String(dto.user_id),
    balance: dto.balance,
    frozen: dto.frozen,
    totalEarned: dto.total_earned,
    totalSpent: dto.total_spent,
    createdAt: dto.create_at,
    updatedAt: dto.update_at,
  }
}

export function createQuotaApis(options: CreateQuotaApisOptions = {}): QuotaApis {
  const { client, ...clientOptions } = options
  const protectedClient =
    client ??
    createApiClient({
      ...clientOptions,
      getAccessToken: clientOptions.getAccessToken ?? getApiAccessToken,
    })

  return {
    async getBalance() {
      return toCreditAccount(await protectedClient.request<CreditAccountDto>('/quota/balance'))
    },
  }
}

let defaultApis: QuotaApis | undefined

function getDefaultApis(): QuotaApis {
  defaultApis ??= createQuotaApis()
  return defaultApis
}

/** 默认适配器延迟初始化，避免仅导入 entities 时强制要求 API 地址。 */
export const quotaApis: QuotaApis = {
  getBalance: () => getDefaultApis().getBalance(),
}
