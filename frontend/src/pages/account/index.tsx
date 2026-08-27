import { Gift, X } from '@phosphor-icons/react'
import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { useSearchParams } from 'react-router'

import accountBadgeArtwork from '@/assets/account/illustrations/account-badge.webp'
import { quotaApis, type CreditRedemptionResult, type User } from '@/entities'
import { useAuthSession } from '@/features/auth-session'
import {
  CREDIT_REASON_OPTIONS,
  formatCreditDateTime,
  getCreditReasonLabel,
  useQuotaBalance,
  useQuotaTransactions,
} from '@/features/quota'
import { Pagination } from '@/shared/ui'
import { InviteSection } from '@/pages/invite'

import './account.css'
import { createProfileState, initialSecurityState, profileReducer, securityReducer } from './state'

const MAX_NICKNAME_LENGTH = 50
const SECURITY_CODE_COOLDOWN_MS = 60_000

type AccountSection = 'profile' | 'security' | 'quota' | 'invite'

function accountSection(value: string | null): AccountSection {
  return value === 'security' || value === 'quota' || value === 'invite' ? value : 'profile'
}

function localDateStart(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function dayAfter(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

function formatVerificationTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '验证时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatCredits(value: number): string {
  return value.toLocaleString('zh-CN')
}

function CreditRedemptionDialog({
  onClose,
  onRedeemed,
  returnFocusRef,
}: {
  onClose: () => void
  onRedeemed: (result: CreditRedemptionResult) => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const codeId = useId()
  const errorId = useId()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreditRedemptionResult | null>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const returnFocusTarget = returnFocusRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (returnFocusTarget) returnFocusTarget.focus()
      else if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [returnFocusRef])

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      if (!submitting) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const normalizedCode = code.trim()
    if (!normalizedCode) {
      setError('请输入兑换码')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const nextResult = await quotaApis.redeemCode(normalizedCode)
      setResult(nextResult)
      onRedeemed(nextResult)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto overscroll-contain bg-app-ink/20 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose()
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-md rounded-2xl border border-app-line bg-app-surface-raised p-5 shadow-2xl outline-none sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id={titleId} className="text-lg font-semibold tracking-[-0.02em] text-app-ink">
              兑换积分
            </h3>
            <p id={descriptionId} className="mt-1.5 text-sm leading-6 text-app-muted">
              输入兑换码，验证成功后积分会立即到账。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭兑换积分"
            disabled={submitting}
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-app-muted transition-colors hover:bg-app-surface-muted hover:text-app-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {result ? (
          <div className="mt-6">
            <p className="text-xs font-medium tracking-[0.08em] text-app-muted">兑换成功</p>
            <p className="mt-2 font-mono text-4xl font-semibold tracking-[-0.04em] text-app-accent">
              +{formatCredits(result.credited)}
            </p>
            <p role="status" aria-live="polite" className="mt-2 text-sm text-app-muted">
              当前可用积分 {formatCredits(result.account.balance)}
            </p>
            <button type="button" onClick={onClose} className="account-primary-button mt-6 w-full">
              完成
            </button>
          </div>
        ) : (
          <form onSubmit={redeem} className="mt-6">
            <label htmlFor={codeId} className="text-sm font-medium text-app-ink-soft">
              兑换码
            </label>
            <input
              id={codeId}
              name="credit-redemption-code"
              type="text"
              value={code}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : descriptionId}
              disabled={submitting}
              onChange={(event) => {
                setCode(event.target.value)
                if (error) setError(null)
              }}
              placeholder="WU-XXXX-XXXX-XXXX"
              className="account-field mt-2 font-mono tracking-[0.06em]"
            />
            <div className="mt-2 min-h-5">
              {error && (
                <p id={errorId} role="alert" className="text-sm text-app-danger">
                  {error}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={submitting || !code.trim()}
              className="account-primary-button mt-4 w-full"
            >
              {submitting ? '正在兑换…' : '确认兑换'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}

function QuotaSection() {
  const balance = useQuotaBalance(true)
  const transactions = useQuotaTransactions(true)
  const [direction, setDirection] = useState('')
  const [reason, setReason] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pageSize, setPageSize] = useState('20')
  const [filterError, setFilterError] = useState<string | null>(null)
  const [redemptionOpen, setRedemptionOpen] = useState(false)
  const redemptionTriggerRef = useRef<HTMLButtonElement>(null)
  const account = balance.status === 'ready' ? balance.account : null
  const summaryRows: Array<[string, string]> = [
    ['可用积分', account ? formatCredits(account.balance) : '—'],
    ['冻结积分', account ? formatCredits(account.frozen) : '—'],
    ['累计获得', account ? formatCredits(account.totalEarned) : '—'],
    ['累计使用', account ? formatCredits(account.totalSpent) : '—'],
  ]

  function applyTransactionFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const createdFrom = startDate ? localDateStart(startDate) : null
    const end = endDate ? localDateStart(endDate) : null
    if (createdFrom && end && createdFrom > end) {
      setFilterError('开始日期不能晚于结束日期')
      return
    }
    setFilterError(null)
    transactions.applyFilters(
      {
        ...(direction ? { direction: direction as 'income' | 'expense' } : {}),
        ...(reason ? { reason: Number(reason) } : {}),
        ...(createdFrom ? { createdFrom: createdFrom.toISOString() } : {}),
        ...(end ? { createdBefore: dayAfter(end).toISOString() } : {}),
      },
      Number(pageSize),
    )
  }

  function resetTransactionFilters() {
    setDirection('')
    setReason('')
    setStartDate('')
    setEndDate('')
    setPageSize('20')
    setFilterError(null)
    transactions.applyFilters({}, 20)
  }

  return (
    <div>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">积分账户</h2>
          <p className="mt-1.5 text-sm text-app-muted">查看当前余额与最近的积分变动记录。</p>
        </div>
        <button
          ref={redemptionTriggerRef}
          type="button"
          aria-label="填写积分兑换码"
          title="填写积分兑换码"
          onClick={() => setRedemptionOpen(true)}
          className="grid size-11 shrink-0 place-items-center rounded-lg text-app-muted transition-colors hover:bg-app-surface-muted hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
        >
          <Gift size={19} weight="regular" aria-hidden="true" />
        </button>
      </header>

      {redemptionOpen && (
        <CreditRedemptionDialog
          onClose={() => setRedemptionOpen(false)}
          returnFocusRef={redemptionTriggerRef}
          onRedeemed={() => {
            balance.reload()
            transactions.reload()
          }}
        />
      )}

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryRows.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-app-line bg-app-surface-muted px-4 py-3"
          >
            <dt className="text-xs text-app-faint">{label}</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-app-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {balance.status === 'loading' && (
        <p role="status" className="mt-3 text-sm text-app-muted">
          正在加载积分余额…
        </p>
      )}
      {balance.status === 'error' && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-app-danger-soft px-3 py-2.5 text-sm text-app-danger">
          <p role="alert">{balance.error}</p>
          <button type="button" onClick={balance.reload} className="font-semibold underline">
            重新加载
          </button>
        </div>
      )}

      <section className="mt-7" aria-labelledby="credit-transactions-title">
        <div className="flex items-center justify-between gap-4">
          <h3 id="credit-transactions-title" className="text-sm font-semibold text-app-ink-soft">
            积分流水
          </h3>
          {transactions.status === 'ready' && (
            <span className="text-xs text-app-faint">共 {transactions.total} 条</span>
          )}
        </div>

        <form
          aria-label="积分流水筛选"
          onSubmit={applyTransactionFilters}
          className="mt-3 grid gap-3 border-y border-app-line py-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_7rem_auto] xl:items-end"
        >
          <label className="grid gap-1 text-xs text-app-muted">
            变动方向
            <select
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              className="account-filter-field"
            >
              <option value="">全部</option>
              <option value="income">积分获得</option>
              <option value="expense">积分支出</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-app-muted">
            变动原因
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="account-filter-field"
            >
              <option value="">全部原因</option>
              {CREDIT_REASON_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-app-muted">
            开始日期
            <input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(event) => setStartDate(event.target.value)}
              className="account-filter-field"
            />
          </label>
          <label className="grid gap-1 text-xs text-app-muted">
            结束日期
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => setEndDate(event.target.value)}
              className="account-filter-field"
            />
          </label>
          <label className="grid gap-1 text-xs text-app-muted">
            每页条数
            <select
              value={pageSize}
              onChange={(event) => setPageSize(event.target.value)}
              className="account-filter-field"
            >
              <option value="10">10 条</option>
              <option value="20">20 条</option>
              <option value="50">50 条</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button type="submit" className="account-filter-button">
              应用筛选
            </button>
            <button
              type="button"
              onClick={resetTransactionFilters}
              className="account-filter-reset"
            >
              重置
            </button>
          </div>
          {filterError && (
            <p role="alert" className="text-xs text-app-danger sm:col-span-2 xl:col-span-full">
              {filterError}
            </p>
          )}
        </form>

        {transactions.status === 'loading' ? (
          <p role="status" className="mt-3 text-sm text-app-muted">
            正在加载积分流水…
          </p>
        ) : transactions.status === 'error' ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-app-danger-soft px-3 py-2.5 text-sm text-app-danger">
            <p role="alert">{transactions.error}</p>
            <button type="button" onClick={transactions.reload} className="font-semibold underline">
              重新加载
            </button>
          </div>
        ) : transactions.status === 'ready' && transactions.transactions.length === 0 ? (
          <p className="mt-3 text-sm text-app-muted">还没有积分流水。</p>
        ) : transactions.status === 'ready' ? (
          <ul className="mt-3 divide-y divide-app-line overflow-hidden rounded-xl border border-app-line bg-app-surface-muted">
            {transactions.transactions.map((transaction) => (
              <li key={transaction.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-app-ink-soft">
                    {getCreditReasonLabel(transaction.reason)}
                  </p>
                  <p className="mt-0.5 text-xs text-app-faint">
                    {formatCreditDateTime(transaction.createdAt)} · 余额{' '}
                    {formatCredits(transaction.balanceAfter)}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-mono text-sm font-semibold ${
                    transaction.delta >= 0 ? 'text-app-accent' : 'text-app-danger'
                  }`}
                >
                  {transaction.delta > 0 ? '+' : ''}
                  {formatCredits(transaction.delta)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <Pagination
          page={transactions.page}
          pageSize={transactions.pageSize}
          total={transactions.total}
          disabled={transactions.status === 'loading'}
          showPageNumbers
          onPageChange={transactions.loadPage}
        />
      </section>
    </div>
  )
}

/** 账号页以 /auth/me 为事实来源；会话层负责把刷新和编辑结果同步给 Header。 */
export function AccountPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSection = searchParams.get('section')
  const session = useAuthSession()
  const {
    changePasswordWithCode,
    logout,
    refreshCurrentUser,
    sendPasswordChangeCode,
    updateNickname,
  } = session
  const currentUser = session.state.status === 'authenticated' ? session.state.user : null
  const profileRequestRef = useRef<Promise<User> | null>(null)
  const [profile, dispatchProfile] = useReducer(
    profileReducer,
    currentUser?.nickname ?? '',
    createProfileState,
  )
  const [security, dispatchSecurity] = useReducer(securityReducer, initialSecurityState)
  const [activeSection, setActiveSection] = useState<AccountSection>(() =>
    accountSection(requestedSection),
  )
  const [securityNow, setSecurityNow] = useState(() => Date.now())
  const nicknameId = useId()
  const securityCodeId = useId()
  const newPasswordId = useId()
  const confirmPasswordId = useId()

  useEffect(() => {
    let active = true
    profileRequestRef.current ??= refreshCurrentUser()
    void profileRequestRef.current.then(
      (user) => {
        if (!active) return
        dispatchProfile({ type: 'refreshSucceeded', nickname: user.nickname ?? '' })
      },
      (error) => {
        if (!active) return
        dispatchProfile({ type: 'refreshFailed', error: errorMessage(error) })
      },
    )
    return () => {
      active = false
    }
  }, [refreshCurrentUser])

  useEffect(() => {
    const section = accountSection(requestedSection)
    setActiveSection(section)
    dispatchProfile({ type: 'sectionChanged' })
    dispatchSecurity({ type: 'sectionChanged' })
  }, [requestedSection])

  useEffect(() => {
    const cooldownUntil = security.cooldownUntil
    const remaining = cooldownUntil === null ? 0 : cooldownUntil - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setSecurityNow(Date.now()), Math.min(1_000, remaining))
    return () => window.clearTimeout(timer)
  }, [security.cooldownUntil, securityNow])

  async function saveNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (profile.isSaving) return
    const normalizedNickname = profile.nickname.trim()
    if (!normalizedNickname) {
      dispatchProfile({ type: 'validationFailed', error: '昵称不能为空' })
      return
    }
    if (normalizedNickname.length > MAX_NICKNAME_LENGTH) {
      dispatchProfile({ type: 'validationFailed', error: '昵称不能超过 50 个字符' })
      return
    }

    dispatchProfile({ type: 'saveStarted' })
    try {
      const user = await updateNickname(normalizedNickname)
      dispatchProfile({ type: 'saveSucceeded', nickname: user.nickname ?? '' })
    } catch (error) {
      dispatchProfile({ type: 'saveFailed', error: errorMessage(error) })
    }
  }

  async function sendSecurityCode() {
    const cooldownSeconds = securityCooldownSeconds()
    if (security.isSendingCode || security.isChanging || cooldownSeconds > 0 || !currentUser) return

    dispatchSecurity({ type: 'sendStarted' })
    try {
      await sendPasswordChangeCode()
      const sentAt = Date.now()
      setSecurityNow(sentAt)
      dispatchSecurity({
        type: 'sendSucceeded',
        cooldownUntil: sentAt + SECURITY_CODE_COOLDOWN_MS,
      })
    } catch (error) {
      dispatchSecurity({ type: 'sendFailed', error: errorMessage(error) })
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (security.isChanging || !currentUser) return
    if (!/^\d{6}$/.test(security.code)) {
      dispatchSecurity({ type: 'validationFailed', error: '请输入 6 位邮箱验证码' })
      return
    }
    if (security.newPassword.length < 8 || security.newPassword.length > 128) {
      dispatchSecurity({ type: 'validationFailed', error: '新密码需为 8–128 位' })
      return
    }
    if (security.newPassword !== security.confirmPassword) {
      dispatchSecurity({ type: 'validationFailed', error: '两次输入的新密码不一致' })
      return
    }

    dispatchSecurity({ type: 'changeStarted' })
    try {
      await changePasswordWithCode({
        code: security.code,
        newPassword: security.newPassword,
      })
    } catch (error) {
      dispatchSecurity({ type: 'changeFailed', error: errorMessage(error) })
    }
  }

  function signOut() {
    void logout().catch(() => undefined)
  }

  function securityCooldownSeconds(): number {
    return security.cooldownUntil === null
      ? 0
      : Math.max(0, Math.ceil((security.cooldownUntil - securityNow) / 1_000))
  }

  function selectSection(section: AccountSection) {
    setActiveSection(section)
    dispatchProfile({ type: 'sectionChanged' })
    dispatchSecurity({ type: 'sectionChanged' })
    const next = new URLSearchParams(searchParams)
    if (section === 'profile') next.delete('section')
    else next.set('section', section)
    setSearchParams(next, { replace: true })
  }

  if (!currentUser) return null

  const hasPassword = currentUser.hasPassword
  const displayName = currentUser.nickname || currentUser.email.split('@')[0]
  const initial = Array.from(displayName)[0]?.toUpperCase() ?? 'W'
  const cooldownSeconds = securityCooldownSeconds()

  return (
    <div data-account-page className="min-h-[100dvh] bg-app-canvas text-app-ink">
      <div
        data-account-shell
        className="mx-auto w-full max-w-[1560px] px-4 pt-[clamp(4.75rem,11vh,7rem)] pb-10 sm:px-6 xl:px-8"
      >
        <header className="min-h-[clamp(9rem,16vw,12rem)]">
          <div>
            <p className="font-mono text-[0.65rem] tracking-[0.12em] text-app-faint uppercase">
              Account
            </p>
            <div className="mt-2 flex items-center gap-[clamp(0.5rem,1.5vw,1.25rem)]">
              <h1 className="font-serif text-[clamp(2.15rem,4.5vw,4rem)] leading-none font-medium tracking-[-0.055em] text-app-ink">
                账号中心
              </h1>
              <button
                type="button"
                aria-label="摇一摇工牌"
                onClick={(event) => {
                  event.currentTarget.classList.remove('account-badge-shake')
                  // Force a reflow so rapid clicks can restart the one-shot CSS animation.
                  void event.currentTarget.offsetWidth
                  event.currentTarget.classList.add('account-badge-shake')
                }}
                className="account-badge-button h-[clamp(11rem,19vw,14rem)] w-[clamp(7.5rem,13vw,10rem)] shrink-0 cursor-pointer border-0 bg-transparent p-0 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              >
                <img
                  data-testid="account-pixel-mark"
                  src={accountBadgeArtwork}
                  alt=""
                  aria-hidden="true"
                  draggable="false"
                  className="h-full w-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              </button>
            </div>
          </div>
        </header>

        <div
          data-account-layout="settings"
          className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-[clamp(2rem,4vw,4.5rem)]"
        >
          <aside className="flex flex-col">
            <nav aria-label="账号设置" className="grid gap-1 border-t border-app-line pt-4">
              {(
                [
                  ['profile', '个人资料'],
                  ['security', '修改密码'],
                  ['quota', '积分账户'],
                  ['invite', '邀请奖励'],
                ] as const
              ).map(([section, label]) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => selectSection(section)}
                  aria-current={activeSection === section ? 'page' : undefined}
                  className={`min-h-10 rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
                    activeSection === section
                      ? 'bg-app-surface-muted font-semibold text-app-ink'
                      : 'text-app-muted hover:bg-app-surface-muted/70 hover:text-app-ink-soft'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <button
              type="button"
              onClick={signOut}
              className="mt-5 min-h-10 rounded-lg px-3 text-left text-sm text-app-danger transition-colors hover:bg-app-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger"
            >
              退出当前账号
            </button>
          </aside>

          <section className="min-w-0 rounded-[1.1rem] border border-app-line bg-app-surface-raised p-6 sm:p-7">
            {activeSection === 'profile' ? (
              <div>
                <header>
                  <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">
                    个人资料
                  </h2>
                  <p className="mt-1.5 text-sm text-app-muted">管理你的公开身份和账号邮箱。</p>
                </header>

                <div className="mt-5 flex items-center gap-4 border-b border-app-line pb-5">
                  <span className="grid size-14 shrink-0 place-items-center rounded-full bg-app-accent-soft font-serif text-2xl text-app-accent">
                    {initial}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-app-ink-soft">
                      {displayName}
                    </p>
                    <p className="mt-1 truncate text-sm text-app-muted">{currentUser.email}</p>
                  </div>
                  <span className="ml-auto rounded-full bg-app-accent-soft px-2.5 py-1 text-xs font-medium text-app-accent">
                    {currentUser.emailVerifiedAt ? '已验证' : '未验证'}
                  </span>
                </div>

                <form className="mt-5 grid gap-4" onSubmit={saveNickname} noValidate>
                  <div className="grid max-w-xl gap-1.5">
                    <label htmlFor={nicknameId} className="text-sm font-medium text-app-ink-soft">
                      昵称
                    </label>
                    <input
                      id={nicknameId}
                      type="text"
                      autoComplete="nickname"
                      value={profile.nickname}
                      maxLength={MAX_NICKNAME_LENGTH + 1}
                      disabled={profile.isLoading || profile.isSaving}
                      onChange={(event) =>
                        dispatchProfile({ type: 'nicknameChanged', nickname: event.target.value })
                      }
                      className="account-field"
                      aria-describedby={`${nicknameId}-hint`}
                    />
                    <span id={`${nicknameId}-hint`} className="text-xs leading-5 text-app-faint">
                      1–{MAX_NICKNAME_LENGTH} 个字符，保存后同步显示在页面顶栏。
                    </span>
                  </div>

                  <dl className="grid max-w-xl gap-1 rounded-lg bg-app-surface-muted px-4 py-3 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
                    <dt className="text-app-muted">邮箱验证时间</dt>
                    <dd className="text-app-ink-soft">
                      {currentUser.emailVerifiedAt ? (
                        <time dateTime={currentUser.emailVerifiedAt}>
                          {formatVerificationTime(currentUser.emailVerifiedAt)}
                        </time>
                      ) : (
                        '尚未验证'
                      )}
                    </dd>
                  </dl>

                  {profile.error && (
                    <p
                      role="alert"
                      className="max-w-xl rounded-lg bg-app-danger-soft px-3 py-2.5 text-sm text-app-danger"
                    >
                      {profile.error}
                    </p>
                  )}
                  {profile.success && (
                    <p
                      role="status"
                      className="max-w-xl rounded-lg bg-app-accent-muted px-3 py-2.5 text-sm text-app-accent"
                    >
                      {profile.success}
                    </p>
                  )}

                  <div className="flex max-w-xl flex-wrap items-center justify-between gap-4">
                    <span className="text-xs text-app-faint">
                      {profile.isLoading
                        ? '正在同步最新资料…'
                        : profile.isFresh
                          ? '资料已同步'
                          : '资料同步失败'}
                    </span>
                    <button
                      type="submit"
                      disabled={profile.isLoading || profile.isSaving}
                      className="account-primary-button"
                    >
                      {profile.isSaving ? '正在保存…' : '保存昵称'}
                    </button>
                  </div>
                </form>
              </div>
            ) : activeSection === 'security' ? (
              <div>
                <header>
                  <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">
                    修改密码
                  </h2>
                  <p className="mt-1.5 text-sm leading-6 text-app-muted">
                    {hasPassword
                      ? '验证当前账号邮箱后设置新密码。修改成功后，当前会话会退出。'
                      : '验证当前账号邮箱后设置密码。设置成功后，当前会话会退出，之后可使用密码登录。'}
                  </p>
                </header>

                <form className="mt-5 grid max-w-xl gap-4" onSubmit={changePassword} noValidate>
                  <div className="grid gap-1.5">
                    <span className="text-sm font-medium text-app-ink-soft">验证邮箱</span>
                    <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-app-line bg-app-surface-muted px-3">
                      <span className="min-w-0 truncate text-sm text-app-ink-soft">
                        {currentUser.email}
                      </span>
                      <button
                        type="button"
                        onClick={() => void sendSecurityCode()}
                        disabled={
                          security.isSendingCode || security.isChanging || cooldownSeconds > 0
                        }
                        aria-label={
                          cooldownSeconds > 0 ? `${cooldownSeconds}s 后重发` : '发送验证码'
                        }
                        className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-app-accent transition-colors hover:bg-app-accent-muted disabled:cursor-not-allowed disabled:text-app-faint"
                      >
                        {security.isSendingCode
                          ? '正在发送…'
                          : cooldownSeconds > 0
                            ? `${cooldownSeconds}s 后重发`
                            : '发送验证码'}
                      </button>
                    </div>
                  </div>
                  <label
                    htmlFor={securityCodeId}
                    className="grid gap-1.5 text-sm font-medium text-app-ink-soft"
                  >
                    邮箱验证码
                    <input
                      id={securityCodeId}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={security.code}
                      disabled={security.isChanging || security.isSendingCode}
                      onChange={(event) =>
                        dispatchSecurity({
                          type: 'codeChanged',
                          code: event.target.value.replace(/\D/g, '').slice(0, 6),
                        })
                      }
                      className="account-field"
                    />
                  </label>
                  <div className="grid gap-1.5 text-sm font-medium text-app-ink-soft">
                    <label htmlFor={newPasswordId}>{hasPassword ? '新密码' : '密码'}</label>
                    <input
                      id={newPasswordId}
                      type="password"
                      autoComplete="new-password"
                      value={security.newPassword}
                      disabled={security.isChanging || security.isSendingCode}
                      onChange={(event) =>
                        dispatchSecurity({
                          type: 'newPasswordChanged',
                          password: event.target.value,
                        })
                      }
                      className="account-field"
                      aria-describedby={`${newPasswordId}-hint`}
                    />
                    <span
                      id={`${newPasswordId}-hint`}
                      className="text-xs font-normal text-app-faint"
                    >
                      8–128 位
                    </span>
                  </div>
                  <label
                    htmlFor={confirmPasswordId}
                    className="grid gap-1.5 text-sm font-medium text-app-ink-soft"
                  >
                    {hasPassword ? '确认新密码' : '确认密码'}
                    <input
                      id={confirmPasswordId}
                      type="password"
                      autoComplete="new-password"
                      value={security.confirmPassword}
                      disabled={security.isChanging || security.isSendingCode}
                      onChange={(event) =>
                        dispatchSecurity({
                          type: 'confirmPasswordChanged',
                          password: event.target.value,
                        })
                      }
                      className="account-field"
                    />
                  </label>
                  {security.error && (
                    <p
                      role="alert"
                      className="rounded-lg bg-app-danger-soft px-3 py-2.5 text-sm text-app-danger"
                    >
                      {security.error}
                    </p>
                  )}
                  {security.success && (
                    <p
                      role="status"
                      className="rounded-lg bg-app-accent-muted px-3 py-2.5 text-sm text-app-accent"
                    >
                      {security.success}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={security.isChanging || security.isSendingCode}
                    className="account-primary-button justify-self-start"
                  >
                    {security.isChanging
                      ? hasPassword
                        ? '正在修改…'
                        : '正在设置…'
                      : hasPassword
                        ? '验证并修改密码'
                        : '验证并设置密码'}
                  </button>
                </form>
              </div>
            ) : activeSection === 'quota' ? (
              <QuotaSection />
            ) : (
              <InviteSection />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
