import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowUpRight, Check, Plus } from '@phosphor-icons/react'
import { BILL_PRODUCT_TYPE, billApis } from '@/entities'
import type { BillApis, BillOrder } from '@/entities'
import {
  subscriptionName,
  topUpQuote,
  useBillOrders,
  useBillProducts,
  useSubscriptionStatus,
} from '@/features/billing'
import { CheckoutDialog } from './checkout-dialog'
import type { PurchaseSelection } from './checkout-dialog'
import { OrderHistory } from './order-history'
import { credits as formatCredits, moment } from './presentation'
import './subscription.css'

const amounts = [5, 10, 20, 30, 40, 100]

interface SubscriptionPageProps {
  apis?: BillApis
  navigateToPayment?: (url: string) => void
}

const navigateToCashier = (url: string) => window.location.assign(url)

export function SubscriptionPage({
  apis = billApis,
  navigateToPayment = navigateToCashier,
}: SubscriptionPageProps = {}) {
  const [params, setParams] = useSearchParams()
  const recharge = params.get('tab') === 'credits'
  const orderNo = params.get('order_no') || params.get('out_trade_no')
  const [amount, setAmount] = useState('20')
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null)
  const [selection, setSelection] = useState<PurchaseSelection | null>(null)
  const [page, setPage] = useState(1)
  const products = useBillProducts(apis)
  const subscription = useSubscriptionStatus(true, apis)
  const history = useBillOrders(page, apis)
  const reloadSubscription = subscription.reload
  const reloadHistory = history.reload
  const onPaid = useCallback(() => {
    reloadSubscription()
    reloadHistory()
  }, [reloadSubscription, reloadHistory])
  const plans = products.data?.filter((item) => item.type === BILL_PRODUCT_TYPE.SUBSCRIPTION) ?? []
  const current = subscription.data?.activeSubscription
  const next = subscription.data?.nextSubscription
  const currentPlan = subscription.data ? subscriptionName(current?.tier) : '—'
  const quote = topUpQuote(amount)
  const valid = quote !== null
  const value = Number(amount)
  const credits = quote?.credits ?? 0

  function changeTab(tab: 'plans' | 'credits') {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (tab === 'credits') next.set('tab', 'credits')
      else next.delete('tab')
      return next
    })
  }

  function showOrder(order: BillOrder) {
    // 订单号写回路由后才切换弹窗内容，避免下单结束与路由更新之间卸载弹窗。
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('out_trade_no')
        next.set('order_no', order.orderNo)
        return next
      },
      { replace: true },
    )
    reloadHistory()
  }

  function closeCheckout() {
    setSelection(null)
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const key of [
          'order_no',
          'out_trade_no',
          'trade_no',
          'trade_status',
          'sign',
          'sign_type',
          'money',
          'type',
          'pid',
          'name',
        ])
          next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  return (
    <main className="subscription-page">
      <header className="subscription-heading">
        <h1>订阅与充值</h1>
      </header>
      <div className="subscription-toolbar">
        <div className="subscription-tabs" aria-label="购买类型">
          <button aria-pressed={!recharge} onClick={() => changeTab('plans')}>
            会员套餐
          </button>
          <button aria-pressed={recharge} onClick={() => changeTab('credits')}>
            积分充值
          </button>
        </div>
      </div>
      {recharge ? (
        <section className="recharge-panel" aria-labelledby="recharge-title">
          <div className="recharge-options">
            <h2 id="recharge-title">积分充值</h2>
            <p className="subscription-intro">
              无需开通会员。每 ¥1 获得 12.5 积分，不足一积分向上补足。
            </p>
            <div className="recharge-amounts">
              {amounts.map((item) => (
                <button
                  key={item}
                  aria-pressed={amount === String(item)}
                  onClick={() => setAmount(String(item))}
                >
                  <strong>¥{item}</strong>
                  <span>{Math.ceil((item * 100) / 8).toLocaleString('zh-CN')} 积分</span>
                </button>
              ))}
            </div>
            <label className="recharge-custom">
              自定义金额 <span>最低 ¥5，按整元输入</span>
              <div>
                <span>¥</span>
                <input
                  aria-label="自定义充值金额"
                  inputMode="numeric"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  aria-invalid={!valid}
                />
              </div>
            </label>
            {!valid && (
              <p className="subscription-error" role="alert">
                请输入不低于 5 元的整数金额。
              </p>
            )}
          </div>
          <div className="recharge-summary">
            <p>本次将获得</p>
            <strong aria-label="本次到账积分">
              {valid ? credits.toLocaleString('zh-CN') : '—'}
              <span> 积分</span>
            </strong>
            <hr />
            <div>
              <span>充值金额</span>
              <b>{valid ? `¥${value}` : '—'}</b>
            </div>
            <div>
              <span>当前方案</span>
              <span>{currentPlan}</span>
            </div>
            <button
              className="subscription-button primary"
              disabled={!valid}
              onClick={() => {
                if (quote) setSelection({ name: '积分充值', ...quote, kind: 'topup' })
              }}
            >
              充值积分 <ArrowUpRight size={17} />
            </button>
            <small>充值只增加积分，不改变会员资格。</small>
          </div>
        </section>
      ) : products.error ? (
        <div className="py-6 text-center">
          <p role="alert" className="text-sm text-app-danger">
            {products.error}
          </p>
          <button
            type="button"
            onClick={products.reload}
            className="mt-3 text-sm underline underline-offset-4"
          >
            重新加载套餐
          </button>
        </div>
      ) : products.data === null ? (
        <p role="status" className="py-6 text-center text-sm text-app-muted">
          正在加载套餐…
        </p>
      ) : plans.length === 0 ? (
        <p className="py-6 text-center text-sm text-app-muted">暂无在售套餐</p>
      ) : (
        <div className="subscription-plans">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className={`subscription-plan ${plan.badge ? 'recommended' : ''} ${selectedPlan === plan.id ? 'selected' : ''}`}
              onClick={() => setSelectedPlan(plan.id)}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === 'Enter' || event.key === ' ')
                ) {
                  event.preventDefault()
                  setSelectedPlan(plan.id)
                }
              }}
              role="button"
              tabIndex={0}
              aria-pressed={selectedPlan === plan.id}
            >
              <div className="subscription-plan-head">
                {plan.badge && <span className="subscription-recommended">{plan.badge}</span>}
              </div>
              <h2>{plan.name}</h2>
              <div className="subscription-price">
                <span>¥</span>
                {plan.amountFen / 100}
                <small>/ 月</small>
              </div>
              <div className="subscription-creditline">
                <strong>{plan.credits.toLocaleString('zh-CN')}</strong>
                <span>积分</span>
                {plan.amountFen < plan.credits * 8 && (
                  <em>省 {((1 - plan.amountFen / (plan.credits * 8)) * 100).toFixed(1)}%</em>
                )}
              </div>
              <button
                className="subscription-button"
                onClick={() =>
                  setSelection({
                    name: plan.name,
                    amountFen: plan.amountFen,
                    credits: plan.credits,
                    productId: plan.id,
                    kind: 'subscription',
                  })
                }
              >
                {selectedPlan === plan.id ? '已选择' : `选择 ${plan.name}`}
                <ArrowUpRight size={17} />
              </button>
              <div className="subscription-plan-details">
                <p>
                  <Check size={16} />
                  完整标准制作流程
                </p>
                <p>
                  <Check size={16} />
                  保留已有资产与下载能力
                </p>
                <p>
                  <Plus size={16} />
                  会员专属能力<span>筹备中</span>
                </p>
              </div>
              <p className="subscription-unit">
                约 ¥{plan.credits > 0 ? (plan.amountFen / 100 / plan.credits).toFixed(4) : '—'} /
                积分
              </p>
            </article>
          ))}
        </div>
      )}
      <section className="subscription-footnote">
        <div>
          <p className="subscription-current-plan">
            当前订阅方案：<strong aria-label="当前方案">{currentPlan}</strong>
          </p>
          {subscription.data && (
            <>
              <p>
                长期积分{' '}
                <span aria-label="长期积分">
                  {formatCredits(subscription.data.perpetualCredits)}
                </span>{' '}
                · 本期积分{' '}
                <span aria-label="本期积分">
                  {formatCredits(subscription.data.expiringCredits)}
                </span>
              </p>
              {current && (
                <p>
                  当前账期：{moment(current.periodStart)} 至 {moment(current.periodEnd)}
                </p>
              )}
              {next && (
                <p>
                  已续购 {subscriptionName(next.tier)}：{moment(next.periodStart)} 至{' '}
                  {moment(next.periodEnd)}
                </p>
              )}
            </>
          )}
          {subscription.error && (
            <div className="mt-2 text-sm text-app-danger">
              <span role="alert">{subscription.error}</span>
              <button
                type="button"
                onClick={subscription.reload}
                className="ml-3 underline underline-offset-4"
              >
                重新加载订阅
              </button>
            </div>
          )}
          <h3>Free 包含的功能</h3>
          <p>Free 同样支持标准制作、局部重做与透明素材导出；生成任务按实际报价消耗积分。</p>
        </div>
        <div>
          <h4>暂未开放的会员权益</h4>
          <p>
            更好的模型、高质量处理、三渲二暂未开放。订阅按月手动续购，本期积分到期失效；充值积分长期有效。
          </p>
        </div>
      </section>
      <details className="mt-7 border-t border-app-line pt-5 text-sm text-app-muted">
        <summary className="cursor-pointer">订单记录</summary>
        <OrderHistory resource={history} onSelect={showOrder} onPageChange={setPage} />
      </details>
      {(selection || orderNo) && (
        <CheckoutDialog
          selection={orderNo ? null : selection}
          orderNo={orderNo}
          apis={apis}
          onClose={closeCheckout}
          onCreated={showOrder}
          onPaid={onPaid}
          onOrderChanged={reloadHistory}
          navigateToPayment={navigateToPayment}
        />
      )}
    </main>
  )
}
