/** HTTP 替身复刻 openapi.json；生产入口不引用此模块。 */
export function createBillBackend() {
  const products = [
    {
      id: 11,
      type: 2,
      tier: 1,
      name: 'Plus',
      description: null,
      amount_fen: 2900,
      credits: 400,
      original_amount_fen: null,
      badge: null,
      sort_order: 1,
      extra_meta: {},
    },
    {
      id: 12,
      type: 2,
      tier: 2,
      name: 'Pro',
      description: null,
      amount_fen: 9900,
      credits: 1500,
      original_amount_fen: null,
      badge: '最受欢迎',
      sort_order: 2,
      extra_meta: {},
    },
    {
      id: 13,
      type: 2,
      tier: 3,
      name: 'Max',
      description: null,
      amount_fen: 19900,
      credits: 3200,
      original_amount_fen: null,
      badge: null,
      sort_order: 3,
      extra_meta: {},
    },
  ]
  const subscription = {
    active_subscription: null as null | {
      tier: number
      status: number
      period_start: string
      period_end: string
    },
    next_subscription: null as null | {
      tier: number
      status: number
      period_start: string
      period_end: string
    },
    perpetual_credits: 250,
    expiring_credits: 0,
  }
  const calls: {
    path: string
    method: string
    body: Record<string, unknown> | null
    authorization: string | null
  }[] = []
  const makeOrder = (
    overrides: Partial<{
      order_no: string
      product_id: number | null
      product_type: number
      amount_fen: number
      credits: number
      channel: string
      status: number
      pay_url: string | null
      expire_at: string
      product_snapshot: Record<string, unknown>
      paid_at: string | null
      closed_at: string | null
    }> = {},
  ) => ({
    order_no: 'ORD202610150001',
    product_id: null,
    product_type: 1,
    product_snapshot: { name: '积分充值', amount_fen: 700, credits: 88 },
    amount_fen: 700,
    credits: 88,
    channel: 'alipay',
    provider: 1,
    status: 0,
    pay_url: 'https://cashier.example.test/submit.php?out_trade_no=ORD202610150001',
    expire_at: new Date(Date.now() + 900_000).toISOString(),
    paid_at: null as string | null,
    closed_at: null as string | null,
    create_at: '2026-10-15T10:00:00Z',
    ...overrides,
  })
  const orders: ReturnType<typeof makeOrder>[] = []
  const response = (data: unknown, extra = {}) =>
    new Response(JSON.stringify({ code: 200, message: 'success', data, ...extra }), {
      headers: { 'Content-Type': 'application/json' },
    })
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'https://windup.test')
    const path = url.pathname.replace(/^\/api/, '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({
      path: path + url.search,
      method,
      body,
      authorization: new Headers(init?.headers).get('Authorization'),
    })
    if (path === '/bill/products')
      return response(products, { total: products.length, page: 1, page_size: 20 })
    if (path === '/bill/subscription') return response(subscription)
    if (path === '/bill/orders' && method === 'POST') {
      const product = products.find((item) => item.id === body?.product_id)
      const amount = product?.amount_fen ?? Number(body?.amount_fen)
      const order = makeOrder({
        order_no: `ORD20261015${String(orders.length + 1).padStart(4, '0')}`,
        product_id: product?.id ?? null,
        product_type: product?.type ?? 1,
        product_snapshot: {
          name: product?.name ?? '积分充值',
          tier: product?.tier,
          amount_fen: amount,
          credits: product?.credits ?? Math.ceil(amount / 8),
        },
        amount_fen: amount,
        credits: product?.credits ?? Math.ceil(amount / 8),
        channel: String(body?.channel),
      })
      orders.unshift(order)
      return response(order)
    }
    if (path === '/bill/orders') {
      const page = Number(url.searchParams.get('page') ?? 1)
      const size = Number(url.searchParams.get('page_size') ?? 5)
      return response(orders.slice((page - 1) * size, page * size), {
        total: orders.length,
        page,
        page_size: size,
      })
    }
    const match = path.match(/^\/bill\/orders\/([^/]+)(\/close)?$/)
    if (match) {
      const order = orders.find((item) => item.order_no === decodeURIComponent(match[1]))
      if (!order)
        return new Response(JSON.stringify({ code: 404, message: '订单不存在', data: null }))
      if (match[2] && method === 'POST') {
        order.status = 2
        order.closed_at = new Date().toISOString()
        return response(null)
      }
      return response(order)
    }
    throw new Error(`Unexpected billing request: ${method} ${path}`)
  }
  function pay(orderNo: string) {
    const order = orders.find((item) => item.order_no === orderNo)!
    order.status = 1
    order.paid_at = new Date().toISOString()
    if (order.product_type === 1) subscription.perpetual_credits += order.credits
    else {
      subscription.active_subscription = {
        tier: Number(order.product_snapshot.tier),
        status: 1,
        period_start: new Date().toISOString(),
        period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
      }
      subscription.expiring_credits += order.credits
    }
  }
  return { products, subscription, orders, calls, fetchFn, makeOrder, pay }
}
