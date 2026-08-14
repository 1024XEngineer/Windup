import type { ReactNode } from 'react'
import { Link } from 'react-router'

import assetLibraryArtwork from '@/assets/workspace/asset-library.png'
import playtestArtwork from '@/assets/workspace/playtest.png'

export type EditorialEntryArtwork = 'asset-library' | 'playtest'

export interface EditorialEntryCardProps {
  action: ReactNode
  ariaLabel: string
  artwork: EditorialEntryArtwork
  description: ReactNode
  title: ReactNode
  to: string
}

/** 产品内容页共用的横向入口卡；右侧像素物件只负责提示入口语义。 */
export function EditorialEntryCard({
  action,
  ariaLabel,
  artwork,
  description,
  title,
  to,
}: EditorialEntryCardProps) {
  const artworkUrl = artwork === 'asset-library' ? assetLibraryArtwork : playtestArtwork

  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      data-ui="editorial-entry-card"
      className="group relative block min-h-[13.5rem] overflow-hidden rounded-[1.5rem] border border-app-line bg-transparent p-6 transition duration-300 ease-out hover:-translate-y-0.5 hover:border-app-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ink"
    >
      <div className="relative z-10 flex h-full max-w-[18rem] flex-col">
        <h2 className="font-serif text-[clamp(1.7rem,3vw,2.5rem)] leading-none font-medium tracking-[-0.045em] text-app-ink">
          {title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-app-muted">{description}</p>
        <span className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-app-ink-soft transition-colors group-hover:text-app-accent">
          {action} <span aria-hidden="true">→</span>
        </span>
      </div>
      <div className="pointer-events-none absolute -right-3 top-1/2 hidden h-[13.5rem] w-[17rem] -translate-y-1/2 overflow-hidden sm:block">
        <img
          data-testid={`${artwork}-entry-artwork`}
          src={artworkUrl}
          alt=""
          aria-hidden="true"
          draggable="false"
          className="absolute h-[17.875rem] w-[17.875rem] max-w-none translate-x-8 rotate-[5deg] object-contain opacity-65 saturate-[0.48] transition duration-500 ease-out group-hover:translate-x-7 group-hover:rotate-[4deg] group-hover:scale-[1.015] group-hover:opacity-75"
          style={{ imageRendering: 'pixelated', left: '-0.75rem', top: '-2.2rem' }}
        />
      </div>
    </Link>
  )
}
