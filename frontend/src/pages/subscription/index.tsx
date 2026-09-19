import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowUpRight, Check, Plus, X } from '@phosphor-icons/react'
import './subscription.css'

const plans = [
  {
    name: 'Plus',
    price: 29,
    credits: 400,
    saving: '9.4%',
    unit: '0.0725',
  },
  {
    name: 'Pro',
    price: 99,
    credits: 1500,
    saving: '17.5%',
    unit: '0.0660',
  },
  {
    name: 'Max',
    price: 199,
    credits: 3200,
    saving: '22.3%',
    unit: '0.0622',
  },
]
const amounts = [5, 10, 20, 30, 40, 100]

export function SubscriptionPage() {
  const [params, setParams] = useSearchParams()
  const recharge = params.get('tab') === 'credits'
  const [amount, setAmount] = useState('20')
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [selection, setSelection] = useState<{
    name: string
    price: number
    credits: number
  } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const value = Number(amount)
  const valid = /^\d+$/.test(amount) && Number.isSafeInteger(value * 100) && value >= 5
  const credits = valid ? Math.ceil((value * 100) / 8) : 0
  function preview(item: { name: string; price: number; credits: number }) {
    setSelection(item)
    dialog.current?.showModal()
  }
  return (
    <main className="subscription-page">
      <header className="subscription-heading">
        <h1>订阅与充值</h1>
      </header>
      <div className="subscription-toolbar">
        <div className="subscription-tabs" aria-label="购买类型">
          <button aria-pressed={!recharge} onClick={() => setParams({})}>
            会员套餐
          </button>
          <button aria-pressed={recharge} onClick={() => setParams({ tab: 'credits' })}>
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
            <strong>
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
              <span>Free</span>
            </div>
            <button
              className="subscription-button primary"
              disabled={!valid}
              onClick={() => preview({ name: '积分充值', price: value, credits })}
            >
              充值积分 <ArrowUpRight size={17} />
            </button>
            <small>充值只增加积分，不改变会员资格。</small>
          </div>
        </section>
      ) : (
        <div className="subscription-plans">
          {plans.map((plan, index) => (
            <article
              key={plan.name}
              className={`subscription-plan ${index === 1 ? 'recommended' : ''} ${selectedPlan === plan.name ? 'selected' : ''}`}
              onClick={() => setSelectedPlan(plan.name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedPlan(plan.name)
                }
              }}
              role="button"
              tabIndex={0}
              aria-pressed={selectedPlan === plan.name}
            >
              <div className="subscription-plan-head">
                {index === 1 && <span className="subscription-recommended">最受欢迎</span>}
              </div>
              <h2>{plan.name}</h2>
              <div className="subscription-price">
                <span>¥</span>
                {plan.price}
                <small>/ 月</small>
              </div>
              <div className="subscription-creditline">
                <strong>{plan.credits.toLocaleString('zh-CN')}</strong>
                <span>积分</span>
                <em>省 {plan.saving}</em>
              </div>
              <button className="subscription-button" onClick={() => preview(plan)}>
                {selectedPlan === plan.name ? '已选择' : `选择 ${plan.name}`}
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
              <p className="subscription-unit">约 ¥{plan.unit} / 积分</p>
            </article>
          ))}
        </div>
      )}
      <section className="subscription-footnote">
        <div>
          <p className="subscription-current-plan">
            当前订阅方案：<strong>Free</strong>
          </p>
          <h3>Free 包含的功能</h3>
          <p>Free 同样支持标准制作、局部重做与透明素材导出；生成任务按实际报价消耗积分。</p>
        </div>
        <div>
          <h4>暂未开放的会员权益</h4>
          <p>
            更好的模型、高质量处理、三渲二暂未开放。会员期限、积分有效期与续购规则将在开售前说明。
          </p>
        </div>
      </section>
      <dialog
        ref={dialog}
        className="subscription-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close()
        }}
        aria-labelledby="purchase-title"
      >
        <button
          className="subscription-dialog-close"
          aria-label="关闭购买预览"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
        <h2 id="purchase-title">{selection?.name}</h2>
        <div className="subscription-dialog-total">
          ¥{selection?.price}
          <span>{selection?.credits.toLocaleString('zh-CN')} 积分</span>
        </div>
        <p>支付还没有接入，请联系管理员。当前不会扣款，也不会变更积分或会员资格。</p>
        <button className="subscription-button primary" onClick={() => dialog.current?.close()}>
          知道了
        </button>
      </dialog>
    </main>
  )
}
