import { useCallback, useEffect, useRef, useState } from 'react'
import { BILL_ORDER_STATUS, billApis } from '@/entities'
import type { BillApis, BillOrder, CreateBillOrder } from '@/entities'

interface Resource<T> {
  data: T | null
  status: 'loading' | 'ready' | 'error'
  error: string | null
  reload(): void
}

export function billingError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '加载失败，请稍后重试'
}

/** 账单内的三个只读资源共用失效规则；切页、关闭或更换依赖后忽略旧请求。 */
function useBillResource<T>(read: () => Promise<T>, enabled = true): Resource<T> {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Omit<Resource<T>, 'reload'>>({
    data: null,
    status: 'loading',
    error: null,
  })
  useEffect(() => {
    if (!enabled) {
      setResult({ data: null, status: 'loading', error: null })
      return
    }
    let active = true
    setResult((current) => ({ ...current, status: 'loading', error: null }))
    void Promise.resolve()
      .then(read)
      .then(
        (data) => {
          if (active) setResult({ data, status: 'ready', error: null })
        },
        (error: unknown) => {
          if (active)
            setResult((current) => ({ ...current, status: 'error', error: billingError(error) }))
        },
      )
    return () => {
      active = false
    }
  }, [attempt, enabled, read])
  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return { ...result, reload }
}

export function useBillProducts(apis: BillApis = billApis) {
  return useBillResource(useCallback(() => apis.listProducts(), [apis]))
}

export function useSubscriptionStatus(enabled = true, apis: BillApis = billApis) {
  return useBillResource(
    useCallback(() => apis.getSubscription(), [apis]),
    enabled,
  )
}

export function useBillOrders(page: number, apis: BillApis = billApis) {
  return useBillResource(useCallback(() => apis.listOrders({ page, pageSize: 5 }), [apis, page]))
}

export function subscriptionName(tier: number | null | undefined): string {
  return tier == null
    ? 'Free'
    : (({ 1: 'Plus', 2: 'Pro', 3: 'Max' } as Record<number, string>)[tier] ?? '会员')
}

export function topUpQuote(amount: string): { amountFen: number; credits: number } | null {
  const amountFen = Number(amount) * 100
  // 自定义充值与后端采用同一粒度：>=500 分、整元、每 8 分向上取一积分。
  if (!/^\d+$/.test(amount) || !Number.isSafeInteger(amountFen) || amountFen < 500) return null
  return { amountFen, credits: Math.ceil(amountFen / 8) }
}

/** 只有服务端仍待支付的订单可继续付款；回跳参数不参与此判断。 */
export function paymentUrl(order: BillOrder): string | null {
  if (
    order.status !== BILL_ORDER_STATUS.PENDING ||
    Date.parse(order.expireAt) <= Date.now() ||
    !Number.isFinite(Date.parse(order.expireAt))
  )
    return null
  try {
    const url = new URL(order.payUrl ?? '')
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hostname === 'pay.example.com'
    )
      return null
    return url.href
  } catch {
    return null
  }
}

export function useBillCheckout(apis: BillApis) {
  const submitting = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const create = async (input: CreateBillOrder): Promise<BillOrder | null> => {
    if (submitting.current) return null
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const order = await apis.createOrder(input)
      return mounted.current ? order : null
    } catch (cause) {
      if (mounted.current) setError(billingError(cause))
      return null
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return { create, busy, error }
}

export function usePaymentOrder(orderNo: string | null, apis: BillApis, onPaid: () => void) {
  const read = useCallback(() => apis.getOrder(orderNo!), [apis, orderNo])
  const result = useBillResource(read, !!orderNo)
  const { reload, status } = result
  // 更换订单时旧 data 会保留到新请求结束；不能将旧订单误作当前订单展示或发货。
  const order = result.data?.orderNo === orderNo ? result.data : null
  const lastPaid = useRef<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const closingRef = useRef(false)

  useEffect(() => {
    if (order?.status === BILL_ORDER_STATUS.PAID && lastPaid.current !== order.orderNo) {
      lastPaid.current = order.orderNo
      onPaid()
    }
  }, [onPaid, order])

  useEffect(() => {
    if (!orderNo || order?.status !== BILL_ORDER_STATUS.PENDING || status !== 'ready') return
    // 每次查询结束才安排下一次；隐藏页面不轮询，回到页面立即核对，避免并发补偿查询。
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') reload()
    }, 5000)
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [orderNo, order?.status, status, reload])

  const close = async () => {
    if (!orderNo || closingRef.current) return
    closingRef.current = true
    setClosing(true)
    setCloseError(null)
    try {
      await apis.closeOrder(orderNo)
    } catch (cause) {
      setCloseError(billingError(cause))
    } finally {
      // 关单也可能发现已付款并补发货；无论成功或失败都重新读取，不能在本地直接置 CLOSED。
      reload()
      setClosing(false)
      closingRef.current = false
    }
  }
  return { ...result, order, closing, closeError, close }
}
