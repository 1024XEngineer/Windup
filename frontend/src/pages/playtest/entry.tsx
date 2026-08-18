import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import playtestArtwork from '@/assets/workspace/playtest.png'
import { useAuthSession } from '@/features/auth-session'

import { readRecentPreviews, type RecentPreview } from './recent-previews'

export function PlaytestEntryPage() {
  const session = useAuthSession()
  const userId = session.state.status === 'authenticated' ? session.state.user.id : null
  const [recent, setRecent] = useState<RecentPreview[]>([])

  useEffect(() => {
    setRecent(userId ? readRecentPreviews(userId) : [])
  }, [userId])

  return (
    <div className="mx-auto w-full max-w-[1560px] px-4 pb-8 pt-[clamp(4.75rem,11vh,7rem)] sm:px-6 xl:px-8">
      <section aria-labelledby="playtest-entry-title" className="pb-10">
        <header className="flex flex-col gap-4 border-b border-app-line pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1
              id="playtest-entry-title"
              className="font-serif text-[clamp(2.15rem,4.5vw,4rem)] leading-none font-medium tracking-[-0.055em] text-app-ink"
            >
              预览台
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">
              继续最近打开的角色造型，或回到项目资产库选择新的预览对象。
            </p>
          </div>
          <p className="shrink-0 pb-0.5 font-mono text-[0.68rem] text-app-faint">
            {recent.length > 0 ? `${recent.length} 条最近预览` : '等待第一次预览'}
          </p>
        </header>

        <AssetPickerEntry hasRecent={recent.length > 0} />
        {recent.length > 0 ? <RecentPreviewGrid previews={recent} /> : null}
      </section>
    </div>
  )
}

function RecentPreviewGrid({ previews }: { previews: RecentPreview[] }) {
  return (
    <section aria-labelledby="recent-preview-title" className="mt-7">
      <div className="mb-4">
        <h2
          id="recent-preview-title"
          className="text-sm font-medium tracking-[0.04em] text-app-ink"
        >
          最近预览 · {String(previews.length).padStart(2, '0')}
        </h2>
      </div>
      <div className="grid gap-x-4 gap-y-7 md:grid-cols-2 xl:grid-cols-3">
        {previews.map((preview, index) => (
          <RecentPreviewCard
            key={`${preview.characterId}:${preview.outfitId}`}
            preview={preview}
            priority={index === 0}
          />
        ))}
      </div>
    </section>
  )
}

function RecentPreviewCard({ preview, priority }: { preview: RecentPreview; priority: boolean }) {
  const label = `${preview.characterName || '未命名角色'} · ${preview.outfitName}`
  return (
    <article className="group/tile relative min-w-0">
      <Link
        to={`/playtest/${preview.characterId}/${preview.outfitId}`}
        aria-label={`继续预览 ${label}`}
        className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ink"
      >
        <div className="relative aspect-[16/10] overflow-hidden rounded-[1.25rem] border border-app-line bg-app-surface-muted transition duration-300 group-hover/tile:-translate-y-0.5 group-hover/tile:border-app-line-strong">
          {preview.previewUrl ? (
            <img
              src={preview.previewUrl}
              alt={`${label}预览图`}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              fetchPriority={priority ? 'high' : 'auto'}
              className="h-full w-full object-contain p-6 [image-rendering:pixelated] transition-transform duration-500 group-hover/tile:scale-[1.025]"
            />
          ) : (
            <div className="relative h-full overflow-hidden bg-app-surface-muted">
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-55"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, var(--color-app-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-app-line) 1px, transparent 1px)',
                  backgroundPosition: 'center center',
                  backgroundSize: '24px 24px',
                }}
              />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-app-surface/85 px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-app-faint backdrop-blur-sm">
                暂无造型预览
              </span>
            </div>
          )}
        </div>
        <div className="mt-3 flex min-w-0 items-baseline justify-between gap-4 px-0.5">
          <h3 className="min-w-0 truncate text-sm font-semibold text-app-ink">{label}</h3>
          <span className="shrink-0 truncate text-xs text-app-faint">{preview.projectName}</span>
        </div>
      </Link>
    </article>
  )
}

function AssetPickerEntry({ hasRecent }: { hasRecent: boolean }) {
  return (
    <div className="mt-5">
      <Link
        to="/projects"
        aria-label="从项目资产中选择"
        className="group relative block min-h-[13.5rem] overflow-hidden rounded-[1.5rem] border border-app-line bg-transparent p-6 transition duration-300 ease-out hover:-translate-y-0.5 hover:border-app-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ink"
      >
        <div className="relative z-10 flex h-full max-w-[18rem] flex-col">
          <h2 className="font-serif text-[clamp(1.7rem,3vw,2.5rem)] leading-none font-medium tracking-[-0.045em] text-app-ink">
            {hasRecent ? '预览其他角色' : '还没有最近预览'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-app-muted">
            {hasRecent
              ? '需要更换角色或造型时，从项目资产库继续选择；这里仅保留最近打开的预览。'
              : '从项目资产库选择一套已有造型，成功打开后可以从这里继续。'}
          </p>
          <span className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-app-ink-soft transition-colors group-hover:text-app-accent">
            {hasRecent ? '打开项目资产' : '从项目资产中选择'}
            <span aria-hidden="true">→</span>
          </span>
        </div>
        <div className="pointer-events-none absolute -right-3 top-1/2 hidden h-[13.5rem] w-[17rem] -translate-y-1/2 overflow-hidden sm:block">
          <img
            data-testid="playtest-entry-artwork"
            src={playtestArtwork}
            alt=""
            aria-hidden="true"
            draggable="false"
            className="absolute h-[17.875rem] w-[17.875rem] max-w-none translate-x-8 rotate-[5deg] object-contain opacity-65 saturate-[0.48] transition duration-500 ease-out group-hover:translate-x-7 group-hover:rotate-[4deg] group-hover:scale-[1.015] group-hover:opacity-75"
            style={{ imageRendering: 'pixelated', left: '-0.75rem', top: '-2.2rem' }}
          />
        </div>
      </Link>
      {!hasRecent ? (
        <div className="mt-3 flex justify-end">
          <Link
            to="/quick-start"
            className="text-xs font-medium text-app-muted underline decoration-app-line underline-offset-4 hover:text-app-accent"
          >
            还没有角色？开始创作
          </Link>
        </div>
      ) : null}
    </div>
  )
}
