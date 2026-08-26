import {
  ArrowRight,
  ChatCircleText,
  CheckCircle,
  FolderOpen,
  GameController,
  Lifebuoy,
  Package,
} from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import { Link } from 'react-router'

import { MarketingHeader } from '@/pages/landing/marketing-header'
import { guideChapters } from './content'

interface Journey {
  title: string
  description: string
  label: string
  to: string
  icon: ComponentType<{ 'aria-hidden'?: boolean; size?: number; weight?: 'duotone' }>
}

const journeys: readonly Journey[] = [
  {
    title: '创建一个新角色',
    description: '用自然语言完成角色母版、方向首帧和第一个动作。',
    label: '开始创建角色',
    to: '/quick-start',
    icon: ChatCircleText,
  },
  {
    title: '继续管理角色',
    description: '查看已有项目，为角色增加动作或整理逐帧素材。',
    label: '查看项目资产',
    to: '/projects',
    icon: FolderOpen,
  },
  {
    title: '试玩已有动作',
    description: '在浏览器里控制角色，检查移动方向与动画衔接。',
    label: '进入预览台',
    to: '/playtest',
    icon: GameController,
  },
  {
    title: '导出游戏素材',
    description: '从角色详情下载透明帧、Sprite Sheet 和完整资源包。',
    label: '选择角色并导出',
    to: '/projects',
    icon: Package,
  },
]

const githubIssues = 'https://github.com/1024XEngineer/Windup/issues'

