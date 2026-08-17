import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { quotaApis as defaultQuotaApis } from '@/entities'
import type { QuotaApis } from '@/entities'
import { useAuthSession } from '@/features/auth-session'
import { useQuotaBalance } from '@/features/quota'
import { PageBackButton } from './page-back-button'

interface ProductNavigationItem {
  motionKey: string
  to: string
  label: string
  compactLabel?: string
  isActive: (pathname: string) => boolean
}

type AccountMenuState = 'closed' | 'open' | 'closing'

export interface AppHeaderProps {
  quotaApis?: QuotaApis
}

const accountMenuExitDurationMs = 260
const inviteHintStorageKey = 'windup.invite-hint-seen.v5'

/** 四个入口对应四种去处：回首页、看资产、做新东西、核验已完成的造型。 */
const productNavigation: ProductNavigationItem[] = [
  {
    motionKey: 'home',
    to: '/workspace',
    label: '首页',
    isActive: (pathname) => pathname === '/workspace',
  },
  {
    motionKey: 'projects',
    to: '/projects',
    label: '项目资产',
    compactLabel: '项目',
    isActive: (pathname) => pathname.startsWith('/projects'),
  },
  {
    motionKey: 'create',
    to: '/quick-start',
    label: '创作',
    isActive: (pathname) =>
      pathname.startsWith('/quick-start') || pathname.startsWith('/workflow-editor'),
  },
  {
    motionKey: 'playtest',
    to: '/playtest',
    label: '预览台',
    isActive: (pathname) => pathname.startsWith('/playtest'),
  },
]

function WaveText({ playId, text }: { playId: number; text: string }) {
  return (
    <span key={playId} aria-hidden="true" className="whitespace-pre">
      {[...text].map((character, index, characters) => (
        <span
          key={`${character}-${index}`}
          data-wave-last={index === characters.length - 1 ? 'true' : undefined}
          className="app-header-wave-glyph inline-block"
          style={{ animationDelay: `${index * 26}ms` }}
        >
          {character}
        </span>
      ))}
    </span>
  )
}

/**
 * 跨页面顶栏知道产品路由，因此属于 app 外壳，不下沉到 shared/ui。
 * 品牌、主导航和账号共用一个平面，避免三个功能层被误读成彼此独立的卡片。
 */
