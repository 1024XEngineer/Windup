export type AssetPreviewStatus = 'pending' | 'arrived'

export interface AssetPreviewCardProps {
  /** Short technical label, such as IDENTITY MASTER. */
  eyebrow: string
  /** User-facing asset name. */
  title: string
  /** Real asset URL. Omit it until the asset has arrived. */
  imageUrl?: string
  /** Accessible image description. Required when imageUrl is present. */
  imageAlt?: string
  /** Keeps pending output visually distinct from an arrived asset. */
  status: AssetPreviewStatus
}

/** A compact master/candidate preview extracted from the live demo result surface. */
export function AssetPreviewCard({
  eyebrow,
  title,
  imageUrl,
  imageAlt,
  status,
}: AssetPreviewCardProps) {
  const arrived = status === 'arrived' && Boolean(imageUrl)

  return (
    <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="relative grid aspect-square place-items-center overflow-hidden bg-[radial-gradient(circle_at_top,#f8fafc_0%,#e2e8f0_100%)] p-6">
        {arrived ? (
          <img
            src={imageUrl}
            alt={imageAlt ?? title}
            className="h-full w-full object-contain [image-rendering:pixelated]"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid h-20 w-20 place-items-center rounded-full border border-dashed border-slate-300 bg-white/70"
          >
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-900 motion-reduce:animate-none" />
          </div>
        )}
        <span className="absolute right-3 top-3 rounded-full border border-slate-200 bg-white/90 px-2 py-1 text-[10px] font-semibold tracking-[0.18em] text-slate-500">
          {arrived ? 'READY' : 'WAITING'}
        </span>
      </div>
      <figcaption className="border-t border-slate-100 px-4 py-3">
        <span className="block text-[10px] font-semibold tracking-[0.18em] text-slate-400">
          {eyebrow}
        </span>
        <strong className="mt-1 block text-sm font-semibold text-slate-900">{title}</strong>
      </figcaption>
    </figure>
  )
}
