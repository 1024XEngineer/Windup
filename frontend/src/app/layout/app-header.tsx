import { Link, useLocation, useNavigate } from 'react-router'

import { useAuthSession } from '@/features/auth-session'

interface ProductNavigationItem {
  to: string
  label: string
  compactLabel?: string
  isActive: (pathname: string) => boolean
}

const productNavigation: ProductNavigationItem[] = [
  {
    to: '/',
    label: '首页',
    isActive: (pathname) => pathname === '/',
  },
  {
    to: '/projects',
    label: '项目',
    isActive: (pathname) => pathname.startsWith('/projects'),
  },
  {
    to: '/playtest',
    label: '预览台',
    isActive: (pathname) => pathname.startsWith('/playtest'),
  },
  {
    to: '/quick-start',
    label: '创作',
    isActive: (pathname) =>
      pathname.startsWith('/quick-start') || pathname.startsWith('/workflow-editor'),
  },
]

function getWorkspaceLabel(pathname: string): { title: string; detail: string } {
  if (pathname.startsWith('/playtest')) {
    return { title: 'Playtest', detail: '动作预览与质量核验' }
  }

  if (pathname.startsWith('/projects')) {
    return { title: '项目与历史记录', detail: '角色、动作与完成版本' }
  }

  if (pathname.startsWith('/quick-start') || pathname.startsWith('/workflow-editor')) {
    return { title: '创作工作流', detail: '设定、生成与审核' }
  }

  return { title: '角色资产工作台', detail: 'Windup' }
}

/** 跨页面悬浮 Bar 知道产品路由，因此属于 app 外壳，不下沉到 shared/ui。 */
export function AppHeader() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { state } = useAuthSession()
  const workspace = getWorkspaceLabel(pathname)
  const isPlaytest = pathname.startsWith('/playtest')
  const accountLabel =
    state.status === 'authenticated'
      ? state.user.nickname?.trim() || state.user.email.split('@')[0] || '账户'
      : state.status === 'guest'
        ? '登录 / 注册'
        : '账户'
  const accountTarget = state.status === 'authenticated' ? '/?account=settings' : '/?account=login'

  return (
    <header
      className={`pointer-events-none z-50 flex items-start justify-between gap-2 px-3 text-[#1c231e] sm:gap-4 sm:px-[18px] ${
        isPlaytest ? 'relative pt-3.5' : 'fixed inset-x-0 top-3.5'
      }`}
    >
      <div className="pointer-events-auto flex min-h-[3.625rem] min-w-0 items-center gap-3 rounded-xl border border-[#171817]/14 bg-[#dfe3df] px-2.5 py-[7px] sm:min-w-[min(26rem,42vw)] sm:px-3.5">
        {isPlaytest ? (
          <button
            type="button"
            aria-label="返回上一页"
            onClick={() => navigate(-1)}
            className="inline-flex min-h-8 shrink-0 items-center gap-1 border-r border-[#2d3b31]/12 pr-2.5 text-[10px] font-bold text-[#445048] transition-colors hover:text-[#1f3527] focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331]"
          >
            <span aria-hidden="true">←</span>
            返回
          </button>
        ) : null}
        <Link
          to="/"
          aria-label="返回 Windup 首页"
          className="flex shrink-0 items-center gap-2 text-[#1c231e] focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331] md:border-r md:border-[#2d3b31]/12 md:pr-3"
        >
          <img src="/windup-mark.svg" alt="" className="h-[1.6875rem] w-[1.6875rem]" />
          <strong className="font-serif text-base leading-none">Windup</strong>
        </Link>

        <span className="hidden min-w-0 gap-0.5 md:grid">
          <strong className="truncate text-[11px] font-semibold">{workspace.title}</strong>
          <small className="truncate text-[8px] text-[#737d75]">{workspace.detail}</small>
        </span>
      </div>

      <nav
        aria-label="产品导航"
        className="pointer-events-auto flex min-h-[3.625rem] items-center gap-[3px] rounded-xl border border-[#171817]/14 bg-[#dfe3df] p-[7px_9px]"
      >
        {productNavigation.map((item) => {
          const active = item.isActive(pathname)

          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-[2.125rem] items-center rounded-[0.5625rem] px-2.5 text-[9px] font-bold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#284331] ${
                active
                  ? 'bg-[#dce9df] text-[#284331]'
                  : 'text-[#5b655d] hover:bg-[#e7eee8] hover:text-[#26372c]'
              }`}
            >
              {item.compactLabel ? (
                <>
                  <span className="hidden sm:inline">{item.label}</span>
                  <span className="sm:hidden">{item.compactLabel}</span>
                </>
              ) : (
                item.label
              )}
            </Link>
          )
        })}
        <Link
          to={accountTarget}
          className="inline-flex min-h-[2.125rem] shrink-0 items-center rounded-[0.5625rem] px-2 text-[9px] font-bold whitespace-nowrap text-[#5b655d] transition-colors hover:bg-[#e7eee8] hover:text-[#26372c] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#284331] sm:px-2.5"
        >
          {accountLabel}
        </Link>
      </nav>
    </header>
  )
}