export function AppHeader({ quotaApis = defaultQuotaApis }: AppHeaderProps = {}) {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const session = useAuthSession()
  const [accountMenuState, setAccountMenuState] = useState<AccountMenuState>('closed')
  const [inviteHintVisible, setInviteHintVisible] = useState(false)
  const accountMenuOpen = accountMenuState === 'open'
  const creditBalance = useQuotaBalance(
    accountMenuState !== 'closed' && session.state.status === 'authenticated',
    quotaApis,
  )
  const [wave, setWave] = useState({ entry: '', playId: 0 })
  const accountEntry = `/?${new URLSearchParams({
    account: 'login',
    returnTo: `${pathname}${search}${hash}`,
  })}`

  useEffect(() => {
    if (accountMenuState !== 'closing') {
      return
    }

    const timer = window.setTimeout(() => setAccountMenuState('closed'), accountMenuExitDurationMs)
    return () => window.clearTimeout(timer)
  }, [accountMenuState])

  useEffect(() => {
    if (pathname !== '/workspace' || session.state.status !== 'authenticated') {
      setInviteHintVisible(false)
      return
    }

    if (window.sessionStorage.getItem(inviteHintStorageKey) !== '1') {
      setInviteHintVisible(true)
    }

    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem(inviteHintStorageKey, '1')
      setInviteHintVisible(false)
    }, 15_000)

    return () => window.clearTimeout(timer)
  }, [pathname, session.state.status])

  function signOut() {
    window.sessionStorage.removeItem(inviteHintStorageKey)
    const returnHome = () => navigate('/', { replace: true })
    void session.logout().then(returnHome, returnHome)
  }

  function toggleAccountMenu() {
    dismissInviteHint()
    setAccountMenuState((state) => (state === 'open' ? 'closing' : 'open'))
  }

  function dismissInviteHint() {
    window.sessionStorage.setItem(inviteHintStorageKey, '1')
    setInviteHintVisible(false)
  }

  function finishAccountMenuMotion() {
    if (accountMenuState === 'closing') {
      setAccountMenuState('closed')
    }
  }

  function playTextWave(entry: string) {
    setWave(({ playId }) => ({ entry, playId: playId + 1 }))
  }

  return (
    <header
      data-layout="unified"
      data-surface="frosted-bar"
      className="fixed inset-x-0 top-0 z-50 border-b border-app-ink/10 bg-transparent text-app-ink shadow-app-header backdrop-blur-xl"
    >
      <div className="relative mx-auto grid min-h-14 w-full max-w-[90rem] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-1.5">
          <PageBackButton />
          <Link
            to="/workspace"
            aria-label="返回 Windup 工作台"
            data-motion="text-wave"
            onClick={() => playTextWave('brand')}
            className={`flex min-h-11 shrink-0 items-center gap-2.5 pr-1 text-app-ink focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent max-[360px]:hidden ${
              wave.entry === 'brand' ? 'app-header-text-wave' : ''
            }`}
          >
            <img src="/windup-mark.svg" alt="" className="h-7 w-7" />
            <strong className="hidden font-serif text-[1.0625rem] leading-none sm:inline">
              <WaveText playId={wave.entry === 'brand' ? wave.playId : 0} text="Windup" />
            </strong>
          </Link>
        </div>

        <nav
          aria-label="产品导航"
          className="absolute left-1/2 flex -translate-x-1/2 items-stretch gap-0 sm:gap-1"
        >
          {productNavigation.map((item) => {
            const active = item.isActive(pathname)

            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                data-motion="text-wave"
                onClick={() => playTextWave(item.motionKey)}
                className={`relative inline-flex min-h-11 items-center px-1.5 text-[12px] font-medium whitespace-nowrap transition-colors after:absolute after:inset-x-1.5 after:bottom-0 after:h-[2px] after:origin-center after:bg-app-accent after:transition-transform focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent sm:px-3 sm:text-[13px] sm:after:inset-x-3 ${
                  active
                    ? 'text-app-accent after:scale-x-100'
                    : 'text-app-muted after:scale-x-0 hover:text-app-accent'
                } ${wave.entry === item.motionKey ? 'app-header-text-wave' : ''}`}
              >
                {item.compactLabel ? (
                  <>
                    <span className="hidden md:inline">
                      <WaveText
                        playId={wave.entry === item.motionKey ? wave.playId : 0}
                        text={item.label}
                      />
                    </span>
                    <span className="md:hidden">
                      <WaveText
                        playId={wave.entry === item.motionKey ? wave.playId : 0}
                        text={item.compactLabel}
                      />
                    </span>
                  </>
                ) : (
                  <WaveText
                    playId={wave.entry === item.motionKey ? wave.playId : 0}
                    text={item.label}
                  />
                )}
              </Link>
            )
          })}
        </nav>

        <div aria-label="账号" className="relative col-start-3 ml-auto shrink-0">
          {session.state.status === 'booting' ? (
            <span
              aria-label="正在恢复登录状态"
              className="inline-grid min-h-11 min-w-11 place-items-center text-sm text-app-faint"
            >
              …
            </span>
          ) : session.state.status === 'guest' ? (
            <Link
              to={accountEntry}
              aria-label="登录"
              className="inline-flex min-h-10 items-center rounded-lg border border-app-ink/14 bg-app-surface-raised/45 px-3 text-[13px] font-medium whitespace-nowrap text-app-ink-soft transition-colors hover:bg-app-surface-raised/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            >
              {/* 内测关闭公开注册。重新开放时改回「登录 / 注册」。 */}
              <span className="hidden sm:inline">登录</span>
              <span className="sm:hidden">登录</span>
            </Link>
          ) : (
            <>
              {inviteHintVisible ? (
                <div
                  role="status"
                  aria-label="邀请奖励提示"
                  className="absolute top-[calc(100%+0.7rem)] right-0 z-10 w-[min(15rem,calc(100vw-2rem))] rounded-lg border border-app-ink/12 bg-app-surface-raised px-3.5 py-3 text-left shadow-app-menu before:absolute before:-top-1.5 before:right-5 before:h-3 before:w-3 before:rotate-45 before:border-l before:border-t before:border-app-ink/12 before:bg-app-surface-raised"
                >
                  <div className="relative flex items-start gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium leading-5 text-app-ink-soft">
                        邀请好友，双方各得 200 积分
                      </p>
                      <Link
                        to="/account"
                        onClick={dismissInviteHint}
                        className="mt-1 inline-flex text-[12px] text-app-muted underline decoration-app-ink/20 underline-offset-2 transition-colors hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                      >
                        去看看邀请奖励
                      </Link>
                    </div>
                    <button
                      type="button"
                      aria-label="关闭邀请奖励提示"
                      onClick={dismissInviteHint}
                      className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-sm leading-none text-app-faint transition-colors hover:bg-app-ink/5 hover:text-app-ink-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                aria-label="打开账号菜单"
                aria-expanded={accountMenuOpen}
                title={session.state.user.email}
                onClick={toggleAccountMenu}
                className={`inline-flex min-h-10 max-w-24 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-app-ink-soft transition-[color,background-color,transform] duration-150 ease-out hover:bg-app-accent-muted hover:text-app-accent active:translate-y-px active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent motion-reduce:transform-none sm:max-w-36 ${
                  accountMenuOpen ? 'bg-app-accent-muted text-app-accent' : ''
                }`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-app-accent-muted font-serif text-[11px] text-app-accent transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                    accountMenuOpen ? 'scale-110' : 'scale-100'
                  }`}
                >
                  {(session.state.user.nickname || session.state.user.email).slice(0, 1)}
                </span>
                <span className="hidden truncate sm:inline">
                  {session.state.user.nickname || session.state.user.email}
                </span>
                <span
                  aria-hidden="true"
                  className={`text-[10px] text-app-faint transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                    accountMenuOpen ? 'rotate-180' : 'rotate-0'
                  }`}
                >
                  ↓
                </span>
              </button>

              <div
                data-testid="account-menu"
                data-state={accountMenuState}
                data-motion="scale-fade"
                aria-hidden={accountMenuOpen ? undefined : true}
                inert={!accountMenuOpen}
                onAnimationEnd={finishAccountMenuMotion}
                className={`absolute top-[calc(100%+0.5rem)] right-0 grid min-w-44 origin-top-right overflow-hidden rounded-lg border border-app-ink/12 bg-app-surface-raised p-1.5 shadow-app-menu ${
                  accountMenuState === 'open'
                    ? 'visible app-header-account-menu-in'
                    : accountMenuState === 'closing'
                      ? 'visible pointer-events-none app-header-account-menu-out'
                      : 'invisible pointer-events-none -translate-y-2 scale-[0.82] opacity-0'
                }`}
              >
                <div
                  aria-label="积分余额"
                  className="flex min-h-11 items-center justify-between gap-4 border-b border-app-ink/10 px-3 pb-1 text-[13px]"
                >
                  <span className="text-app-muted">可用积分</span>
                  <output aria-live="polite" className="font-mono font-semibold text-app-accent">
                    {creditBalance.status === 'ready' ? (
                      <>
                        {creditBalance.account.balance}
                        <span className="ml-1 font-sans text-[11px] font-normal text-app-faint">
                          积分
                        </span>
                      </>
                    ) : creditBalance.status === 'error' ? (
                      <span className="font-sans text-[12px] font-normal text-app-faint">
                        积分暂不可用
                      </span>
                    ) : (
                      <span className="font-sans text-[12px] font-normal text-app-faint">
                        查询中…
                      </span>
                    )}
                  </output>
                </div>
                <Link
                  to="/account"
                  aria-label="打开账号中心"
                  aria-current={pathname.startsWith('/account') ? 'page' : undefined}
                  onClick={() => setAccountMenuState('closing')}
                  className="flex min-h-10 items-center rounded-md px-3 text-[13px] text-app-ink-soft transition-colors hover:bg-app-accent-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-app-accent"
                >
                  账号中心
                </Link>
                <button
                  type="button"
                  onClick={signOut}
                  aria-label="退出登录"
                  className="flex min-h-10 items-center rounded-md px-3 text-left text-[13px] text-app-muted transition-colors hover:bg-app-accent-muted hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-app-accent"
                >
                  退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
