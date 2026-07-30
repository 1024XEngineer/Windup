export interface PlaybackControlsProps {
  playing: boolean
  loop: boolean
  frameIndex: number
  frameCount: number
  fps: number
  jumpAvailable: boolean
  crouchAvailable: boolean
  onFirstFrame(): void
  onPreviousFrame(): void
  onTogglePlaying(): void
  onNextFrame(): void
  onLastFrame(): void
  onToggleLoop(): void
}

function AvailabilityBadge({ available, label }: { available: boolean; label: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
        available
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      {label}
    </span>
  )
}

interface ControlButtonProps {
  label: string
  text: string
  disabled?: boolean
  onPress(): void
}

function ControlButton({ label, text, disabled = false, onPress }: ControlButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-sm hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {text}
    </button>
  )
}

export function PlaybackControls({
  playing,
  loop,
  frameIndex,
  frameCount,
  fps,
  jumpAvailable,
  crouchAvailable,
  onFirstFrame,
  onPreviousFrame,
  onTogglePlaying,
  onNextFrame,
  onLastFrame,
  onToggleLoop,
}: PlaybackControlsProps) {
  const disabled = frameCount === 0

  return (
    <section
      aria-label="播放控制"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      <ControlButton label="第一帧" text="|‹" disabled={disabled} onPress={onFirstFrame} />
      <ControlButton label="上一帧" text="‹" disabled={disabled} onPress={onPreviousFrame} />
      <button
        type="button"
        aria-label={playing ? '暂停' : '播放'}
        disabled={disabled}
        onClick={onTogglePlaying}
        className="min-w-20 rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {playing ? '暂停' : '播放'}
      </button>
      <ControlButton label="下一帧" text="›" disabled={disabled} onPress={onNextFrame} />
      <ControlButton label="最后一帧" text="›|" disabled={disabled} onPress={onLastFrame} />
      <span className="ml-1 border-l border-slate-200 pl-3 text-xs tabular-nums">
        {frameCount === 0
          ? '00 / 00'
          : `${String(frameIndex + 1).padStart(2, '0')} / ${String(frameCount).padStart(2, '0')}`}
      </span>
      <span className="ml-auto text-[10px] font-semibold text-slate-500">FPS {fps || '—'}</span>
      <button
        type="button"
        aria-pressed={loop}
        onClick={onToggleLoop}
        className={`rounded-lg border px-3 py-2 text-[10px] font-semibold ${
          loop ? 'border-emerald-900 bg-emerald-950 text-white' : 'border-slate-200 text-slate-500'
        }`}
      >
        循环
      </button>
      <div className="flex w-full flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
          <span>A 左行走</span>
          <span>D 右行走</span>
          <span>W 跳跃</span>
          <span>S 下蹲</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <AvailabilityBadge
            available={jumpAvailable}
            label={jumpAvailable ? '跳跃动作可用' : '未提供跳跃动作'}
          />
          <AvailabilityBadge
            available={crouchAvailable}
            label={crouchAvailable ? '下蹲动作可用' : '未提供下蹲动作'}
          />
        </div>
      </div>
    </section>
  )
}
