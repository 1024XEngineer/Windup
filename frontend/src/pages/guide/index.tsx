import { ArrowRight, Lifebuoy, PaperPlaneTilt } from '@phosphor-icons/react'
import { Link } from 'react-router'

import assetLibraryArtwork from '@/assets/workspace/asset-library.png'
import playtestArtwork from '@/assets/workspace/playtest.png'
import workflowArtwork from '@/assets/workspace/workflow.png'
import { MarketingHeader } from '@/pages/landing/marketing-header'
import { guideChapters } from './content'

const githubIssues = 'https://github.com/1024XEngineer/Windup/issues'

const quickLinks = [
  { label: '开始创建角色', to: '/quick-start' },
  { label: '查看项目资产', to: '/projects' },
  { label: '进入预览台', to: '/playtest' },
] as const

const chapterArtwork: Partial<Record<string, { src: string; alt: string; caption: string }>> = {
  'workflow-editor': {
    src: workflowArtwork,
    alt: '工作流编辑器对应的织机像素画',
    caption: '工作流把角色母版、动作首帧、完整动画和审核结果留在同一条制作线上。',
  },
  assets: {
    src: assetLibraryArtwork,
    alt: '项目资产对应的素材册像素画',
    caption: '项目资产保存角色、造型、动作和每一帧，之后可以继续制作或导出。',
  },
  playtest: {
    src: playtestArtwork,
    alt: '预览台对应的逐帧播放器像素画',
    caption: '预览台读取项目中真实保存的动作帧，用来检查移动方向和播放衔接。',
  },
}

function QuickStartComposerPreview() {
  return (
    <div className="my-7">
      <p className="mb-3 text-xs font-semibold text-app-faint">Quick Start 输入示例</p>
      <div className="relative rounded-app-surface border border-app-line-strong bg-app-surface-raised shadow-app-panel transition-[border-color,box-shadow] focus-within:border-app-accent focus-within:shadow-[var(--shadow-app-composer-focus)]">
        <label className="relative block min-h-[52px] min-w-0 overflow-hidden">
          <span className="sr-only">创作指令示例</span>
          <textarea
            rows={2}
            readOnly
            aria-label="创作指令示例"
            value="年轻的港口信使，短银发，深蓝短外套和红围巾，全身像，适合 2D RPG。"
            className="block min-h-[76px] w-full min-w-0 resize-none border-0 bg-transparent py-[14px] pr-16 pl-4 text-[15px] leading-6 text-app-ink outline-none"
          />
        </label>
        <Link
          to="/quick-start"
          aria-label="打开 Quick Start"
          className="absolute right-[8px] bottom-[8px] grid size-10 place-items-center rounded-full border-0 bg-app-accent text-app-canvas transition-[transform,background] duration-150 hover:-translate-y-px hover:bg-app-accent-hover active:scale-95"
        >
          <PaperPlaneTilt aria-hidden="true" size={17} weight="fill" />
        </Link>
      </div>
      <p className="mt-2 text-xs leading-5 text-app-faint">
        写清身份、外形、服装、配色和整体气质，再发送给 Windup。
      </p>
    </div>
  )
}

export function GuidePage() {
  return (
    <>
      <MarketingHeader />
      <main className="min-h-[100dvh] bg-app-canvas pb-20 pt-28 text-app-ink sm:pt-32">
        <article aria-labelledby="guide-title" className="w-full px-5 sm:px-8 lg:px-12 xl:px-16">
          <header className="grid border-b border-app-line pb-9 md:grid-cols-[13.5rem_minmax(0,1fr)] md:gap-12 xl:gap-16">
            <div className="hidden md:block" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold tracking-[0.08em] text-app-faint">使用指南</p>
              <h1
                id="guide-title"
                className="mt-3 text-[2.25rem] leading-[1.16] font-extrabold tracking-[-0.035em] text-app-ink sm:text-[2.75rem]"
              >
                Windup 使用指南
              </h1>
              <p className="mt-4 max-w-4xl text-base leading-7 text-app-muted">
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
            </div>
          </header>

          <div className="grid gap-10 pt-8 md:grid-cols-[13.5rem_minmax(0,1fr)] md:gap-12 xl:gap-16">
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
                  <p className="mt-3 max-w-[52rem] text-[15px] leading-7 text-app-muted">
                    {chapter.summary}
                  </p>

                  {chapter.id === 'quick-start' ? <QuickStartComposerPreview /> : null}

                  {chapterArtwork[chapter.id] ? (
                    <figure className="my-7 grid items-center gap-5 border-y border-app-line py-5 sm:grid-cols-[11rem_minmax(0,1fr)]">
                      <img
                        src={chapterArtwork[chapter.id]?.src}
                        alt={chapterArtwork[chapter.id]?.alt}
                        className="mx-auto h-36 w-36 object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <figcaption className="text-sm leading-7 text-app-muted">
                        {chapterArtwork[chapter.id]?.caption}
                      </figcaption>
                    </figure>
                  ) : null}

                  {chapter.action ? (
                    <Link
                      to={chapter.action.to}
                      className="mt-4 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-app-accent underline decoration-app-line-strong underline-offset-4 transition-colors hover:text-app-accent-hover focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                    >
                      {chapter.action.label}
                      <ArrowRight aria-hidden="true" size={13} weight="bold" />
                    </Link>
                  ) : null}

                  <div className="mt-7 space-y-7">
                    {chapter.topics.map((topic, topicIndex) => (
                      <div
                        key={topic.title}
                        id={`${chapter.id}-${topicIndex + 1}`}
                        className="space-y-2"
                      >
                        <h3 className="text-base font-bold leading-6 text-app-ink-soft">
                          {topic.title}
                        </h3>
                        <p className="text-sm leading-7 text-app-muted">{topic.description}</p>
                        {topic.bullets?.map((bullet) => (
                          <p key={bullet} className="text-sm leading-7 text-app-ink-soft">
                            {bullet}
                          </p>
                        ))}
                        {topic.example ? (
                          <p className="border-l-2 border-app-line-strong pl-3 text-[13px] leading-6 text-app-ink-soft">
                            <span className="mr-2 font-semibold text-app-faint">例如</span>
                            {topic.example}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>

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
