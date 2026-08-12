import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { useAuthSession } from '@/features/auth-session'

interface ProductNavigationItem {
  motionKey: string
  to: string
  label: string
  compactLabel?: string
  isActive: (pathname: string) => boolean
}

type AccountMenuState = 'closed' | 'open' | 'closing'

const accountMenuExitDurationMs = 260

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
    label: 'PlayTest',
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
export function AppHeader() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const session = useAuthSession()
  const [accountMenuState, setAccountMenuState] = useState<AccountMenuState>('closed')
  const accountMenuOpen = accountMenuState === 'open'
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

  function signOut() {
    const returnHome = () => navigate('/', { replace: true })
    void session.logout().then(returnHome, returnHome)
  }

  function toggleAccountMenu() {
    setAccountMenuState((state) => (state === 'open' ? 'closing' : 'open'))
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
      className="fixed inset-x-0 top-0 z-50 border-b border-[#1c231e]/10 bg-transparent text-[#1c231e] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] backdrop-blur-xl"
    >
      <div className="relative mx-auto grid min-h-14 w-full max-w-[90rem] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          to="/workspace"
          aria-label="返回 Windup 工作台"
          data-motion="text-wave"
          onClick={() => playTextWave('brand')}
          className={`flex min-h-11 shrink-0 items-center gap-2.5 pr-1 text-[#1c231e] focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331] ${
            wave.entry === 'brand' ? 'app-header-text-wave' : ''
          }`}
        >
          <img src="/windup-mark.svg" alt="" className="h-7 w-7" />
          <strong className="hidden font-serif text-[1.0625rem] leading-none sm:inline">
            <WaveText playId={wave.entry === 'brand' ? wave.playId : 0} text="Windup" />
          </strong>
        </Link>

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
                className={`relative inline-flex min-h-11 items-center px-1.5 text-[12px] font-medium whitespace-nowrap transition-colors after:absolute after:inset-x-1.5 after:bottom-0 after:h-[2px] after:origin-center after:bg-[#284331] after:transition-transform focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#284331] sm:px-3 sm:text-[13px] sm:after:inset-x-3 ${
                  active
                    ? 'text-[#243c2c] after:scale-x-100'
                    : 'text-[#667068] after:scale-x-0 hover:text-[#26372c]'
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
              className="inline-grid min-h-11 min-w-11 place-items-center text-sm text-[#778078]"
            >
              …
            </span>
          ) : session.state.status === 'guest' ? (
            <Link
              to={accountEntry}
              aria-label="登录 / 注册"
              className="inline-flex min-h-10 items-center rounded-lg border border-[#2d3b31]/14 bg-white/45 px-3 text-[13px] font-medium whitespace-nowrap text-[#34483a] transition-colors hover:bg-white/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331]"
            >
              <span className="hidden sm:inline">登录 / 注册</span>
              <span className="sm:hidden">登录</span>
            </Link>
          ) : (
            <>
              <button
                type="button"
                aria-label="打开账号菜单"
                aria-expanded={accountMenuOpen}
                title={session.state.user.email}
                onClick={toggleAccountMenu}
                className={`inline-flex min-h-10 max-w-24 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-[#3e4941] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[#e5e8e3] hover:text-[#26372c] active:translate-y-px active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331] motion-reduce:transform-none sm:max-w-36 ${
                  accountMenuOpen ? 'bg-[#e5e8e3] text-[#26372c]' : ''
                }`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dfe5df] font-serif text-[11px] text-[#284331] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
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
                  className={`text-[10px] text-[#7b847d] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
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
                className={`absolute top-[calc(100%+0.5rem)] right-0 grid min-w-44 origin-top-right overflow-hidden rounded-lg border border-[#1c231e]/12 bg-[#f8f7f2] p-1.5 shadow-[0_8px_24px_rgba(28,35,30,0.10)] ${
                  accountMenuState === 'open'
                    ? 'visible app-header-account-menu-in'
                    : accountMenuState === 'closing'
                      ? 'visible pointer-events-none app-header-account-menu-out'
                      : 'invisible pointer-events-none -translate-y-2 scale-[0.82] opacity-0'
                }`}
              >
                <Link
                  to="/account"
                  aria-label="打开账号中心"
                  aria-current={pathname.startsWith('/account') ? 'page' : undefined}
                  onClick={() => setAccountMenuState('closing')}
                  className="flex min-h-10 items-center rounded-md px-3 text-[13px] text-[#3f4942] transition-colors hover:bg-[#e8ebe7] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#284331]"
                >
                  账号中心
                </Link>
                <button
                  type="button"
                  onClick={signOut}
                  aria-label="退出登录"
                  className="flex min-h-10 items-center rounded-md px-3 text-left text-[13px] text-[#707871] transition-colors hover:bg-[#e8ebe7] hover:text-[#26372c] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#284331]"
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
