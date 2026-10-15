// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBillApis } from '@/entities'
import { createBillBackend } from '@/test/bill-backend'
import { usePaymentOrder } from './index'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('待支付时查询，确认支付后停止轮询且只通知一次', async () => {
  vi.useFakeTimers()
  const backend = createBillBackend()
  backend.orders.push(backend.makeOrder())
  const apis = createBillApis({ baseUrl: '/api', fetchFn: backend.fetchFn })
  const onPaid = vi.fn()
  const { result, unmount } = renderHook(() => usePaymentOrder('ORD202610150001', apis, onPaid))
  await act(async () => {})
  expect(result.current.order?.status).toBe(0)
  const detailRequests = () =>
    backend.calls.filter((call) => call.path === '/bill/orders/ORD202610150001').length
  expect(detailRequests()).toBe(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(detailRequests()).toBe(2)
  backend.pay('ORD202610150001')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(result.current.order?.status).toBe(1)
  expect(onPaid).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000)
  })
  expect(detailRequests()).toBe(3)
  unmount()
})

it('快速切换订单后，迟到的旧订单不能覆盖当前订单或触发成功通知', async () => {
  const backend = createBillBackend()
  backend.orders.push(
    backend.makeOrder({ order_no: 'ORDER_A', status: 1 }),
    backend.makeOrder({ order_no: 'ORDER_B' }),
  )
  const releases: Record<string, () => void> = {}
  const fetchFn: typeof fetch = async (input, init) => {
    const id = String(input).split('/').at(-1)!
    await new Promise<void>((resolve) => {
      releases[id] = resolve
    })
    return backend.fetchFn(input, init)
  }
  const apis = createBillApis({ baseUrl: '/api', fetchFn })
  const onPaid = vi.fn()
  const { result, rerender } = renderHook(({ id }) => usePaymentOrder(id, apis, onPaid), {
    initialProps: { id: 'ORDER_A' },
  })
  await act(async () => {})
  rerender({ id: 'ORDER_B' })
  await act(async () => {})
  await act(async () => releases.ORDER_B())
  expect(result.current.order?.orderNo).toBe('ORDER_B')
  await act(async () => releases.ORDER_A())
  expect(result.current.order?.orderNo).toBe('ORDER_B')
  expect(onPaid).not.toHaveBeenCalled()
})

it('关单时后端发现已经付款，前端采用 PAID 而非自行标记 CLOSED', async () => {
  const backend = createBillBackend()
  backend.orders.push(backend.makeOrder())
  const fetchFn: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/close')) {
      backend.pay('ORD202610150001')
      return new Response(JSON.stringify({ code: 200, message: 'success', data: null }))
    }
    return backend.fetchFn(input, init)
  }
  const apis = createBillApis({ baseUrl: '/api', fetchFn })
  const onPaid = vi.fn()
  const { result } = renderHook(() => usePaymentOrder('ORD202610150001', apis, onPaid))
  await act(async () => {})
  await act(async () => result.current.close())
  expect(result.current.order?.status).toBe(1)
  expect(onPaid).toHaveBeenCalledTimes(1)
})
