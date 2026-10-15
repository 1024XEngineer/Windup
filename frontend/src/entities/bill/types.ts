import type { Paged, PageQuery } from '@/shared/pagination'

export const BILL_PRODUCT_TYPE = { TOP_UP: 1, SUBSCRIPTION: 2 } as const
export const BILL_ORDER_STATUS = {
  PENDING: 0,
  PAID: 1,
  CLOSED: 2,
  REFUNDING: 3,
  REFUNDED: 4,
} as const
export type PaymentChannel = 'alipay' | 'wxpay'

export interface BillProduct {
  id: number
  type: number
  tier: number | null
  name: string
  description: string | null
  /** 人民币整数分；仅在展示时转换为元。 */
  amountFen: number
  credits: number
  originalAmountFen: number | null
  badge: string | null
}

export interface BillSubscription {
  tier: number
  status: number
  periodStart: string
  periodEnd: string
}

export interface SubscriptionStatus {
  activeSubscription: BillSubscription | null
  nextSubscription: BillSubscription | null
  perpetualCredits: number
  expiringCredits: number
}

export interface BillOrder {
  orderNo: string
  productId: number | null
  productType: number
  name: string
  amountFen: number
  credits: number
  channel: string
  status: number
  payUrl: string | null
  expireAt: string
  paidAt: string | null
  closedAt: string | null
  createdAt: string
}

/** 商品金额由服务端确定；自定义充值才传 amountFen。 */
export type CreateBillOrder = (
  | { productId: number; amountFen?: never }
  | { amountFen: number; productId?: never }
) & { channel: PaymentChannel }

export interface BillApis {
  listProducts(): Promise<BillProduct[]>
  getSubscription(): Promise<SubscriptionStatus>
  createOrder(input: CreateBillOrder): Promise<BillOrder>
  listOrders(query?: PageQuery): Promise<Paged<BillOrder>>
  getOrder(orderNo: string): Promise<BillOrder>
  closeOrder(orderNo: string): Promise<void>
}
