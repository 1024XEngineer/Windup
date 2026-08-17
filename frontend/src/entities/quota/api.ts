import type {
  CreditAccount,
  CreditTransaction,
  QuotaApis,
  QuotaTransactionPageQuery,
} from './types'

import { createApiClient, getApiAccessToken } from '@/shared/api'
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

interface CreditTransactionDto {
  id: number
  user_id: number
  delta: number
  reason: number
  billing_mode: number
  ref_id: string | null
  balance_after: number
  create_at: string
}

export interface CreateQuotaApisOptions extends ApiClientOptions {
  client?: ApiClient
}

function toCreditAccount(dto: CreditAccountDto): CreditAccount {
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

function toCreditTransaction(dto: CreditTransactionDto): CreditTransaction {
  return {
    id: String(dto.id),
    userId: String(dto.user_id),
    delta: dto.delta,
    reason: dto.reason,
    billingMode: dto.billing_mode,
    refId: dto.ref_id,
    balanceAfter: dto.balance_after,
    createdAt: dto.create_at,
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
    async listTransactions(query: QuotaTransactionPageQuery = {}) {
      const result = await protectedClient.requestList<CreditTransactionDto>(
        '/quota/transactions',
        {
          query: { page: query.page, page_size: query.pageSize },
        },
      )
      return { ...result, items: result.items.map(toCreditTransaction) }
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
  listTransactions: (query) => getDefaultApis().listTransactions(query),
}
