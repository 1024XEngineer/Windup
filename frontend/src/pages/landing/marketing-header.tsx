import { Link } from 'react-router'

import { useAuthSession } from '@/features/auth-session'

const loginEntry = `/?${new URLSearchParams({
  account: 'login',
  returnTo: '/workspace',
})}`

// 内测关闭公开注册。重新开放时恢复 registerEntry 与下方注册链接。
const ACCESS_REQUEST_URL = 'https://github.com/1024XEngineer/Windup/issues'
/*
const registerEntry = `/?${new URLSearchParams({
  account: 'register',
  returnTo: '/workspace',
})}`
*/

const sections = [
  ['#capabilities', '产品能力'],
  ['#workflow', '制作流程'],
  ['#workspace', '资产工作台'],
] as const

/** 公开宣传页导航只负责理解产品与进入产品，不暴露工作台内部导航。 */
export function MarketingHeader() {
  const session = useAuthSession()

  return (
    <header className="sticky top-0 z-50 border-b border-[#d8d6ce] bg-[#f3f2ec]/92 text-[#252520] backdrop-blur-xl">
      <div className="relative mx-auto flex min-h-18 max-w-[82rem] items-center justify-between px-8 lg:px-12">
        <Link
          to="/"
          aria-label="返回 Windup 宣传页"
          className="flex min-h-11 min-w-0 items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3a3b36]"
        >
          <img src="/windup-mark.svg" alt="" className="h-7 w-7 shrink-0" />
          <strong className="font-serif text-lg leading-none tracking-[-0.02em]">Windup</strong>
          <span aria-hidden="true" className="hidden h-4 w-px bg-[#d2d0c7] lg:block" />
          <span className="hidden truncate text-meta text-[#74736d] lg:block">
            2D 角色资产工作台
          </span>
        </Link>

        {/* 中部导航保持单一文字层级，把视觉重心留给产品宣言与真实界面。 */}
        <nav
          aria-label="宣传页导航"
          className="absolute left-1/2 flex -translate-x-1/2 items-center gap-9"
        >
          {sections.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="relative inline-flex min-h-11 items-center text-body font-medium text-[#65645e] transition-colors duration-200 after:absolute after:inset-x-0 after:bottom-3.5 after:h-px after:scale-x-0 after:bg-[#555b54] after:transition-transform after:duration-200 hover:text-[#252520] hover:after:scale-x-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3a3b36]"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-6">
          {session.state.status === 'booting' ? (
            <span
              aria-label="正在恢复登录状态"
              className="inline-flex min-h-11 items-center text-body text-ink-faint"
            >
              正在进入
            </span>
          ) : session.state.status === 'authenticated' ? (
            <Link
              to="/workspace"
              className="inline-flex min-h-11 items-center rounded-lg bg-[#252520] px-5 text-body font-medium whitespace-nowrap text-[#f7f5ee] transition-colors duration-200 hover:bg-[#3a3b36] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#3a3b36]"
            >
              进入工作台
            </Link>
          ) : (
            <>
              <Link
                to={loginEntry}
                className="inline-flex min-h-11 items-center text-body font-medium whitespace-nowrap text-[#65645e] transition-colors duration-200 hover:text-[#252520] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3a3b36]"
              >
                登录
              </Link>
              {/*
              <Link
                to={registerEntry}
                className="inline-flex min-h-11 items-center rounded-lg bg-[#252520] px-5 text-body font-medium whitespace-nowrap text-[#f7f5ee] transition-colors duration-200 hover:bg-[#3a3b36] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#3a3b36]"
              >
                注册
              </Link>
              */}
              <span className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  disabled
                  title="内测期间暂不开放注册，请通过 GitHub Issues 联系团队申请开通"
                  className="inline-flex min-h-11 cursor-not-allowed items-center rounded-lg bg-[#252520]/45 px-5 text-body font-medium whitespace-nowrap text-[#f7f5ee]/70"
                >
                  注册
                </button>
                <a
                  href={ACCESS_REQUEST_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-[11.5rem] text-right text-[11px] leading-4 text-[#74736d] underline decoration-[#d2d0c7] underline-offset-2 transition-colors hover:text-[#252520] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3a3b36]"
                >
                  内测暂不开放，联系团队申请
                </a>
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
