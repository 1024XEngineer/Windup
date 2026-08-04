import { Link } from 'react-router'

export type HomeChoiceCardTone = 'light' | 'dark'

/** 展开后的次级入口；两个都指向真实路由，卡片本身不再是链接。 */
export interface HomeChoiceCardAction {
  to: string
  label: string
}

export interface HomeChoiceCardProps {
  to: string
  eyebrow: string
  index: string
  title: string
  description: string
  actionLabel: string
  tone?: HomeChoiceCardTone
  /**
   * 给出时，底部动作条由 actionLabel 换成这几个入口：能 hover 的设备悬停或键盘聚焦后展开，
   * 触屏设备常显。卡片随之从 Link 降级为 section——链接不能嵌套链接。
   * 不给时卡片整体是一个链接，指向 to。
   */
  actions?: HomeChoiceCardAction[]
}

/** Home 专用入口卡；只接收显示内容与目标路由，不持有业务状态。 */
export function HomeChoiceCard({
  to,
  eyebrow,
  index,
  title,
  description,
  actionLabel,
  tone = 'light',
  actions,
}: HomeChoiceCardProps) {
  const dark = tone === 'dark'
  const split = actions !== undefined && actions.length > 0

  const shell = `group relative flex min-h-56 flex-col overflow-hidden rounded-[1.35rem] border p-5 text-left transition duration-200 motion-reduce:transform-none ${
    dark
      ? 'border-[#191b18] bg-[#191b18] text-white hover:-translate-y-0.5 hover:bg-[#242622]'
      : 'border-[#cfd1ca] bg-[#f4f3ed] text-[#191b18] hover:-translate-y-0.5 hover:border-[#8f958b] hover:bg-white'
  } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#263f2d]`

  const body = (
    <>
      <span
        aria-hidden="true"
        className={`absolute -right-10 -top-12 h-36 w-36 rounded-full border transition-transform duration-300 group-hover:scale-110 motion-reduce:transform-none ${
          dark ? 'border-white/10' : 'border-[#dfe1da]'
        }`}
      />

      <span className="relative flex items-start justify-between gap-4">
        <span
          className={`font-mono text-[9px] font-semibold tracking-[0.18em] ${
            dark ? 'text-white' : 'text-[#747973]'
          }`}
        >
          {eyebrow}
        </span>
        <span
          className={`font-serif text-sm tabular-nums ${dark ? 'text-white' : 'text-[#a2a69f]'}`}
        >
          {index}
        </span>
      </span>

      <span className="relative mt-auto block pt-12">
        <strong
          className={`block font-serif text-2xl font-medium tracking-[-0.025em] ${
            dark ? 'text-white' : 'text-[#191b18]'
          }`}
        >
          {title}
        </strong>
        <span
          className={`mt-2 block max-w-sm text-sm leading-6 ${
            dark ? 'text-white' : 'text-[#666b64]'
          }`}
        >
          {description}
        </span>
      </span>
    </>
  )

  const actionBorder = dark ? 'border-white/18 text-white' : 'border-[#dfe1da] text-[#263f2d]'

  if (!split) {
    return (
      <Link to={to} className={shell}>
        {body}
        <span
          className={`relative mt-5 flex items-center justify-between border-t pt-4 text-xs font-semibold ${actionBorder}`}
        >
          {actionLabel}
          <span
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transform-none"
          >
            →
          </span>
        </span>
      </Link>
    )
  }

  return (
    <section className={shell}>
      {body}

      <div className={`relative mt-5 border-t pt-4 text-xs font-semibold ${actionBorder}`}>
        {/* 两层叠在一起换位，不用 display:none——隐藏的链接无法聚焦，键盘用户就够不到次级入口。
            any-pointer-coarse 那一份是触屏的基线：Tailwind v4 把 hover: 包在 @media (hover: hover) 里，
            触屏既没有 hover 也没有 Tab，只留 hover 展开的话这两个入口在手机上根本触发不到。
            用 any-pointer 而非 pointer，是因为触屏笔记本、配鼠标的 iPad 主指针报 fine，
            只判主指针那类设备用手指仍然点不动；代价是它们两个分支同时命中，按钮常显。 */}
        <div className="flex items-center justify-between transition-opacity duration-200 group-hover:opacity-0 group-focus-within:opacity-0 any-pointer-coarse:hidden">
          {actionLabel}
          <span aria-hidden="true">→</span>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex gap-2 opacity-0 transition-opacity duration-200 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 any-pointer-coarse:static any-pointer-coarse:opacity-100 any-pointer-coarse:pointer-events-auto">
          {actions.map((action) => (
            <Link
              key={action.to + action.label}
              to={action.to}
              className={`flex-1 rounded-full border px-3 py-2 text-center transition-colors duration-150 ${
                dark
                  ? 'border-white/25 hover:border-white hover:bg-white/10'
                  : 'border-[#cfd1ca] bg-white hover:border-[#263f2d] hover:bg-[#eef0ea]'
              } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#263f2d]`}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
