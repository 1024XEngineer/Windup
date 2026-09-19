import {
  CheckCircle,
  ClockCounterClockwise,
  Copy,
  DownloadSimple,
  MagnifyingGlass,
  ShieldCheck,
  Ticket,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'

import { adminRedemptionApis } from '@/entities'
import type {
  AdminRedemptionApis,
  CodeValidation,
  GeneratedCodes,
  RedemptionCodeStatus,
} from '@/entities'
import { ApiError } from '@/shared/api'

interface AdminRedemptionCodesPageProps {
  apis?: AdminRedemptionApis
}

type AccessState =
  | { kind: 'loading' }
  | { kind: 'allowed' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }

const fieldClass =
  'mt-2 min-h-11 w-full rounded-xl border border-app-line bg-app-surface px-3.5 py-2.5 text-sm text-app-ink outline-none transition focus:border-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60'
const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-app-ink px-5 text-sm font-semibold text-app-surface-raised transition-colors hover:bg-app-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-app-line bg-app-surface-raised px-3.5 text-sm font-semibold text-app-ink-soft transition-colors hover:border-app-line-strong hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-50'

const validationCopy: Record<
  RedemptionCodeStatus,
  { label: string; description: string; tone: string }
> = {
  valid: {
    label: '当前有效',
    description: '兑换码尚未使用，可以正常兑换。',
    tone: 'border-app-line-strong bg-app-accent-muted text-app-accent',
  },
  redeemed: {
    label: '已兑换',
    description: '兑换码已被使用，不能再次兑换。',
    tone: 'border-app-line-strong bg-app-surface-muted text-app-ink-soft',
  },
  expired: {
    label: '已过期',
    description: '兑换码已超过有效期，不能再使用。',
    tone: 'border-app-warning-line bg-app-warning-soft text-app-warning',
  },
  not_found: {
    label: '未找到',
    description: '格式正确，但系统中没有这个兑换码。',
    tone: 'border-app-danger/30 bg-app-danger/10 text-app-danger',
  },
  invalid_format: {
    label: '格式无效',
    description: '请输入完整的 Windup 积分兑换码。',
    tone: 'border-app-danger/30 bg-app-danger/10 text-app-danger',
  },
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return '操作失败，请稍后重试'
}

function formatMoment(value: string | null): string {
  if (!value) return '未设置'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function AccessStateView({
  state,
  onRetry,
}: {
  state: Exclude<AccessState, { kind: 'allowed' }>
  onRetry: () => void
}) {
  if (state.kind === 'loading') {
    return (
      <main
        aria-label="正在验证管理员权限"
        className="grid min-h-[100dvh] place-items-center bg-app-canvas px-5 pt-16 text-app-ink"
      >
        <div className="text-center">
          <ShieldCheck aria-hidden="true" className="mx-auto text-app-muted" size={32} />
          <p className="mt-3 text-sm text-app-muted">正在验证管理员权限…</p>
        </div>
      </main>
    )
  }

  const forbidden = state.kind === 'forbidden'
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-app-canvas px-5 pt-16 text-app-ink">
      <section className="w-full max-w-lg rounded-[1.5rem] border border-app-line bg-app-surface-raised p-7 text-center shadow-app-panel sm:p-9">
        <WarningCircle aria-hidden="true" className="mx-auto text-app-muted" size={36} />
        <h1 className="mt-5 font-serif text-3xl font-medium tracking-[-0.04em]">
          {forbidden ? '无权访问' : '暂时无法验证权限'}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-app-muted">
          {forbidden ? '当前账号不在管理员白名单中。' : state.message}
        </p>
        {!forbidden ? (
          <button type="button" onClick={onRetry} className={`${secondaryButtonClass} mt-6`}>
            重新验证
          </button>
        ) : null}
      </section>
    </main>
  )
}

function GeneratedResult({
  result,
  feedback,
  onCopy,
  onDownload,
  onClear,
}: {
  result: GeneratedCodes
  feedback: string | null
  onCopy: () => void
  onDownload: () => void
  onClear: () => void
}) {
  return (
    <section
      aria-labelledby="generated-codes-title"
      className="mt-6 overflow-hidden rounded-2xl border border-app-accent/25 bg-app-accent-soft"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-app-accent/15 px-4 py-4 sm:px-5">
        <div>
          <h3 id="generated-codes-title" className="font-semibold text-app-ink">
            本次生成结果
          </h3>
          <p className="mt-1 text-xs leading-5 text-app-muted">
            明文只展示一次。离开或刷新页面后无法恢复，请立即复制或下载。
          </p>
        </div>
        <span className="rounded-full bg-app-surface-raised px-3 py-1 font-mono text-xs text-app-ink-soft">
          {result.count} 个 · 每个 {result.amount.toLocaleString('zh-CN')} 积分
        </span>
      </div>
      <ol className="max-h-72 divide-y divide-app-accent/10 overflow-y-auto bg-app-surface-raised/55">
        {result.codes.map((code, index) => (
          <li key={code} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span className="w-5 shrink-0 text-right font-mono text-xs text-app-faint">
              {index + 1}
            </span>
            <code className="min-w-0 flex-1 select-all overflow-x-auto font-mono text-sm tracking-[0.08em] text-app-ink">
              {code}
            </code>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-app-accent/15 px-4 py-4 sm:px-5">
        <button type="button" onClick={onCopy} className={secondaryButtonClass}>
          <Copy size={17} aria-hidden="true" />
          全部复制
        </button>
        <button type="button" onClick={onDownload} className={secondaryButtonClass}>
          <DownloadSimple size={17} aria-hidden="true" />
          下载 TXT
        </button>
        <button type="button" onClick={onClear} className={secondaryButtonClass}>
          <Trash size={17} aria-hidden="true" />
          清空结果
        </button>
        {feedback ? (
          <p role="status" aria-live="polite" className="ml-auto text-xs text-app-muted">
            {feedback}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function ValidationResult({ result }: { result: CodeValidation }) {
  const copy = validationCopy[result.status]
  const valid = result.status === 'valid'
  return (
    <section aria-live="polite" className={`mt-6 rounded-2xl border p-5 ${copy.tone}`}>
      <div className="flex items-start gap-3">
        {valid ? (
          <CheckCircle size={24} weight="fill" aria-hidden="true" />
        ) : (
          <ClockCounterClockwise size={24} aria-hidden="true" />
        )}
        <div className="min-w-0">
          <h3 className="font-semibold">{copy.label}</h3>
          <p className="mt-1 text-sm leading-6 text-current/80">{copy.description}</p>
        </div>
      </div>
      {result.amount !== null ? (
        <dl className="mt-5 grid gap-3 border-t border-current/15 pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-current/65">积分额度</dt>
            <dd className="mt-1 font-mono font-semibold">
              {result.amount.toLocaleString('zh-CN')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-current/65">有效期</dt>
            <dd className="mt-1">{formatMoment(result.expiresAt)}</dd>
          </div>
          {result.redeemedAt ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-current/65">兑换时间</dt>
              <dd className="mt-1">{formatMoment(result.redeemedAt)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  )
}

export function AdminRedemptionCodesPage({
  apis = adminRedemptionApis,
}: AdminRedemptionCodesPageProps) {
  const [access, setAccess] = useState<AccessState>({ kind: 'loading' })
  const [count, setCount] = useState('10')
  const [amount, setAmount] = useState('1000')
  const [expiresAt, setExpiresAt] = useState('')
  const [generated, setGenerated] = useState<GeneratedCodes | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generationFeedback, setGenerationFeedback] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [validation, setValidation] = useState<CodeValidation | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const countId = useId()
  const amountId = useId()
  const expiryId = useId()
  const codeId = useId()

  function verifyAccess() {
    setAccess({ kind: 'loading' })
    void apis.checkAccess().then(
      () => setAccess({ kind: 'allowed' }),
      (error) => {
        if (error instanceof ApiError && error.code === 403) {
          setAccess({ kind: 'forbidden' })
          return
        }
        setAccess({ kind: 'error', message: errorMessage(error) })
      },
    )
  }

  useEffect(verifyAccess, [apis])

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedCount = Number(count)
    const parsedAmount = Number(amount)
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 100) {
      setGenerationError('生成数量需为 1–100 的整数')
      return
    }
    if (!Number.isInteger(parsedAmount) || parsedAmount < 1 || parsedAmount > 1_000_000) {
      setGenerationError('单码积分需为 1–1,000,000 的整数')
      return
    }
    let expiryIso: string | null = null
    if (expiresAt) {
      const expiry = new Date(expiresAt)
      if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        setGenerationError('有效期必须晚于当前时间')
        return
      }
      expiryIso = expiry.toISOString()
    }

    setGenerating(true)
    setGenerationError(null)
    setGenerationFeedback(null)
    setGenerated(null)
    try {
      setGenerated(
        await apis.generateCodes({
          count: parsedCount,
          amount: parsedAmount,
          expiresAt: expiryIso,
        }),
      )
    } catch (error) {
      setGenerationError(errorMessage(error))
    } finally {
      setGenerating(false)
    }
  }

  async function copyGeneratedCodes() {
    if (!generated) return
    try {
      await navigator.clipboard.writeText(generated.codes.join('\n'))
      setGenerationFeedback('兑换码已复制')
    } catch {
      setGenerationFeedback('复制失败，请重试')
    }
  }

  function downloadGeneratedCodes() {
    if (!generated) return
    const blob = new Blob([`${generated.codes.join('\n')}\n`], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `windup-redemption-codes-${new Date().toISOString().slice(0, 10)}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
    setGenerationFeedback('TXT 已下载')
  }

  async function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!code.trim()) {
      setValidationError('请输入兑换码')
      return
    }
    setValidating(true)
    setValidation(null)
    setValidationError(null)
    try {
      setValidation(await apis.validateCode(code.trim()))
    } catch (error) {
      setValidationError(errorMessage(error))
    } finally {
      setValidating(false)
    }
  }

  if (access.kind !== 'allowed') {
    return <AccessStateView state={access} onRetry={verifyAccess} />
  }

  return (
    <main
      data-admin-redemption-page
      className="min-h-[100dvh] bg-app-canvas px-5 pb-20 pt-24 text-app-ink sm:px-8 sm:pt-28 lg:px-12"
    >
      <div className="mx-auto w-full max-w-[82rem]">
        <header className="border-b border-app-line pb-8">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-app-muted uppercase">
            <ShieldCheck size={16} aria-hidden="true" />
            管理工具
          </div>
          <h1 className="mt-4 font-serif text-[clamp(2.5rem,6vw,4.75rem)] leading-none font-medium tracking-[-0.055em] text-app-ink">
            积分兑换券
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-app-muted sm:text-base">
            批量签发一次性积分码，并在不消耗兑换码的前提下核验当前状态。
          </p>
        </header>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(22rem,0.88fr)]">
          <section className="rounded-[1.5rem] border border-app-line bg-app-surface-raised p-5 shadow-app-panel sm:p-7">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-app-accent-soft text-app-accent">
                <Ticket size={22} aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">
                  生成兑换码
                </h2>
                <p className="mt-1 text-sm leading-6 text-app-muted">
                  每个兑换码只能使用一次，额度和有效期按本批次统一设置。
                </p>
              </div>
            </div>

            <form onSubmit={generate} className="mt-7">
              <div className="grid gap-5 sm:grid-cols-2">
                <label htmlFor={countId} className="text-sm font-medium text-app-ink-soft">
                  生成数量
                  <input
                    id={countId}
                    aria-label="生成数量"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={count}
                    disabled={generating}
                    onChange={(event) => setCount(event.target.value)}
                    className={fieldClass}
                  />
                  <span className="mt-1.5 block text-xs font-normal text-app-faint">1–100 个</span>
                </label>
                <label htmlFor={amountId} className="text-sm font-medium text-app-ink-soft">
                  单码积分
                  <input
                    id={amountId}
                    aria-label="单码积分"
                    type="number"
                    min={1}
                    max={1_000_000}
                    step={1}
                    value={amount}
                    disabled={generating}
                    onChange={(event) => setAmount(event.target.value)}
                    className={fieldClass}
                  />
                  <span className="mt-1.5 block text-xs font-normal text-app-faint">
                    1–1,000,000 积分
                  </span>
                </label>
              </div>
              <label
                htmlFor={expiryId}
                className="mt-5 block text-sm font-medium text-app-ink-soft"
              >
                有效期
                <input
                  id={expiryId}
                  aria-label="有效期"
                  type="datetime-local"
                  value={expiresAt}
                  disabled={generating}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className={fieldClass}
                />
                <span className="mt-1.5 block text-xs font-normal text-app-faint">
                  可不填写；未设置时长期有效，直至被兑换。
                </span>
              </label>
              {generationError ? (
                <p role="alert" className="mt-4 text-sm text-app-danger">
                  {generationError}
                </p>
              ) : null}
              <button type="submit" disabled={generating} className={`${primaryButtonClass} mt-6`}>
                <Ticket size={18} aria-hidden="true" />
                {generating ? '正在生成…' : '生成兑换码'}
              </button>
            </form>

            {generated ? (
              <GeneratedResult
                result={generated}
                feedback={generationFeedback}
                onCopy={() => void copyGeneratedCodes()}
                onDownload={downloadGeneratedCodes}
                onClear={() => {
                  setGenerated(null)
                  setGenerationFeedback(null)
                }}
              />
            ) : null}
          </section>

          <section className="rounded-[1.5rem] border border-app-line bg-app-surface-raised p-5 shadow-app-panel sm:p-7">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-app-surface-muted text-app-ink-soft">
                <MagnifyingGlass size={22} aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">
                  核验兑换码
                </h2>
                <p className="mt-1 text-sm leading-6 text-app-muted">
                  只读取状态，不会兑换、占用或改变积分。
                </p>
              </div>
            </div>

            <form onSubmit={validate} className="mt-7">
              <label htmlFor={codeId} className="text-sm font-medium text-app-ink-soft">
                待核验兑换码
                <input
                  id={codeId}
                  aria-label="待核验兑换码"
                  type="text"
                  value={code}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={validating}
                  placeholder="WU-XXXX-XXXX-XXXX"
                  onChange={(event) => setCode(event.target.value)}
                  className={`${fieldClass} font-mono tracking-[0.06em]`}
                />
              </label>
              {validationError ? (
                <p role="alert" className="mt-4 text-sm text-app-danger">
                  {validationError}
                </p>
              ) : null}
              <button type="submit" disabled={validating} className={`${primaryButtonClass} mt-6`}>
                <MagnifyingGlass size={18} aria-hidden="true" />
                {validating ? '正在核验…' : '核验兑换码'}
              </button>
            </form>

            {validation ? <ValidationResult result={validation} /> : null}
          </section>
        </div>
      </div>
    </main>
  )
}