export function GuidePage() {
  return (
    <>
      <MarketingHeader />
      <main className="min-h-[100dvh] bg-app-canvas pb-24 pt-32 text-app-ink sm:pt-36">
        <div className="mx-auto w-full max-w-[1560px] px-4 sm:px-6 xl:px-8">
          <section className="border-b border-app-line pb-10 sm:pb-12">
            <p className="font-mono text-[0.68rem] font-semibold tracking-[0.16em] text-app-faint uppercase">
              使用说明
            </p>
            <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.65fr)] lg:items-end">
              <div>
                <h1 className="max-w-3xl font-serif text-[clamp(2.5rem,6vw,5rem)] leading-[0.98] font-medium tracking-[-0.055em] text-app-ink">
                  Windup 使用手册
                </h1>
                <p className="mt-5 max-w-2xl text-sm leading-7 text-app-muted sm:text-base">
                  告诉 Windup
                  你想做什么，选择满意的角色和方向，然后把动作带进游戏。你可以从下面的目标直接开始，也可以按章节了解完整流程。
                </p>
              </div>
              <div className="flex flex-wrap gap-3 lg:justify-end">
                <Link
                  to="/quick-start"
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-app-accent px-5 text-sm font-semibold text-app-on-accent transition-colors hover:bg-app-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                >
                  开始创建角色
                  <ArrowRight aria-hidden="true" size={16} weight="bold" />
                </Link>
                <Link
                  to="/workspace"
                  className="inline-flex min-h-11 items-center rounded-lg border border-app-line-strong bg-app-surface-raised px-5 text-sm font-semibold text-app-ink-soft transition-colors hover:border-app-accent hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                >
                  返回工作台
                </Link>
              </div>
            </div>
          </section>

          <section aria-labelledby="guide-goals-title" className="py-10 sm:py-12">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-app-faint">按你的目标开始</p>
                <h2
                  id="guide-goals-title"
                  className="mt-1 font-serif text-2xl font-medium tracking-[-0.035em] text-app-ink sm:text-3xl"
                >
                  你现在想做什么？
                </h2>
              </div>
              <span className="hidden text-xs text-app-faint sm:block">点击后进入对应功能</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {journeys.map((journey) => {
                const Icon = journey.icon
                return (
                  <Link
                    key={journey.title}
                    to={journey.to}
                    aria-label={journey.label}
                    className="group flex min-h-48 flex-col rounded-[1.25rem] border border-app-line bg-app-surface-raised p-5 transition hover:-translate-y-0.5 hover:border-app-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                  >
                    <Icon aria-hidden={true} size={28} weight="duotone" />
                    <strong className="mt-auto font-serif text-xl font-medium tracking-[-0.025em] text-app-ink">
                      {journey.title}
                    </strong>
                    <span className="mt-2 text-xs leading-5 text-app-muted">
                      {journey.description}
                    </span>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-app-accent">
                      {journey.label}
                      <ArrowRight
                        aria-hidden="true"
                        className="transition-transform group-hover:translate-x-0.5"
                        size={14}
                        weight="bold"
                      />
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:gap-10">
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <nav
                aria-label="使用手册目录"
                className="rounded-[1.25rem] border border-app-line bg-app-surface p-3"
              >
                <p className="px-3 pb-2 pt-1 text-[0.68rem] font-semibold tracking-[0.12em] text-app-faint uppercase">
                  完整流程
                </p>
                <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">
                  {guideChapters.map((chapter) => (
                    <li key={chapter.id}>
                      <a
                        href={`#${chapter.id}`}
                        className="group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm text-app-muted transition-colors hover:bg-app-accent-muted hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
                      >
                        <span
                          aria-hidden="true"
                          className="font-mono text-[0.65rem] text-app-faint"
                        >
                          {chapter.index}
                        </span>
                        <span>{chapter.navLabel}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </aside>

            <article className="min-w-0 space-y-5">
              {guideChapters.map((chapter) => (
                <section
                  key={chapter.id}
                  id={chapter.id}
                  aria-labelledby={`${chapter.id}-title`}
                  className="scroll-mt-24 overflow-hidden rounded-[1.25rem] border border-app-line bg-app-surface-raised"
                >
                  <header className="grid gap-4 border-b border-app-line px-5 py-6 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:items-start sm:px-7">
                    <span aria-hidden="true" className="font-mono text-sm text-app-faint">
                      {chapter.index}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-app-faint">{chapter.navLabel}</p>
                      <h2
                        id={`${chapter.id}-title`}
                        className="mt-1 font-serif text-2xl font-medium tracking-[-0.035em] text-app-ink"
                      >
                        {chapter.title}
                      </h2>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-app-muted">
                        {chapter.summary}
                      </p>
                    </div>
                    {chapter.action ? (
                      <Link
                        to={chapter.action.to}
                        className="inline-flex min-h-10 items-center gap-1.5 self-start rounded-lg border border-app-line-strong px-3 text-xs font-semibold text-app-ink-soft transition-colors hover:border-app-accent hover:bg-app-accent-muted hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent sm:ml-4"
                      >
                        {chapter.action.label}
                        <ArrowRight aria-hidden="true" size={13} weight="bold" />
                      </Link>
                    ) : null}
                  </header>

                  <div className="grid gap-px bg-app-line sm:grid-cols-2">
                    {chapter.topics.map((topic) => (
                      <div key={topic.title} className="bg-app-surface-raised p-5 sm:p-7">
                        <h3 className="font-serif text-lg font-medium text-app-ink-soft">
                          {topic.title}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-app-muted">{topic.description}</p>
                        {topic.bullets ? (
                          <ul className="mt-4 space-y-2">
                            {topic.bullets.map((bullet) => (
                              <li
                                key={bullet}
                                className="flex gap-2 text-xs leading-5 text-app-ink-soft"
                              >
                                <CheckCircle
                                  aria-hidden="true"
                                  className="mt-0.5 shrink-0 text-app-accent"
                                  size={15}
                                  weight="fill"
                                />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {topic.example ? (
                          <p className="mt-4 rounded-lg border border-app-line bg-app-surface-muted px-3 py-2.5 font-mono text-xs leading-5 text-app-ink-soft">
                            {topic.example}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  {chapter.tip ? (
                    <div className="flex gap-3 border-t border-app-line bg-app-accent-muted px-5 py-4 text-xs leading-5 text-app-ink-soft sm:px-7">
                      <Lifebuoy
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-app-accent"
                        size={18}
                        weight="duotone"
                      />
                      <p>{chapter.tip}</p>
                    </div>
                  ) : null}
                </section>
              ))}

              <section className="rounded-[1.25rem] bg-app-ink px-5 py-7 text-app-on-accent sm:px-7">
                <p className="text-xs text-app-surface-strong">没有找到答案？</p>
                <div className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-serif text-2xl font-medium">
                      把页面提示和操作步骤告诉我们
                    </h2>
                    <p className="mt-2 max-w-2xl text-xs leading-5 text-app-surface-strong">
                      附上所在页面、刚刚执行的操作、页面显示的错误信息和截图，可以更快定位问题。
                    </p>
                  </div>
                  <a
                    href={githubIssues}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-app-surface-raised px-4 text-xs font-semibold text-app-ink transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-surface-raised"
                  >
                    提交问题
                    <ArrowRight aria-hidden="true" size={14} weight="bold" />
                  </a>
                </div>
              </section>
            </article>
          </div>
        </div>
      </main>
    </>
  )
}
