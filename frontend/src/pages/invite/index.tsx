import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { Check, Copy } from '@phosphor-icons/react'

import inviteCharacterArtwork from '@/assets/account/illustrations/invite-character.webp'
import { quotaApis as defaultQuotaApis } from '@/entities'
import type { InviteCode, QuotaApis } from '@/entities'
import { useQuotaBalance } from '@/features/quota'

const INVITE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4,16}$/i
const ICON_PROPS = { size: 20, weight: 'regular' as const }

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

function invitationUrl(code: string): string {
  const query = new URLSearchParams({
    account: 'register',
    invite: code,
    returnTo: '/workspace',
  })
  return `${window.location.origin}/?${query}`
}

export function InviteSection({ apis = defaultQuotaApis }: { apis?: QuotaApis }) {
  const redeemId = useId()
  const balance = useQuotaBalance(true, apis)
  const [invite, setInvite] = useState<InviteCode | null>(null)
  const [isInviteLoading, setIsInviteLoading] = useState(true)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteRequestVersion, setInviteRequestVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [isRedeeming, setIsRedeeming] = useState(false)

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

  const shareLink = useMemo(() => (invite ? invitationUrl(invite.code) : ''), [invite])

  async function copyValue(value: string, successMessage: string) {
    setActionError(null)
    setNotice(null)
    try {
      await navigator.clipboard.writeText(value)
      setNotice(successMessage)
    } catch {
      setActionError('复制失败，请手动选中内容复制')
    }
  }

  async function redeemInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isRedeeming) return
    const normalized = redeemCode.trim().toUpperCase()
    if (!INVITE_CODE_PATTERN.test(normalized)) {
      setNotice(null)
      setActionError('请填写有效邀请码')
      return
    }

    setIsRedeeming(true)
    setActionError(null)
    setNotice(null)
    try {
      await apis.redeemInviteCode(normalized)
      setRedeemCode('')
      setNotice('邀请奖励已到账')
      balance.reload()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setIsRedeeming(false)
    }
  }

  return (
    <div data-invite-section>
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-app-line pb-5">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">邀请奖励</h2>
          <p className="mt-1.5 text-sm leading-6 text-app-muted">
            每成功邀请 1 位好友，你和好友各得 200 积分；没有邀请人数上限，每位好友只能绑定一次。
          </p>
        </div>

        <dl className="flex items-center gap-5 text-right">
          <div>
            <dt className="text-xs text-app-faint">成功邀请</dt>
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

      <section className="mt-7 border-t border-app-line pt-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h3 className="text-lg font-semibold tracking-[-0.025em] text-app-ink-soft">
              补填好友的邀请码
            </h3>
          </div>

          <form
            className="grid w-full gap-3 sm:max-w-xl sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
            onSubmit={redeemInvite}
            noValidate
          >
            <label htmlFor={redeemId} className="sr-only">
              补填邀请码
            </label>
            <input
              id={redeemId}
              value={redeemCode}
              onChange={(event) => setRedeemCode(event.target.value)}
              disabled={isRedeeming}
              autoComplete="off"
              className="min-h-11 w-full rounded-lg border border-app-line bg-app-surface-muted px-3.5 font-mono uppercase outline-none transition-[border-color,box-shadow] focus:border-app-accent focus:ring-2 focus:ring-app-accent/15"
              placeholder="输入好友的邀请码"
            />
            <button
              type="submit"
              disabled={isRedeeming}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-app-line bg-app-surface-raised px-4 text-sm font-semibold text-app-ink-soft hover:border-app-accent/30 hover:text-app-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check {...ICON_PROPS} />
              {isRedeeming ? '正在确认…' : '确认补填'}
            </button>
          </form>
        </div>
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
