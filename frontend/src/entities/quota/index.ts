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

export interface QuotaApis {
  getBalance(): Promise<CreditAccount>
}

export { createQuotaApis, quotaApis } from './api'
export type { CreateQuotaApisOptions } from './api'
