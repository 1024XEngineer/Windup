import type {
  BillingMode,
  CreditAccount,
  CreditReason,
  CreditTransaction,
  QuotaApis,
  QuotaTransactionPageQuery,
} from '.'
import { ApiError, createApiClient } from '@/shared/api'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(data: unknown): never {
  throw new ApiError('积分响应格式无效', { kind: 'invalid-response', data })
}

const reasonFromDto: Record<number, CreditReason> = {
  1: 'register-gift',
  2: 'invite-reward',
  3: 'generate-image',
  4: 'generate-action',
  5: 'admin-adjust',
  6: 'refund',
  7: 'frozen',
  8: 'captured',
}

const billingModeFromDto: Record<number, BillingMode> = {
  0: 'prepaid',
}

function mapCreditReason(value: number): CreditReason {
  const reason = reasonFromDto[value]
  if (reason !== undefined) return reason
  return invalidResponse(value)
}

function mapBillingMode(value: number): BillingMode {
  const mode = billingModeFromDto[value]
  if (mode !== undefined) return mode
  return invalidResponse(value)
}

function mapCreditAccount(dto: CreditAccountDto): CreditAccount {
  if (
    !isRecord(dto) ||
    !Number.isInteger(dto.id) ||
    dto.id <= 0 ||
    !Number.isInteger(dto.user_id) ||
    dto.user_id <= 0 ||
    !Number.isInteger(dto.balance) ||
    !Number.isInteger(dto.frozen) ||
    !Number.isInteger(dto.total_earned) ||
    !Number.isInteger(dto.total_spent) ||
    typeof dto.create_at !== 'string' ||
    typeof dto.update_at !== 'string'
  ) {
    return invalidResponse(dto)
  }
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

function mapCreditTransaction(dto: CreditTransactionDto): CreditTransaction {
  if (
    !isRecord(dto) ||
    !Number.isInteger(dto.id) ||
    dto.id <= 0 ||
    !Number.isInteger(dto.user_id) ||
    dto.user_id <= 0 ||
    !Number.isInteger(dto.delta) ||
    (typeof dto.ref_id !== 'string' && dto.ref_id !== null) ||
    !Number.isInteger(dto.balance_after) ||
    typeof dto.create_at !== 'string'
  ) {
    return invalidResponse(dto)
  }
  return {
    id: String(dto.id),
    userId: String(dto.user_id),
    delta: dto.delta,
    reason: mapCreditReason(dto.reason),
    billingMode: mapBillingMode(dto.billing_mode),
    refId: dto.ref_id,
    balanceAfter: dto.balance_after,
    createdAt: dto.create_at,
  }
}

export function createQuotaApis(options: CreateQuotaApisOptions = {}): QuotaApis {
  const { client, ...clientOptions } = options
  const apiClient = client ?? createApiClient(clientOptions)

  return {
    async getBalance() {
      return mapCreditAccount(await apiClient.request<CreditAccountDto>('/quota/balance'))
    },
    async listTransactions(query: QuotaTransactionPageQuery = {}) {
      const result = await apiClient.requestList<CreditTransactionDto>('/quota/transactions', {
        query: {
          page: query.page,
          page_size: query.pageSize,
        },
      })
      return { ...result, items: result.items.map(mapCreditTransaction) }
    },
  }
}

let defaultApis: QuotaApis | undefined

function getDefaultApis(): QuotaApis {
  defaultApis ??= createQuotaApis()
  return defaultApis
}

/** 延迟创建默认 client，避免仅导入 entities 时要求运行环境已经配置 API 地址。 */
export const quotaApis: QuotaApis = {
  getBalance: () => getDefaultApis().getBalance(),
  listTransactions: (query) => getDefaultApis().listTransactions(query),
}
