import type { Paged, PageQuery } from '@/shared/pagination'

/** 积分账户 —— 当前用户的积分余额与累计统计。 */
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

/** 积分变动原因（对应后端 CreditReason）。 */
export type CreditReason =
  | 'register-gift'
  | 'invite-reward'
  | 'generate-image'
  | 'generate-action'
  | 'admin-adjust'
  | 'refund'
  | 'frozen'
  | 'captured'

export const CREDIT_REASON_LABELS: Record<CreditReason, string> = {
  'register-gift': '注册赠送',
  'invite-reward': '邀请奖励',
  'generate-image': '生成角色参考图',
  'generate-action': '生成角色动作',
  'admin-adjust': '管理员调整',
  refund: '退款 / 回退',
  frozen: '冻结',
  captured: '扣减',
}

/** 计费模式（对应后端 BillingMode）；后端目前只有预付费。 */
export type BillingMode = 'prepaid'

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  prepaid: '预付费',
}

/** 积分流水 —— 一次余额变动。 */
export interface CreditTransaction {
  id: string
  userId: string
  delta: number
  reason: CreditReason
  billingMode: BillingMode
  refId: string | null
  balanceAfter: number
  createdAt: string
}

export type QuotaTransactionPageQuery = PageQuery

/** 积分模块对应的一组后端接口。 */
export interface QuotaApis {
  getBalance(): Promise<CreditAccount>
  listTransactions(query?: QuotaTransactionPageQuery): Promise<Paged<CreditTransaction>>
}

export { createQuotaApis, quotaApis } from './api'
export type { CreateQuotaApisOptions } from './api'
