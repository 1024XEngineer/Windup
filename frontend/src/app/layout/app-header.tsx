import { Link, useLocation, useNavigate } from 'react-router'

import { useAuthSession } from '@/features/auth-session'

interface ProductNavigationItem {
  to: string
  label: string
  compactLabel?: string
  isActive: (pathname: string) => boolean
}

/** 四个入口对应四种去处：回首页、看资产、做新东西、核验已完成的造型。 */
const productNavigation: ProductNavigationItem[] = [
  {
    to: '/workspace',
    label: '首页',
    isActive: (pathname) => pathname === '/workspace',
  },
  {
    to: '/projects',
    label: '项目资产',
    compactLabel: '项目',
    isActive: (pathname) => pathname.startsWith('/projects'),
  },
  {
    to: '/quick-start',
    label: '创作',
    isActive: (pathname) =>
      pathname.startsWith('/quick-start') || pathname.startsWith('/workflow-editor'),
  },
  {
    to: '/playtest',
    label: 'PlayTest',
    isActive: (pathname) => pathname.startsWith('/playtest'),
  },
]

/** 左侧标牌上的第二行，随所在区域变化，让用户知道自己在哪一片。 */
function getWorkspaceLabel(pathname: string): { title: string; detail: string } {
  if (pathname.startsWith('/account')) {
    return { title: '账号中心', detail: '资料与登录安全' }
  }

  if (pathname.startsWith('/projects') || pathname.startsWith('/playtest')) {
    return { title: '项目资产', detail: '角色、造型与动作' }
  }

  if (pathname.startsWith('/quick-start') || pathname.startsWith('/workflow-editor')) {
    return { title: '创作工作流', detail: '设定、生成与审核' }
  }

  return { title: '角色资产工作台', detail: 'Windup' }
}

/**
 * 跨页面悬浮 Bar 知道产品路由，因此属于 app 外壳，不下沉到 shared/ui。
 * 它读 pathname 只用于高亮当前项与切换标牌文案，不据此决定自己出不出现——
 * 谁带外壳是路由表的事，见 app.tsx。
 * 悬浮不占布局高度，页面顶部留白由页面或 PageContainer 自己让出。
 */
export function AppHeader() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const session = useAuthSession()
  const workspace = getWorkspaceLabel(pathname)
  const accountEntry = `/?${new URLSearchParams({
    account: 'login',
    returnTo: `${pathname}${search}${hash}`,
  })}`

  function signOut() {
    const returnHome = () => navigate('/', { replace: true })
    void session.logout().then(returnHome, returnHome)
  }

  return (
    <header className="pointer-events-none fixed inset-x-0 top-3.5 z-50 flex items-start justify-between gap-2 px-3 text-[#1c231e] sm:gap-4 sm:px-[18px]">
      <div className="pointer-events-auto flex min-h-[3.625rem] min-w-0 items-center gap-3 rounded-xl border border-[#171817]/14 bg-[#dfe3df] px-2.5 py-[7px] sm:min-w-[min(26rem,42vw)] sm:px-3.5">
        <Link
          to="/workspace"
          aria-label="返回 Windup 工作台"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 text-[#1c231e] focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331] sm:min-w-0 sm:justify-start md:border-r md:border-[#2d3b31]/12 md:pr-3"
        >
          <img src="/windup-mark.svg" alt="" className="h-[1.6875rem] w-[1.6875rem]" />
          <strong className="hidden font-serif text-base leading-none sm:inline">Windup</strong>
        </Link>

        <span className="hidden min-w-0 gap-0.5 md:grid">
          <strong className="truncate text-[11px] font-semibold">{workspace.title}</strong>
          <small className="truncate text-[8px] text-[#737d75]">{workspace.detail}</small>
        </span>
      </div>

      <div className="pointer-events-auto flex min-h-[3.625rem] min-w-0 items-center gap-1 rounded-xl border border-[#171817]/14 bg-[#dfe3df] p-[7px]">
        <nav aria-label="产品导航" className="flex min-w-0 items-center gap-[3px]">
          {productNavigation.map((item) => {
            const active = item.isActive(pathname)

            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                style={{ fontSize: '13px', fontWeight: 600 }}
                className={`inline-flex min-h-11 items-center rounded-[0.5625rem] px-2.5 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#284331] ${
                  active
                    ? 'bg-[#dce9df] text-[#284331]'
                    : 'text-[#5b655d] hover:bg-[#e7eee8] hover:text-[#26372c]'
                }`}
              >
                {item.compactLabel ? (
                  <>
                    <span className="hidden md:inline">{item.label}</span>
                    <span className="md:hidden">{item.compactLabel}</span>
                  </>
                ) : (
                  item.label
                )}
              </Link>
            )
          })}
        </nav>

        <span aria-hidden="true" className="mx-0.5 h-7 w-px shrink-0 bg-[#2d3b31]/14" />

        <div aria-label="账号" className="flex min-w-0 items-center gap-1">
          {session.state.status === 'booting' ? (
            <span
              aria-label="正在恢复登录状态"
              className="inline-grid min-h-11 min-w-11 place-items-center text-sm text-[#778078] sm:min-w-20"
            >
              …
            </span>
          ) : session.state.status === 'guest' ? (
            <Link
              to={accountEntry}
              aria-label="登录 / 注册"
              className="inline-flex min-h-11 items-center rounded-[0.5625rem] border border-[#2d3b31]/14 bg-white/35 px-3 text-[13px] font-semibold whitespace-nowrap text-[#34483a] transition-colors hover:border-[#2d3b31]/22 hover:bg-[#edf2ed] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#284331]"
            >
              <span className="hidden sm:inline">登录 / 注册</span>
              <span className="sm:hidden">登录</span>
            </Link>
          ) : (
            <div className="flex min-w-0 items-center overflow-hidden rounded-[0.5625rem] border border-[#2d3b31]/14 bg-white/35">
              <Link
                to="/account"
                aria-label="打开账号中心"
                aria-current={pathname.startsWith('/account') ? 'page' : undefined}
                title={session.state.user.email}
                className="inline-flex min-h-11 max-w-16 items-center truncate px-3 text-xs font-semibold text-[#34483a] transition-colors hover:bg-[#dce9df] hover:text-[#26372c] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#284331] sm:max-w-28"
              >
                {session.state.user.nickname || session.state.user.email}
              </Link>
              <button
                type="button"
                onClick={signOut}
                aria-label="退出登录"
                className="inline-flex min-h-11 min-w-11 items-center justify-center border-l border-[#2d3b31]/12 px-2.5 text-xs font-semibold text-[#68736a] transition-colors hover:bg-[#dce9df] hover:text-[#26372c] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#284331]"
              >
                退出
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
