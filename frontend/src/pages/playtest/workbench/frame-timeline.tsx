import type { PreviewSequence } from './model/types'

export interface FrameTimelineProps {
  sequence: PreviewSequence | null
  currentFrameIndex: number
  onSelectFrame(index: number): void
}

export function FrameTimeline({ sequence, currentFrameIndex, onSelectFrame }: FrameTimelineProps) {
  const frames = sequence?.frames ?? []

  return (
    <section aria-label="逐帧时间线" className="rounded-lg border border-[#d2d8d3] bg-white p-2">
      <header className="mb-2 flex items-center justify-between gap-4 px-1">
        <strong className="text-[10px] text-[#59635b]">逐帧</strong>
        <span className="font-mono text-[9px] text-[#7a827c]">{frames.length} FRAMES</span>
      </header>
      {frames.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          当前方向没有帧
        </p>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {frames.map((frame, index) => (
            <button
              key={`${frame.imageUrl}-${index}`}
              type="button"
              aria-label={`第 ${index + 1} 帧`}
              aria-pressed={index === currentFrameIndex}
              onClick={() => onSelectFrame(index)}
              className={`w-20 shrink-0 overflow-hidden rounded-md border p-1 text-left transition-colors ${
                index === currentFrameIndex
                  ? 'border-emerald-900 bg-emerald-50'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-400'
              }`}
            >
              <span className="grid aspect-square place-items-center rounded-md bg-white">
                <img
                  src={frame.imageUrl}
                  alt=""
                  className="h-full w-full object-contain p-1 [image-rendering:pixelated]"
                />
              </span>
              <span className="mt-1.5 block px-1 text-[10px]">
                <strong className="block">#{String(index + 1).padStart(2, '0')}</strong>
                <span className="mt-1 flex flex-wrap gap-1 text-[9px] text-slate-500">
                  {frame.keyFrame ? (
                    <span className="rounded bg-amber-100 px-1 text-amber-800">关键帧</span>
                  ) : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
