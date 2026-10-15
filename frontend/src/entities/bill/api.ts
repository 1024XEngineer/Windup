import { createApiClient, getApiAccessToken } from '@/shared/api'
import type { ApiClient, ApiClientOptions } from '@/shared/api'
import type { BillApis, BillOrder, BillProduct, BillSubscription } from './types'

interface ProductDto {
  id: number
  type: number
  tier: number | null
  name: string
  description: string | null
  amount_fen: number
  credits: number
  original_amount_fen: number | null
  badge: string | null
}

interface SubscriptionDto {
  tier: number
  status: number
  period_start: string
  period_end: string
}

interface SubscriptionStatusDto {
  active_subscription?: SubscriptionDto | null
  next_subscription?: SubscriptionDto | null
  perpetual_credits: number
  expiring_credits: number
}

interface OrderDto {
  order_no: string
  product_id: number | null
  product_type: number
  product_snapshot: Record<string, unknown>
  amount_fen: number
  credits: number
  channel: string
  status: number
  pay_url: string | null
  expire_at: string
  paid_at: string | null
  closed_at: string | null
  create_at: string
}

function toProduct(dto: ProductDto): BillProduct {
  return {
    id: dto.id,
    type: dto.type,
    tier: dto.tier,
    name: dto.name,
    description: dto.description,
    amountFen: dto.amount_fen,
    credits: dto.credits,
    originalAmountFen: dto.original_amount_fen,
    badge: dto.badge,
  }
}

function toSubscription(dto: SubscriptionDto | null | undefined): BillSubscription | null {
  return dto
    ? {
        tier: dto.tier,
        status: dto.status,
        periodStart: dto.period_start,
        periodEnd: dto.period_end,
      }
    : null
}

function toOrder(dto: OrderDto): BillOrder {
  return {
    orderNo: dto.order_no,
    productId: dto.product_id,
    productType: dto.product_type,
    name: typeof dto.product_snapshot.name === 'string' ? dto.product_snapshot.name : '积分充值',
    amountFen: dto.amount_fen,
    credits: dto.credits,
    channel: dto.channel,
    status: dto.status,
    payUrl: dto.pay_url,
    expireAt: dto.expire_at,
    paidAt: dto.paid_at,
    closedAt: dto.closed_at,
    createdAt: dto.create_at,
  }
}

export interface CreateBillApisOptions extends ApiClientOptions {
  client?: ApiClient
}

export function createBillApis(options: CreateBillApisOptions = {}): BillApis {
  const { client, ...clientOptions } = options
  const protectedClient =
    client ??
    createApiClient({
      ...clientOptions,
      getAccessToken: clientOptions.getAccessToken ?? getApiAccessToken,
    })
  return {
    async listProducts() {
      const result = await protectedClient.requestList<ProductDto>('/bill/products')
      return result.items.map(toProduct)
    },
    async getSubscription() {
      const dto = await protectedClient.request<SubscriptionStatusDto>('/bill/subscription')
      return {
        activeSubscription: toSubscription(dto.active_subscription),
        nextSubscription: toSubscription(dto.next_subscription),
        perpetualCredits: dto.perpetual_credits,
        expiringCredits: dto.expiring_credits,
      }
    },
    async createOrder(input) {
      return toOrder(
        await protectedClient.request<OrderDto>('/bill/orders', {
          method: 'POST',
          replayAfterAuth: false,
          json: {
            ...(input.productId === undefined
              ? { amount_fen: input.amountFen }
              : { product_id: input.productId }),
            channel: input.channel,
          },
        }),
      )
    },
    async listOrders(query = {}) {
      const result = await protectedClient.requestList<OrderDto>('/bill/orders', {
        query: { page: query.page, page_size: query.pageSize },
      })
      return { ...result, items: result.items.map(toOrder) }
    },
    async getOrder(orderNo) {
      return toOrder(
        await protectedClient.request<OrderDto>(`/bill/orders/${encodeURIComponent(orderNo)}`),
      )
    },
    async closeOrder(orderNo) {
      await protectedClient.request(`/bill/orders/${encodeURIComponent(orderNo)}/close`, {
        method: 'POST',
        replayAfterAuth: false,
      })
    },
  }
}

let defaultApis: BillApis | undefined
function getDefaultApis(): BillApis {
  return (defaultApis ??= createBillApis())
}

export const billApis: BillApis = {
  listProducts: () => getDefaultApis().listProducts(),
  getSubscription: () => getDefaultApis().getSubscription(),
  createOrder: (input) => getDefaultApis().createOrder(input),
  listOrders: (query) => getDefaultApis().listOrders(query),
  getOrder: (orderNo) => getDefaultApis().getOrder(orderNo),
  closeOrder: (orderNo) => getDefaultApis().closeOrder(orderNo),
}
