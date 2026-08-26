import { ArrowRight, CheckCircle, Lifebuoy } from '@phosphor-icons/react'
import { Link } from 'react-router'

import { MarketingHeader } from '@/pages/landing/marketing-header'
import { guideChapters } from './content'

const githubIssues = 'https://github.com/1024XEngineer/Windup/issues'

const quickLinks = [
  { label: '开始创建角色', to: '/quick-start' },
  { label: '查看项目资产', to: '/projects' },
  { label: '进入预览台', to: '/playtest' },
] as const

export function GuidePage() {
  return (
    <>
      <MarketingHeader />
      <main className="min-h-[100dvh] bg-app-canvas pb-20 pt-28 text-app-ink sm:pt-32">
        <article
          aria-labelledby="guide-title"
          className="mx-auto w-full max-w-[78rem] px-5 sm:px-8 lg:px-10"
        >
          <header className="border-b border-app-line pb-9">
            <p className="text-xs font-semibold tracking-[0.08em] text-app-faint">使用指南</p>
            <h1
              id="guide-title"
              className="mt-3 text-[2.25rem] leading-[1.16] font-extrabold tracking-[-0.035em] text-app-ink sm:text-[2.75rem]"
            >
              Windup 使用指南
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-app-muted">
              从建立项目开始，完成角色母版、方向首帧和动作，再到预览与导出。这份指南按实际制作顺序说明每一步。
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                to="/quick-start"
                className="inline-flex min-h-10 items-center gap-2 rounded-app-control bg-app-accent px-4 text-sm font-semibold text-app-on-accent transition-colors hover:bg-app-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              >
                开始创建角色
                <ArrowRight aria-hidden="true" size={15} weight="bold" />
              </Link>
              <Link
                to="/workspace"
                className="inline-flex min-h-10 items-center text-sm font-medium text-app-muted underline decoration-app-line-strong underline-offset-4 transition-colors hover:text-app-accent focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              >
                返回工作台
              </Link>
            </div>
          </header>

          <div className="grid gap-10 pt-8 md:grid-cols-[12.5rem_minmax(0,45rem)] md:justify-center md:gap-10 xl:grid-cols-[13.5rem_minmax(0,45rem)] xl:gap-16">
            <aside className="md:sticky md:top-28 md:self-start md:border-r md:border-app-line md:pr-7 xl:pr-8">
              <nav aria-label="使用指南章节">
                <p className="text-xs font-semibold text-app-ink-soft">本页内容</p>
                <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4 md:grid-cols-1">
                  {guideChapters.map((chapter) => (
                    <li key={chapter.id}>
                      <a
                        href={`#${chapter.id}`}
                        className="group flex min-h-9 items-center gap-2.5 py-1.5 text-[13px] leading-5 text-app-muted transition-colors hover:text-app-accent focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
                      >
                        <span aria-hidden="true" className="font-mono text-[10px] text-app-faint">
                          {chapter.index}
                        </span>
                        <span>{chapter.navLabel}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>

              <div className="mt-7 hidden border-t border-app-line pt-5 md:block">
                <p className="text-xs font-semibold text-app-ink-soft">快速入口</p>
                <ul className="mt-2 space-y-0.5">
                  {quickLinks.map((link) => (
                    <li key={link.to}>
                      <Link
                        to={link.to}
                        className="inline-flex min-h-8 items-center gap-1.5 text-[13px] text-app-muted transition-colors hover:text-app-accent focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
                      >
                        {link.label}
                        <ArrowRight aria-hidden="true" size={12} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>

            <div className="min-w-0">
              {guideChapters.map((chapter) => (
                <section
                  key={chapter.id}
                  id={chapter.id}
                  aria-labelledby={`${chapter.id}-title`}
                  className="scroll-mt-28 border-b border-app-line py-10 first:pt-0"
                >
                  <p className="font-mono text-[11px] font-medium tracking-[0.06em] text-app-faint">
                    {chapter.index}
                  </p>
                  <h2
                    id={`${chapter.id}-title`}
                    className="mt-2 text-[1.65rem] leading-tight font-bold tracking-[-0.025em] text-app-ink sm:text-[1.85rem]"
                  >
                    {chapter.title}
                  </h2>
                  <p className="mt-3 max-w-[42rem] text-[15px] leading-7 text-app-muted">
                    {chapter.summary}
                  </p>

                  {chapter.action ? (
                    <Link
                      to={chapter.action.to}
                      className="mt-4 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-app-accent underline decoration-app-line-strong underline-offset-4 transition-colors hover:text-app-accent-hover focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                    >
                      {chapter.action.label}
                      <ArrowRight aria-hidden="true" size={13} weight="bold" />
                    </Link>
                  ) : null}

                  <ol className="mt-7 space-y-7">
                    {chapter.topics.map((topic, topicIndex) => (
                      <li
                        key={topic.title}
                        className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-app-line-strong font-mono text-[10px] text-app-faint"
                        >
                          {topicIndex + 1}
                        </span>
                        <div>
                          <h3 className="text-base font-bold leading-6 text-app-ink-soft">
                            {topic.title}
                          </h3>
                          <p className="mt-1.5 text-sm leading-6 text-app-muted">
                            {topic.description}
                          </p>
                          {topic.bullets ? (
                            <ul className="mt-3 space-y-2">
                              {topic.bullets.map((bullet) => (
                                <li
                                  key={bullet}
                                  className="flex gap-2.5 text-sm leading-6 text-app-ink-soft"
                                >
                                  <CheckCircle
                                    aria-hidden="true"
                                    className="mt-1 shrink-0 text-app-accent"
                                    size={15}
                                    weight="fill"
                                  />
                                  <span>{bullet}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {topic.example ? (
                            <div className="mt-3 border-l-2 border-app-line-strong pl-3">
                              <p className="text-[13px] leading-6 text-app-ink-soft">
                                <span className="mr-2 font-semibold text-app-faint">示例</span>
                                {topic.example}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>

                  {chapter.tip ? (
                    <div className="mt-7 flex gap-3 border-l-2 border-app-accent bg-app-accent-muted px-4 py-3 text-sm leading-6 text-app-ink-soft">
                      <Lifebuoy
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-app-accent"
                        size={17}
                        weight="duotone"
                      />
                      <p>
                        <span className="mr-2 font-semibold text-app-accent">注意</span>
                        {chapter.tip}
                      </p>
                    </div>
                  ) : null}
                </section>
              ))}

              <footer className="py-10">
                <h2 className="text-xl font-bold tracking-[-0.02em] text-app-ink">还没有解决？</h2>
                <p className="mt-2 max-w-[40rem] text-sm leading-6 text-app-muted">
                  提交问题时附上所在页面、刚刚执行的操作、错误提示和截图，我们会更快定位原因。
                </p>
                <a
                  href={githubIssues}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-app-control border border-app-line-strong bg-app-surface-raised px-4 text-sm font-semibold text-app-ink-soft transition-colors hover:border-app-accent hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                >
                  提交问题
                  <ArrowRight aria-hidden="true" size={13} weight="bold" />
                </a>
              </footer>
            </div>
          </div>
        </article>
      </main>
    </>
  )
}
