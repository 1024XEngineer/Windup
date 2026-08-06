import { Link, useLocation } from 'react-router'

interface ProductNavigationItem {
  to: string
  label: string
  compactLabel?: string
  isActive: (pathname: string) => boolean
}

/**
 * 三个入口对应三种去处：回首页、看已有资产、做新东西。
 * 07-31 定稿版还有一个 Playtest 项，这里没有搬——本仓库的预览路由是
 * /playtest/:characterId/:outfitId，没有角色和造型就构造不出可用地址，
 * 顶栏给不出一个恒定的链接。等预览有了落地入口再加回来。
 */
const productNavigation: ProductNavigationItem[] = [
  {
    to: '/',
    label: '首页',
    isActive: (pathname) => pathname === '/',
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
]

/** 左侧标牌上的第二行，随所在区域变化，让用户知道自己在哪一片。 */
function getWorkspaceLabel(pathname: string): { title: string; detail: string } {
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
  const { pathname } = useLocation()
  const workspace = getWorkspaceLabel(pathname)

  return (
    <header className="pointer-events-none fixed inset-x-0 top-3.5 z-50 flex items-start justify-between gap-2 px-3 text-[#1c231e] sm:gap-4 sm:px-[18px]">
      <div className="pointer-events-auto flex min-h-[3.625rem] min-w-0 items-center gap-3 rounded-xl border border-[#171817]/14 bg-[#dfe3df] px-2.5 py-[7px] sm:min-w-[min(26rem,42vw)] sm:px-3.5">
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
              style={{ fontSize: '13px', fontWeight: 600 }}
              className={`inline-flex min-h-[2.125rem] items-center rounded-[0.5625rem] px-2.5 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#284331] ${
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
      </nav>
    </header>
  )
}
