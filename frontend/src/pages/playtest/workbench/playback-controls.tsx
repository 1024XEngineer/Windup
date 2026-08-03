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
      className="grid h-9 w-9 place-items-center rounded-md border border-white/15 bg-white/6 text-sm text-white hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-35"
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
  const keyboardStatus = `跳跃${jumpAvailable ? '可用' : '不可用'}，下蹲${crouchAvailable ? '可用' : '不可用'}`

  return (
    <section
      aria-label="播放控制"
      className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-lg bg-[#252a27] px-2 py-1.5 text-white"
    >
      <span className="sr-only">{keyboardStatus}</span>
      <ControlButton label="第一帧" text="|‹" disabled={disabled} onPress={onFirstFrame} />
      <ControlButton label="上一帧" text="‹" disabled={disabled} onPress={onPreviousFrame} />
      <button
        type="button"
        aria-label={playing ? '暂停' : '播放'}
        disabled={disabled}
        onClick={onTogglePlaying}
        className="grid h-9 w-12 place-items-center rounded-md bg-[#dce9df] text-sm font-semibold text-[#24402d] hover:bg-[#cce0d1] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
      </button>
      <ControlButton label="下一帧" text="›" disabled={disabled} onPress={onNextFrame} />
      <ControlButton label="最后一帧" text="›|" disabled={disabled} onPress={onLastFrame} />
      <span className="ml-1 border-l border-white/15 pl-2 text-[11px] tabular-nums text-white/80">
        {frameCount === 0
          ? '00 / 00'
          : `${String(frameIndex + 1).padStart(2, '0')} / ${String(frameCount).padStart(2, '0')}`}
      </span>
      <span className="ml-auto text-[9px] font-semibold text-white/45">{fps || '—'} FPS</span>
      <button
        type="button"
        aria-label="循环播放"
        aria-pressed={loop}
        onClick={onToggleLoop}
        className={`grid h-9 w-9 place-items-center rounded-md border text-base ${
          loop ? 'border-[#a7c5ae] bg-[#dce9df] text-[#24402d]' : 'border-white/15 text-white/55'
        }`}
      >
        <span aria-hidden="true">↻</span>
      </button>
    </section>
  )
}
