import { useEffect, useId, useReducer, useRef, useState, type FormEvent } from 'react'

import accountBadgeArtwork from '@/assets/account/illustrations/account-badge.webp'
import type { User } from '@/entities'
import { useAuthSession } from '@/features/auth-session'
import {
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

function QuotaSection() {
  const balance = useQuotaBalance(true)
  const transactions = useQuotaTransactions(true)
  const account = balance.status === 'ready' ? balance.account : null
  const summaryRows: Array<[string, string]> = [
    ['可用积分', account ? formatCredits(account.balance) : '—'],
    ['冻结积分', account ? formatCredits(account.frozen) : '—'],
    ['累计获得', account ? formatCredits(account.totalEarned) : '—'],
    ['累计使用', account ? formatCredits(account.totalSpent) : '—'],
  ]

  return (
    <div>
      <header>
        <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">积分账户</h2>
        <p className="mt-1.5 text-sm text-app-muted">查看当前余额与最近的积分变动记录。</p>
      </header>

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
          onPageChange={transactions.loadPage}
        />
      </section>
    </div>
  )
}

/** 账号页以 /auth/me 为事实来源；会话层负责把刷新和编辑结果同步给 Header。 */
export function AccountPage() {
  const session = useAuthSession()
  const {
    changePassword: changeSessionPassword,
    logout,
    refreshCurrentUser,
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
  const [activeSection, setActiveSection] = useState<'profile' | 'security' | 'quota' | 'invite'>(
    'profile',
  )
  const nicknameId = useId()
  const oldPasswordId = useId()
  const newPasswordId = useId()

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

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (security.isChanging) return
    if (!security.oldPassword) {
      dispatchSecurity({ type: 'validationFailed', error: '请输入当前密码' })
      return
    }
    if (security.newPassword.length < 8 || security.newPassword.length > 128) {
      dispatchSecurity({ type: 'validationFailed', error: '新密码需为 8–128 位' })
      return
    }

    dispatchSecurity({ type: 'changeStarted' })
    try {
      await changeSessionPassword({
        oldPassword: security.oldPassword,
        newPassword: security.newPassword,
      })
    } catch (error) {
      dispatchSecurity({ type: 'changeFailed', error: errorMessage(error) })
    }
  }

  function signOut() {
    void logout().catch(() => undefined)
  }

  function selectSection(section: 'profile' | 'security' | 'quota' | 'invite') {
    setActiveSection(section)
    dispatchProfile({ type: 'sectionChanged' })
    dispatchSecurity({ type: 'sectionChanged' })
  }

  if (!currentUser) return null

  const displayName = currentUser.nickname || currentUser.email.split('@')[0]
  const initial = Array.from(displayName)[0]?.toUpperCase() ?? 'W'

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
                  ['security', '登录安全'],
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
                    登录安全
                  </h2>
                  <p className="mt-1.5 text-sm leading-6 text-app-muted">
                    修改密码后，当前会话会退出。
                  </p>
                </header>

                <form className="mt-5 grid max-w-xl gap-4" onSubmit={changePassword} noValidate>
                  <label
                    htmlFor={oldPasswordId}
                    className="grid gap-1.5 text-sm font-medium text-app-ink-soft"
                  >
                    当前密码
                    <input
                      id={oldPasswordId}
                      type="password"
                      autoComplete="current-password"
                      value={security.oldPassword}
                      disabled={security.isChanging}
                      onChange={(event) =>
                        dispatchSecurity({
                          type: 'oldPasswordChanged',
                          password: event.target.value,
                        })
                      }
                      className="account-field"
                    />
                  </label>
                  <div className="grid gap-1.5 text-sm font-medium text-app-ink-soft">
                    <label htmlFor={newPasswordId}>新密码</label>
                    <input
                      id={newPasswordId}
                      type="password"
                      autoComplete="new-password"
                      value={security.newPassword}
                      disabled={security.isChanging}
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
                  {security.error && (
                    <p
                      role="alert"
                      className="rounded-lg bg-app-danger-soft px-3 py-2.5 text-sm text-app-danger"
                    >
                      {security.error}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={security.isChanging}
                    className="account-primary-button justify-self-start"
                  >
                    {security.isChanging ? '正在修改…' : '修改密码'}
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
