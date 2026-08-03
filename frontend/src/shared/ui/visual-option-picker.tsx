export interface VisualOption {
  id: string
  label: string
  eyebrow?: string
  imageUrl?: string
}

export interface VisualOptionPickerProps {
  label: string
  selectedId?: string | null
  options: readonly VisualOption[]
  onSelect: (id: string) => void
}

/** Controlled image choice grid for characters, references, or candidate assets. */
export function VisualOptionPicker({
  label,
  selectedId,
  options,
  onSelect,
}: VisualOptionPickerProps) {
  return (
    <div aria-label={label} role="group" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {options.map((option) => {
        const selected = option.id === selectedId
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(option.id)}
            className={`group min-w-0 overflow-hidden rounded-xl border bg-white p-2 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
              selected
                ? 'border-slate-900 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.55)]'
                : 'border-slate-200 hover:-translate-y-0.5 hover:border-slate-400'
            }`}
          >
            <span className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-[linear-gradient(145deg,#f8fafc,#e2e8f0)]">
              {option.imageUrl ? (
                <img
                  src={option.imageUrl}
                  alt=""
                  className="h-full w-full object-contain p-2 transition-transform group-hover:scale-105 [image-rendering:pixelated]"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-8 w-8 rounded-full border border-dashed border-slate-300"
                />
              )}
            </span>
            {option.eyebrow ? (
              <span className="mt-2 block truncate text-[9px] font-semibold tracking-[0.14em] text-slate-400">
                {option.eyebrow}
              </span>
            ) : null}
            <span className="mt-1 block truncate text-xs font-semibold text-slate-800">
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
