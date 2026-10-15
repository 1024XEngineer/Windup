import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, SpinnerGap, X } from '@phosphor-icons/react'
import { BILL_ORDER_STATUS } from '@/entities'
import type { BillApis, BillOrder, PaymentChannel } from '@/entities'
import alipayLogo from '@/assets/payments/alipay.svg'
import wechatPayLogo from '@/assets/payments/wechat-pay.svg'
import { billingError, paymentUrl, useBillCheckout, usePaymentOrder } from '@/features/billing'
import { credits, money, moment, orderStatus } from './presentation'

export interface PurchaseSelection {
  name: string
  amountFen: number
  credits: number
  productId?: number
  kind: 'topup' | 'subscription'
}

interface CheckoutDialogProps {
  selection: PurchaseSelection | null
  orderNo: string | null
  apis: BillApis
  onClose(): void
  onCreated(order: BillOrder): void
  onPaid(): void
  onOrderChanged(): void
  navigateToPayment(url: string): void
}

export function CheckoutDialog({
  selection,
  orderNo,
  apis,
  onClose,
  onCreated,
  onPaid,
  onOrderChanged,
  navigateToPayment,
}: CheckoutDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [channel, setChannel] = useState<PaymentChannel>('alipay')
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [priceChanged, setPriceChanged] = useState(false)
  const checkout = useBillCheckout(apis)
  const payment = usePaymentOrder(orderNo, apis, onPaid)
  const order = payment.order
  const pending = order?.status === BILL_ORDER_STATUS.PENDING
  const busy = checkout.busy || payment.closing
  const url = order ? paymentUrl(order) : null
  const error =
    checkout.error ?? navigationError ?? (pending ? payment.closeError : null) ?? payment.error

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  function navigate(url: string) {
    try {
      navigateToPayment(url)
    } catch (cause) {
      setNavigationError(billingError(cause))
    }
  }

  async function submit() {
    if (!selection) return
    const created = await checkout.create({
      ...(selection.productId === undefined
        ? { amountFen: selection.amountFen }
        : { productId: selection.productId }),
      channel,
    })
    if (!created) return
    const changed =
      created.amountFen !== selection.amountFen || created.credits !== selection.credits
    setPriceChanged(changed)
    // 先保存订单号到当前路由，返回或刷新页面后仍可核对；价格变化时停下来展示真实订单。
    onCreated(created)
    const target = paymentUrl(created)
    if (target && !changed) navigate(target)
  }

  const title = selection
    ? selection.name
    : order?.status === BILL_ORDER_STATUS.PAID
      ? '支付成功'
      : order?.status === BILL_ORDER_STATUS.CLOSED
        ? '订单已关闭'
        : pending
          ? '等待支付'
          : order
            ? (orderStatus[order.status] ?? '订单状态待确认')
            : '查询订单'

  return (
    <dialog
      ref={dialog}
      aria-labelledby="checkout-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose()
      }}
      className="subscription-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      <button
        type="button"
        aria-label="关闭支付窗口"
        disabled={busy}
        onClick={onClose}
        className="subscription-dialog-close disabled:opacity-40"
      >
        <X aria-hidden="true" size={20} />
      </button>
      <h2 id="checkout-title">{title}</h2>
      {selection || order ? (
        <div className="subscription-dialog-total">
          {money(selection?.amountFen ?? order!.amountFen)}
          <span>{credits(selection?.credits ?? order!.credits)} 积分</span>
        </div>
      ) : (
        <p role="status">正在查询订单…</p>
      )}

      {selection ? (
        <>
          <fieldset disabled={busy} className="mb-6">
            <legend className="mb-3 text-sm font-medium">支付方式</legend>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { value: 'alipay', name: '支付宝', logo: alipayLogo },
                  { value: 'wxpay', name: '微信支付', logo: wechatPayLogo },
                ] as const
              ).map((item) => (
                <label
                  key={item.value}
                  className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded-app-control border px-4 text-sm transition-colors ${channel === item.value ? 'border-app-accent bg-app-accent-muted' : 'border-app-line hover:border-app-line-strong'}`}
                >
                  <input
                    type="radio"
                    name="payment-channel"
                    value={item.value}
                    checked={channel === item.value}
                    onChange={() => setChannel(item.value)}
                    className="accent-app-accent"
                  />
                  <img
                    src={item.logo}
                    alt=""
                    aria-hidden="true"
                    className="size-5 shrink-0 object-contain"
                  />
                  {item.name}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="mb-5 text-sm leading-6 text-app-muted">
            {selection.kind === 'subscription'
              ? '按月手动续购。续购接续当前账期，积分在对应账期开始时发放。'
              : '充值积分长期有效，不改变会员资格。'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="subscription-button primary"
          >
            {checkout.busy ? (
              <>
                <SpinnerGap
                  aria-hidden="true"
                  size={17}
                  className="animate-spin motion-reduce:animate-none"
                />
                正在创建订单…
              </>
            ) : (
              <>
                前往支付 <ArrowUpRight aria-hidden="true" size={17} />
              </>
            )}
          </button>
        </>
      ) : order ? (
        <>
          {pending ? (
            <>
              <p className="mb-5 text-sm leading-6 text-app-muted">
                {priceChanged
                  ? '价格或积分已更新，请核对订单后继续支付。'
                  : url
                    ? `请在 ${moment(order.expireAt)} 前完成付款，支付结果会自动更新。`
                    : Date.parse(order.expireAt) <= Date.now()
                      ? '此订单已超时，请刷新支付结果确认状态。'
                      : '暂时无法打开收银台，请联系管理员。'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={!url || busy}
                  onClick={() => {
                    const target = paymentUrl(order)
                    if (target) navigate(target)
                  }}
                  className="subscription-button primary"
                >
                  继续支付 <ArrowUpRight aria-hidden="true" size={16} />
                </button>
                <button
                  type="button"
                  disabled={busy || payment.status === 'loading'}
                  onClick={payment.reload}
                  className="subscription-button"
                >
                  {payment.status === 'loading' ? '正在确认…' : '刷新支付结果'}
                </button>
              </div>
              <button
                type="button"
                disabled={busy || payment.status === 'loading'}
                onClick={() => void payment.close().then(onOrderChanged)}
                className="mt-4 w-full py-2 text-sm text-app-muted underline-offset-4 hover:text-app-ink hover:underline disabled:opacity-50"
              >
                {payment.closing ? '正在关闭…' : '关闭订单'}
              </button>
            </>
          ) : (
            <>
              <p className="mb-5 text-sm leading-6 text-app-muted">
                {order.status === BILL_ORDER_STATUS.PAID
                  ? '支付已确认，可查看最新积分与订阅状态。'
                  : order.status === BILL_ORDER_STATUS.CLOSED
                    ? '此订单无法继续付款，可以重新选择套餐或充值金额。'
                    : '请以此处查询到的订单状态为准。'}
              </p>
              <button type="button" onClick={onClose} className="subscription-button primary">
                完成
              </button>
            </>
          )}
          <p className="mt-5 break-all text-xs text-app-faint">订单号 {order.orderNo}</p>
        </>
      ) : error ? (
        <button type="button" onClick={payment.reload} className="subscription-button">
          重新查询订单
        </button>
      ) : null}
      {error && (
        <div role="alert" className="mt-4 text-sm leading-6 text-app-danger">
          {error}
        </div>
      )}
    </dialog>
  )
}
