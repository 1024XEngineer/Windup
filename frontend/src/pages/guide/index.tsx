import { ArrowRight, CheckCircle, Lifebuoy } from '@phosphor-icons/react'
import { Link } from 'react-router'

import { MarketingHeader } from '@/pages/landing/marketing-header'
import { guideChapters } from './content'

const githubIssues = 'https://github.com/1024XEngineer/Windup/issues'

export function GuidePage() {
  return (
    <>
      <MarketingHeader />
      <main className="relative isolate overflow-hidden bg-[#f6f8f3] pb-24 pt-32 text-[#1d2920] sm:pt-40">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] bg-[radial-gradient(circle_at_18%_10%,rgba(176,202,167,0.38),transparent_36%),radial-gradient(circle_at_83%_22%,rgba(223,194,145,0.28),transparent_34%)]"
        />

        <section className="mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-12">
          <div className="max-w-4xl border-l border-[#8aa181] pl-5 sm:pl-8">
            <p className="text-xs font-semibold tracking-[0.24em] text-[#59705b] uppercase">
              Product guide · 产品指南
            </p>
            <h1 className="mt-5 max-w-3xl font-serif text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-[#18251c] sm:text-6xl">
              Windup 使用手册
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[#526056] sm:text-lg">
              从第一个角色描述，到多方向动作、浏览器试玩和资产导出。这份手册只讲当前产品里真正可以完成的流程。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/workspace"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#1d2920] px-5 text-sm font-semibold text-[#f8faf5] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#526e4e]"
              >
                进入工作台
                <ArrowRight aria-hidden="true" size={16} weight="bold" />
              </Link>
              <a
                href="#getting-started"
                className="inline-flex min-h-11 items-center rounded-lg border border-[#b8c5b5] bg-white/45 px-5 text-sm font-semibold text-[#334439] transition-colors hover:bg-white/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#526e4e]"
              >
                从第一次使用开始
              </a>
            </div>
          </div>
        </section>

        <div className="mx-auto mt-16 grid w-full max-w-[82rem] gap-10 px-5 sm:px-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-12 xl:gap-16">
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <nav
              aria-label="使用手册目录"
              className="rounded-2xl border border-[#cfd8cb] bg-white/55 p-4 shadow-[0_18px_55px_rgba(40,57,43,0.06)] backdrop-blur-sm"
            >
              <p className="px-3 pb-3 text-xs font-semibold tracking-[0.18em] text-[#718174] uppercase">
                快速定位
              </p>
              <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">
                {guideChapters.map((chapter) => (
                  <li key={chapter.id}>
                    <a
                      href={`#${chapter.id}`}
                      className="group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#536158] transition-colors hover:bg-[#eaf0e6] hover:text-[#26372b] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#526e4e]"
                    >
                      <span
                        aria-hidden="true"
                        className="font-mono text-[0.68rem] text-[#8c9b8f] group-hover:text-[#607661]"
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

          <article className="min-w-0 space-y-8">
            {guideChapters.map((chapter) => (
              <section
                key={chapter.id}
                id={chapter.id}
                aria-labelledby={`${chapter.id}-title`}
                className="scroll-mt-28 overflow-hidden rounded-[1.75rem] border border-[#d4ddd0] bg-[rgba(255,255,252,0.76)] shadow-[0_24px_75px_rgba(43,59,46,0.07)]"
              >
                <header className="grid gap-5 border-b border-[#dbe3d8] px-6 py-7 sm:px-9 sm:py-9 md:grid-cols-[4rem_1fr]">
                  <span className="font-serif text-3xl text-[#91a18f]" aria-hidden="true">
                    {chapter.index}
                  </span>
                  <div>
                    <p className="text-xs font-semibold tracking-[0.18em] text-[#667b68] uppercase">
                      {chapter.navLabel}
                    </p>
                    <h2
                      id={`${chapter.id}-title`}
                      className="mt-2 font-serif text-2xl leading-tight font-semibold tracking-[-0.02em] text-[#1c2b21] sm:text-3xl"
                    >
                      {chapter.title}
                    </h2>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-[#5b685f] sm:text-base">
                      {chapter.summary}
                    </p>
                  </div>
                </header>

                <div className="grid gap-px bg-[#e1e7df] sm:grid-cols-2">
                  {chapter.topics.map((topic) => (
                    <div key={topic.title} className="bg-[#fbfcf8] p-6 sm:p-8">
                      <h3 className="font-serif text-lg font-semibold text-[#243329]">
                        {topic.title}
                      </h3>
                      <p className="mt-3 text-sm leading-7 text-[#5b685f]">{topic.description}</p>
                      {topic.bullets ? (
                        <ul className="mt-4 space-y-2.5">
                          {topic.bullets.map((bullet) => (
                            <li
                              key={bullet}
                              className="flex gap-2.5 text-sm leading-6 text-[#465349]"
                            >
                              <CheckCircle
                                aria-hidden="true"
                                className="mt-1 shrink-0 text-[#6d876c]"
                                size={16}
                                weight="fill"
                              />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {topic.example ? (
                        <p className="mt-5 rounded-xl border border-[#d8e0d5] bg-[#f0f4ed] px-4 py-3 font-mono text-xs leading-6 text-[#455549]">
                          {topic.example}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>

                {chapter.note ? (
                  <div className="flex gap-3 border-t border-[#dbe3d8] bg-[#edf2e9] px-6 py-5 text-sm leading-6 text-[#445249] sm:px-9">
                    <Lifebuoy
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-[#688167]"
                      size={20}
                      weight="duotone"
                    />
                    <p>{chapter.note}</p>
                  </div>
                ) : null}
              </section>
            ))}

            <section className="rounded-[1.75rem] bg-[#1d2920] px-6 py-8 text-[#f6f8f3] sm:px-9 sm:py-10">
              <p className="text-xs font-semibold tracking-[0.2em] text-[#afc2ad] uppercase">
                仍然遇到问题？
              </p>
              <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-serif text-2xl font-semibold">
                    带着具体页面和错误信息来找我们
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-[#cad5c8]">
                    请说明所在页面、操作步骤、预期结果和实际提示。涉及生成任务时一并附上任务 ID。
                  </p>
                </div>
                <a
                  href={githubIssues}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#f6f8f3] px-5 text-sm font-semibold text-[#1d2920] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d7e4d3]"
                >
                  提交问题
                  <ArrowRight aria-hidden="true" size={16} weight="bold" />
                </a>
              </div>
            </section>
          </article>
        </div>
      </main>
    </>
  )
}
