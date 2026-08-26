export type PixelPerfectVersion = 'original' | 'pixel-perfect'

export function PixelPerfectVersionSwitch({
  value,
  onChange,
}: {
  value: PixelPerfectVersion
  onChange: (value: PixelPerfectVersion) => void
}) {
  return (
    <div
      data-pixel-perfect-comparison
      className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border border-app-line bg-app-surface-muted p-1"
    >
      <button
        type="button"
        aria-pressed={value === 'original'}
        onClick={() => onChange('original')}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          value === 'original'
            ? 'bg-app-surface-raised text-app-ink shadow-sm'
            : 'text-app-muted hover:text-app-ink'
        }`}
      >
        查看原图
      </button>
      <button
        type="button"
        aria-pressed={value === 'pixel-perfect'}
        onClick={() => onChange('pixel-perfect')}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          value === 'pixel-perfect'
            ? 'bg-app-surface-raised text-app-ink shadow-sm'
            : 'text-app-muted hover:text-app-ink'
        }`}
      >
        查看完美像素版
      </button>
    </div>
  )
}
