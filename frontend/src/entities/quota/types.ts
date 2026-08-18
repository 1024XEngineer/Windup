import type { Paged, PageQuery } from '@/shared/pagination'

/** 当前登录用户的积分账户；数值均由后端账本汇总。 */
export interface CreditAccount {
  id: string
  userId: string
  balance: number
  frozen: number
  totalEarned: number
  totalSpent: number
  createdAt: string
  updatedAt: string
}

/** 一次积分余额变动；原因与计费模式保留后端数字码，兼容后端新增枚举值。 */
export interface CreditTransaction {
  id: string
  userId: string
  delta: number
  reason: number
  billingMode: number
  refId: string | null
  balanceAfter: number
  createdAt: string
}

export type QuotaTransactionPageQuery = PageQuery

export interface QuotaApis {
  getBalance(): Promise<CreditAccount>
  listTransactions(query?: QuotaTransactionPageQuery): Promise<Paged<CreditTransaction>>
}
