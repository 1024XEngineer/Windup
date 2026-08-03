export interface FrameArrival {
  /** Stable identity from the task event or artifact snapshot. */
  id: string
  /** Real asset URL. Omit it while the frame is pending. */
  imageUrl?: string
  /** Optional accessible description for this frame. */
  imageAlt?: string
}

export interface FrameArrivalStripProps {
  /** Visible label for the action sequence. */
  label: string
  /** Optional technical metadata, such as SIDE / WALK. */
  eyebrow?: string
  /** Ordered frame slots. Pending slots stay visible instead of collapsing. */
  frames: readonly FrameArrival[]
}

/** Shows every intermediate frame arrival rather than replacing a single preview image. */
export function FrameArrivalStrip({ label, eyebrow, frames }: FrameArrivalStripProps) {
  const received = frames.filter((frame) => Boolean(frame.imageUrl)).length

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label={label}>
      <header className="mb-3 flex items-end justify-between gap-4">
        <div>
          {eyebrow ? (
            <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">{eyebrow}</p>
          ) : null}
          <h3 className="mt-1 text-sm font-semibold text-slate-900">{label}</h3>
        </div>
        <p className="text-xs font-medium tabular-nums text-slate-500" aria-live="polite">
          {received} / {frames.length}
        </p>
      </header>

      <ol className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {frames.map((frame, index) => {
          const arrived = Boolean(frame.imageUrl)
          const number = String(index + 1).padStart(2, '0')

          return (
            <li
              key={frame.id}
              className={`relative aspect-square overflow-hidden rounded-lg border ${
                arrived
                  ? 'border-slate-200 bg-slate-50'
                  : 'border-dashed border-slate-300 bg-slate-50/60'
              }`}
            >
              {arrived ? (
                <img
                  src={frame.imageUrl}
                  alt={frame.imageAlt ?? `${label} 第 ${index + 1} 帧`}
                  className="h-full w-full object-contain p-1 [image-rendering:pixelated]"
                />
              ) : (
                <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-300 motion-reduce:animate-none" />
                </span>
              )}
              <span className="absolute bottom-1 right-1 rounded bg-white/90 px-1 text-[9px] font-semibold tabular-nums text-slate-500">
                {number}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
