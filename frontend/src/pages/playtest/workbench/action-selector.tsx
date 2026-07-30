import type { PreviewAction } from './model/types'

export interface ActionSelectorProps {
  actions: readonly PreviewAction[]
  selectedActionId: string | null
  onSelectAction(actionId: string): void
}

function frameCount(action: PreviewAction): number {
  return action.sequences.reduce((total, sequence) => total + sequence.frames.length, 0)
}

export function ActionSelector({ actions, selectedActionId, onSelectAction }: ActionSelectorProps) {
  return (
    <aside
      aria-label="动作列表"
      className="h-full overflow-y-auto border-r border-slate-200 bg-[#171918] p-3 text-white"
    >
      <p className="text-[10px] font-semibold tracking-[0.18em] text-white/35">动作实例</p>
      <div className="mt-3 space-y-2">
        {actions.map((action) => {
          const count = frameCount(action)
          const selected = action.id === selectedActionId

          return (
            <button
              key={action.id}
              type="button"
              aria-pressed={selected}
              disabled={count === 0}
              onClick={() => onSelectAction(action.id)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors ${
                selected
                  ? 'border-white/25 bg-white/12 text-white'
                  : 'border-transparent text-white/65 hover:bg-white/5 hover:text-white'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span>
                <strong className="block text-sm">{action.name}</strong>
                <span className="mt-1 block text-[10px] uppercase text-white/45">
                  {action.fps} FPS
                </span>
              </span>
              <span className="text-xs tabular-nums text-emerald-300">{count} 帧</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
