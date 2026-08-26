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
  icon: ComponentType<{
    'aria-hidden'?: boolean
    className?: string
    size?: number
    weight?: 'duotone'
  }>
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
        <article
          aria-labelledby="guide-title"
          className="mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-12"
        >
          <header className="border-b border-app-line pb-14 sm:pb-16">
            <p className="font-mono text-[0.68rem] font-semibold tracking-[0.16em] text-app-faint uppercase">
              使用说明
            </p>
            <div className="mt-5 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.46fr)] lg:items-end">
              <div>
                <h1
                  id="guide-title"
                  className="max-w-4xl font-serif text-[clamp(3rem,6.4vw,5.25rem)] leading-[1.06] font-semibold tracking-[-0.055em] text-app-ink"
                >
                  Windup 使用手册
                </h1>
                <p className="mt-6 max-w-2xl text-base leading-8 text-app-muted sm:text-lg">
                  告诉 Windup
                  你想做什么，选择满意的角色和方向，然后把动作带进游戏。你可以从下面的目标直接开始，也可以按章节了解完整流程。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4 lg:justify-end">
                <Link
                  to="/quick-start"
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-app-accent px-5 text-sm font-semibold text-app-on-accent transition-colors hover:bg-app-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                >
                  开始创建角色
                  <ArrowRight aria-hidden="true" size={16} weight="bold" />
                </Link>
                <Link
                  to="/workspace"
                  className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-app-ink-soft underline decoration-app-line-strong underline-offset-4 transition-colors hover:text-app-accent focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                >
                  返回工作台
                  <ArrowRight aria-hidden="true" size={14} weight="bold" />
                </Link>
              </div>
            </div>
          </header>

          <section aria-labelledby="guide-goals-title" className="py-14 sm:py-16">
            <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
              <div>
                <p className="font-mono text-[0.68rem] font-semibold tracking-[0.14em] text-app-faint uppercase">
                  按你的目标开始
                </p>
                <h2
                  id="guide-goals-title"
                  className="mt-3 text-2xl font-extrabold tracking-[-0.025em] text-app-ink sm:text-3xl"
                >
                  你现在想做什么？
                </h2>
              </div>
              <div className="grid md:grid-cols-2">
                {journeys.map((journey) => {
                  const Icon = journey.icon
                  return (
                    <Link
                      key={journey.title}
                      to={journey.to}
                      aria-label={journey.label}
                      className="group grid min-h-44 grid-cols-[2rem_minmax(0,1fr)] gap-x-4 border-t border-app-line py-6 md:px-6 md:first:pl-0 md:nth-[2]:pr-0 md:nth-[3]:pl-0 md:nth-[4]:pr-0"
                    >
                      <Icon
                        aria-hidden={true}
                        className="mt-0.5 text-app-accent"
                        size={24}
                        weight="duotone"
                      />
                      <span className="flex min-w-0 flex-col">
                        <strong className="text-lg font-bold tracking-[-0.015em] text-app-ink">
                          {journey.title}
                        </strong>
                        <span className="mt-2 text-sm leading-6 text-app-muted">
                          {journey.description}
                        </span>
                        <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-xs font-semibold text-app-accent">
                          {journey.label}
                          <ArrowRight
                            aria-hidden="true"
                            className="transition-transform group-hover:translate-x-1"
                            size={14}
                            weight="bold"
                          />
                        </span>
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          </section>

          <div className="grid gap-12 border-t border-app-line pt-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
            <aside className="lg:sticky lg:top-28 lg:self-start">
              <nav aria-label="使用手册目录" className="border-l border-app-line pl-5">
                <p className="font-mono text-[0.68rem] font-semibold tracking-[0.14em] text-app-faint uppercase">
                  完整流程
                </p>
                <ol className="mt-5 grid grid-cols-2 gap-x-5 gap-y-1 sm:grid-cols-4 lg:grid-cols-1">
                  {guideChapters.map((chapter) => (
                    <li key={chapter.id}>
                      <a
                        href={`#${chapter.id}`}
                        className="group flex min-h-10 items-center gap-3 py-2 text-sm text-app-muted transition-colors hover:text-app-accent focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
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

            <div className="min-w-0">
              {guideChapters.map((chapter) => (
                <section
                  key={chapter.id}
                  id={chapter.id}
                  aria-labelledby={`${chapter.id}-title`}
                  className="scroll-mt-28 border-b border-app-line py-14 first:pt-0 sm:py-20"
                >
                  <header className="grid gap-5 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
                    <span
                      aria-hidden="true"
                      className="font-mono text-sm tracking-[0.08em] text-app-faint"
                    >
                      {chapter.index}
                    </span>
                    <div>
                      <p className="text-xs font-semibold tracking-[0.08em] text-app-faint uppercase">
                        {chapter.navLabel}
                      </p>
                      <h2
                        id={`${chapter.id}-title`}
                        className="mt-3 max-w-4xl text-[clamp(1.85rem,3.6vw,3.15rem)] leading-[1.18] font-extrabold tracking-[-0.035em] text-app-ink"
                      >
                        {chapter.title}
                      </h2>
                      <p className="mt-5 max-w-3xl text-base leading-8 text-app-muted">
                        {chapter.summary}
                      </p>
                      {chapter.action ? (
                        <Link
                          to={chapter.action.to}
                          className="mt-6 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-app-accent underline decoration-app-line-strong underline-offset-4 transition-colors hover:text-app-accent-hover focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                        >
                          {chapter.action.label}
                          <ArrowRight aria-hidden="true" size={14} weight="bold" />
                        </Link>
                      ) : null}
                    </div>
                  </header>

                  <div className="mt-10 sm:ml-[5.5rem] sm:mt-12">
                    <div className="max-w-3xl divide-y divide-app-line">
                      {chapter.topics.map((topic, topicIndex) => (
                        <div
                          key={topic.title}
                          className="grid gap-4 py-8 first:pt-0 sm:grid-cols-[2rem_minmax(0,1fr)] sm:gap-6"
                        >
                          <span
                            aria-hidden="true"
                            className="font-mono text-[0.68rem] text-app-faint"
                          >
                            {String(topicIndex + 1).padStart(2, '0')}
                          </span>
                          <div>
                            <h3 className="text-lg font-bold tracking-[-0.015em] text-app-ink-soft sm:text-xl">
                              {topic.title}
                            </h3>
                            <p className="mt-3 text-sm leading-7 text-app-muted sm:text-base">
                              {topic.description}
                            </p>
                            {topic.bullets ? (
                              <ul className="mt-5 space-y-3">
                                {topic.bullets.map((bullet) => (
                                  <li
                                    key={bullet}
                                    className="flex gap-3 text-sm leading-6 text-app-ink-soft"
                                  >
                                    <CheckCircle
                                      aria-hidden="true"
                                      className="mt-1 shrink-0 text-app-accent"
                                      size={16}
                                      weight="fill"
                                    />
                                    <span>{bullet}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {topic.example ? (
                              <blockquote className="mt-5 border-l-2 border-app-line-strong pl-4 font-mono text-xs leading-6 text-app-ink-soft sm:text-sm">
                                {topic.example}
                              </blockquote>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    {chapter.tip ? (
                      <div className="mt-4 flex max-w-3xl gap-3 border-l-2 border-app-accent bg-app-accent-muted px-5 py-4 text-sm leading-6 text-app-ink-soft">
                        <Lifebuoy
                          aria-hidden="true"
                          className="mt-0.5 shrink-0 text-app-accent"
                          size={18}
                          weight="duotone"
                        />
                        <p>{chapter.tip}</p>
                      </div>
                    ) : null}
                  </div>
                </section>
              ))}

              <footer className="border-b border-app-line py-14 sm:py-20">
                <p className="font-mono text-[0.68rem] font-semibold tracking-[0.14em] text-app-faint uppercase">
                  没有找到答案？
                </p>
                <div className="mt-4 grid gap-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div>
                    <h2 className="max-w-3xl text-2xl font-extrabold tracking-[-0.025em] text-app-ink sm:text-3xl">
                      把页面提示和操作步骤告诉我们
                    </h2>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-app-muted">
                      附上所在页面、刚刚执行的操作、页面显示的错误信息和截图，可以更快定位问题。
                    </p>
                  </div>
                  <a
                    href={githubIssues}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-app-ink px-5 text-sm font-semibold text-app-on-accent transition-colors hover:bg-app-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                  >
                    提交问题
                    <ArrowRight aria-hidden="true" size={14} weight="bold" />
                  </a>
                </div>
              </footer>
            </div>
          </div>
        </article>
      </main>
    </>
  )
}
