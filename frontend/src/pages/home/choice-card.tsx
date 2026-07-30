import { Link } from 'react-router'

export type HomeChoiceCardTone = 'light' | 'dark'

export interface HomeChoiceCardProps {
  to: string
  eyebrow: string
  index: string
  title: string
  description: string
  actionLabel: string
  tone?: HomeChoiceCardTone
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
}: HomeChoiceCardProps) {
  const dark = tone === 'dark'

  return (
    <Link
      to={to}
      className={`group relative flex min-h-56 flex-col overflow-hidden rounded-[1.35rem] border p-5 text-left transition duration-200 motion-reduce:transform-none ${
        dark
          ? 'border-[#191b18] bg-[#191b18] text-white hover:-translate-y-0.5 hover:bg-[#242622]'
          : 'border-[#cfd1ca] bg-[#f4f3ed] text-[#191b18] hover:-translate-y-0.5 hover:border-[#8f958b] hover:bg-white'
      } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#263f2d]`}
    >
      <span
        aria-hidden="true"
        className={`absolute -right-10 -top-12 h-36 w-36 rounded-full border transition-transform duration-300 group-hover:scale-110 motion-reduce:transform-none ${
          dark ? 'border-white/10' : 'border-[#dfe1da]'
        }`}
      />

      <span className="relative flex items-start justify-between gap-4">
        <span
          className={`font-mono text-[9px] font-semibold tracking-[0.18em] ${
            dark ? 'text-white/48' : 'text-[#747973]'
          }`}
        >
          {eyebrow}
        </span>
        <span
          className={`font-serif text-sm tabular-nums ${dark ? 'text-white/36' : 'text-[#a2a69f]'}`}
        >
          {index}
        </span>
      </span>

      <span className="relative mt-auto block pt-12">
        <strong className="block font-serif text-2xl font-medium tracking-[-0.025em]">
          {title}
        </strong>
        <span
          className={`mt-2 block max-w-sm text-sm leading-6 ${
            dark ? 'text-white/62' : 'text-[#666b64]'
          }`}
        >
          {description}
        </span>
      </span>

      <span
        className={`relative mt-5 flex items-center justify-between border-t pt-4 text-xs font-semibold ${
          dark ? 'border-white/12 text-[#d7c39b]' : 'border-[#dfe1da] text-[#263f2d]'
        }`}
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
