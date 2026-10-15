import { expect, it } from 'vitest'
import { createBillBackend } from '@/test/bill-backend'
import { createBillApis } from './api'

it('读取真实商品价格并映射订阅账期与两类余额', async () => {
  const backend = createBillBackend()
  backend.products[0].amount_fen = 3100
  backend.subscription.active_subscription = {
    tier: 2,
    status: 1,
    period_start: '2026-10-01T00:00:00Z',
    period_end: '2026-11-01T00:00:00Z',
  }
  backend.subscription.expiring_credits = 1280
  const apis = createBillApis({ baseUrl: '/api', fetchFn: backend.fetchFn })
  expect((await apis.listProducts())[0]).toMatchObject({
    id: 11,
    amountFen: 3100,
    credits: 400,
    type: 2,
  })
  expect(await apis.getSubscription()).toEqual({
    activeSubscription: {
      tier: 2,
      status: 1,
      periodStart: '2026-10-01T00:00:00Z',
      periodEnd: '2026-11-01T00:00:00Z',
    },
    nextSubscription: null,
    perpetualCredits: 250,
    expiringCredits: 1280,
  })
})

it('自定义下单使用整数分和选中渠道，并复用认证边界', async () => {
  const backend = createBillBackend()
  const apis = createBillApis({
    baseUrl: '/api',
    fetchFn: backend.fetchFn,
    getAccessToken: () => 'test-access',
  })
  const order = await apis.createOrder({ amountFen: 700, channel: 'wxpay' })
  expect(order).toMatchObject({
    orderNo: 'ORD202610150001',
    amountFen: 700,
    credits: 88,
    channel: 'wxpay',
    status: 0,
    payUrl: 'https://cashier.example.test/submit.php?out_trade_no=ORD202610150001',
  })
  expect(backend.calls[0]).toEqual({
    path: '/bill/orders',
    method: 'POST',
    body: { amount_fen: 700, channel: 'wxpay' },
    authorization: 'Bearer test-access',
  })
})

it('套餐下单只传商品编号，金额和积分采用后端订单快照', async () => {
  const backend = createBillBackend()
  const apis = createBillApis({ baseUrl: '/api', fetchFn: backend.fetchFn })
  const order = await apis.createOrder({ productId: 12, channel: 'alipay' })
  expect(backend.calls[0].body).toEqual({ product_id: 12, channel: 'alipay' })
  expect(order).toMatchObject({ productId: 12, amountFen: 9900, credits: 1500, name: 'Pro' })
})

it('历史订单使用后端分页，关闭后再查询权威状态', async () => {
  const backend = createBillBackend()
  backend.orders.push(backend.makeOrder())
  const apis = createBillApis({ baseUrl: '/api', fetchFn: backend.fetchFn })
  const page = await apis.listOrders({ page: 2, pageSize: 5 })
  expect(page).toEqual({ items: [], total: 1, page: 2, pageSize: 5 })
  expect(backend.calls[0].path).toBe('/bill/orders?page=2&page_size=5')
  await apis.closeOrder('ORD202610150001')
  expect((await apis.getOrder('ORD202610150001')).status).toBe(2)
})
