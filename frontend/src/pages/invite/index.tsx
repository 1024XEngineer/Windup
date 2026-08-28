import { useEffect, useMemo, useState } from 'react'
import { Copy } from '@phosphor-icons/react'

import inviteCharacterArtwork from '@/assets/account/illustrations/invite-character.webp'
import { quotaApis as defaultQuotaApis } from '@/entities'
import type { InviteCode, InviteRecord, QuotaApis } from '@/entities'
import { useQuotaBalance } from '@/features/quota'
import { Pagination } from '@/shared/ui'

const INVITE_RECORD_PAGE_SIZE = 5

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

function formatInviteExpiry(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '有效期未知'
  return `有效至 ${new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)}`
}

function invitationUrl(code: string): string {
  const query = new URLSearchParams({
    account: 'register',
    invite: code,
    returnTo: '/workspace',
  })
  return `${window.location.origin}/?${query}`
}

function formatInviteDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function InviteSection({ apis = defaultQuotaApis }: { apis?: QuotaApis }) {
  const balance = useQuotaBalance(true, apis)
  const [invite, setInvite] = useState<InviteCode | null>(null)
  const [isInviteLoading, setIsInviteLoading] = useState(true)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteRequestVersion, setInviteRequestVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [records, setRecords] = useState<InviteRecord[]>([])
  const [recordsTotal, setRecordsTotal] = useState<number | null>(null)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)
  const [recordsRequestVersion, setRecordsRequestVersion] = useState(0)

  useEffect(() => {
    let active = true
    setIsInviteLoading(true)
    setInviteError(null)
    void apis.getInviteCode().then(
      (view) => {
        if (!active) return
        setInvite(view)
        setInviteError(null)
        setIsInviteLoading(false)
      },
      (error: unknown) => {
        if (!active) return
        setInviteError(errorMessage(error))
        setIsInviteLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [apis, inviteRequestVersion])

  useEffect(() => {
    let active = true
    setRecordsLoading(true)
    setRecordsError(null)
    void apis.listInviteRecords({ page: recordsPage, pageSize: INVITE_RECORD_PAGE_SIZE }).then(
      (result) => {
        if (!active) return
        setRecords(result.items)
        setRecordsTotal(result.total)
        setRecordsLoading(false)
      },
      (error: unknown) => {
        if (!active) return
        setRecordsError(errorMessage(error))
        setRecordsLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [apis, recordsPage, recordsRequestVersion])

  const shareLink = useMemo(() => (invite ? invitationUrl(invite.code) : ''), [invite])

  async function copyValue(value: string, successMessage: string) {
    setActionError(null)
    setNotice(null)
    try {
      await navigator.clipboard.writeText(value)
      setNotice(successMessage)
    } catch {
      setActionError('复制失败，请重试')
    }
  }

  return (
    <div data-invite-section>
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-app-line pb-5">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">邀请奖励</h2>
          <p className="mt-1.5 text-sm leading-6 text-app-muted">
            邀请成功，双方各得 200 积分；每日前 3 次邀请可得奖励。
          </p>
        </div>

        <dl className="flex items-center gap-5 text-right">
          <div>
            <dt className="text-xs text-app-faint">累计邀请</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-app-ink">
              {recordsTotal ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-app-faint">当前码注册</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-app-ink">
              {invite?.usedCount ?? '—'}
            </dd>
          </div>
          <div className="border-l border-app-line pl-5">
            <dt className="text-xs text-app-faint">当前积分</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-app-ink">
              {balance.status === 'ready' ? balance.account.balance.toLocaleString('zh-CN') : '—'}
            </dd>
          </div>
        </dl>
      </header>

      <section
        data-testid="invite-feature"
        className="relative mt-6 grid overflow-visible py-7 sm:py-8 md:-mb-6 md:min-h-[18rem] md:grid-cols-[minmax(0,1fr)_18rem]"
      >
        <div className="relative z-10 min-w-0 py-1 sm:py-2 md:pr-8">
          <h3 className="text-lg font-semibold tracking-[-0.025em] text-app-ink-soft">
            分享专属邀请链接
          </h3>
          <p className="mt-1.5 max-w-md text-sm leading-6 text-app-muted">
            邀请码会随链接一起传递，朋友不需要在注册时手工填写。
          </p>

          <div className="mt-6 w-full min-w-0 max-w-xl">
            {isInviteLoading ? (
              <p role="status" className="text-sm text-app-muted">
                正在准备你的邀请链接…
              </p>
            ) : inviteError ? (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-sm text-app-danger">
                  {inviteError}
                </p>
                <button
                  type="button"
                  onClick={() => setInviteRequestVersion((version) => version + 1)}
                  className="min-h-9 rounded-lg border border-app-line bg-app-surface-raised px-3 text-sm font-semibold text-app-ink-soft hover:border-app-accent/30"
                >
                  重新加载邀请信息
                </button>
              </div>
            ) : invite ? (
              <div>
                <div className="max-w-sm">
                  <p className="mb-1.5 text-xs font-medium text-app-muted">我的邀请码</p>
                  <div className="flex min-w-0 items-center gap-2 rounded-lg border border-app-line bg-app-surface-muted px-4 py-3">
                    <span className="min-w-0 flex-1 overflow-hidden font-mono text-xl font-semibold tracking-[0.16em] text-app-ink text-ellipsis whitespace-nowrap">
                      {invite.code}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyValue(invite.code, '邀请码已复制')}
                      aria-label="复制邀请码"
                      title="复制邀请码"
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-app-muted transition-colors hover:bg-app-surface-raised hover:text-app-ink"
                    >
                      <Copy size={17} weight="regular" />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void copyValue(shareLink, '邀请链接已复制')}
                    disabled={!shareLink}
                    className="inline-flex min-h-8 items-center gap-2 rounded-md px-1 text-sm text-app-muted transition-colors hover:text-app-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Copy size={17} weight="regular" />
                    复制邀请链接
                  </button>
                  <span className="text-xs text-app-faint">
                    {formatInviteExpiry(invite.expiresAt)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative order-last flex min-h-[15rem] items-end justify-center px-3 pt-5 md:min-h-0 md:px-0 md:pt-0">
          <img
            data-testid="invite-character"
            src={inviteCharacterArtwork}
            alt=""
            aria-hidden="true"
            className="invite-character-artwork h-[17rem] w-[19rem] max-w-none object-contain object-bottom sm:h-[19rem] md:absolute md:-right-8 md:-bottom-8 md:h-[19rem] md:w-[19rem]"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      </section>

      <section
        className="mt-8 border-t border-app-line pt-6"
        aria-labelledby="invite-records-title"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="invite-records-title" className="text-base font-semibold text-app-ink-soft">
              邀请记录
            </h3>
            <p className="mt-1 text-sm text-app-muted">仅展示脱敏身份和你的奖励到账状态。</p>
          </div>
          {recordsTotal !== null && (
            <span className="text-xs tabular-nums text-app-faint">共 {recordsTotal} 条</span>
          )}
        </div>

        <div className="mt-4 min-h-24">
          {recordsLoading ? (
            <p role="status" className="py-6 text-sm text-app-muted">
              正在加载邀请记录…
            </p>
          ) : recordsError ? (
            <div className="flex flex-wrap items-center gap-3 py-4">
              <p role="alert" className="text-sm text-app-danger">
                {recordsError}
              </p>
              <button
                type="button"
                onClick={() => setRecordsRequestVersion((version) => version + 1)}
                className="min-h-9 rounded-lg border border-app-line bg-app-surface-raised px-3 text-sm font-semibold text-app-ink-soft hover:border-app-accent/30"
              >
                重新加载邀请记录
              </button>
            </div>
          ) : records.length === 0 ? (
            <p className="rounded-xl border border-dashed border-app-line px-4 py-7 text-center text-sm text-app-muted">
              还没有邀请记录
            </p>
          ) : (
            <ul className="divide-y divide-app-line rounded-xl border border-app-line">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-app-ink-soft">
                      {record.invitee}
                    </p>
                    <p className="mt-1 text-xs text-app-faint">
                      {formatInviteDate(record.createdAt)} · 邀请码 {record.code}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      record.rewarded
                        ? 'bg-app-accent-soft text-app-accent'
                        : 'bg-app-surface-muted text-app-muted'
                    }`}
                  >
                    {record.rewarded ? '已获得奖励' : '未获得奖励'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Pagination
          page={recordsPage}
          pageSize={INVITE_RECORD_PAGE_SIZE}
          total={recordsTotal ?? 0}
          disabled={recordsLoading}
          showPageNumbers
          onPageChange={setRecordsPage}
        />
      </section>

      <div className="mt-4 min-h-6" aria-live="polite">
        {actionError && (
          <p role="alert" className="text-sm text-app-danger">
            {actionError}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm font-medium text-app-accent">
            {notice}
          </p>
        )}
        {balance.status === 'error' && !actionError && (
          <p role="alert" className="text-sm text-app-danger">
            {balance.error}
          </p>
        )}
      </div>
    </div>
  )
}
