import { StatusPanel } from './status-panel'

export type PlaytestInspectionStatus = 'passed' | 'issues_found'

export interface AcceptanceProps {
  inspectionStatus: PlaytestInspectionStatus | null
  onRecordStatus(status: PlaytestInspectionStatus): void
}

function statusText(status: PlaytestInspectionStatus | null): string {
  if (status === 'passed') return '通过'
  if (status === 'issues_found') return '发现问题'
  return '尚未核验'
}

/** 本次浏览会话的临时核验结论，不写回 Character 或任何后端记录。 */
export function Acceptance({ inspectionStatus, onRecordStatus }: AcceptanceProps) {
  return (
    <section
      aria-label="核验状态"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header>
        <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">ACCEPTANCE</p>
        <h2 className="mt-1 text-sm font-semibold text-slate-900">本次核验</h2>
      </header>
      <StatusPanel
        title="会话内核验"
        tone={inspectionStatus === 'issues_found' ? 'warning' : 'neutral'}
      >
        <p>{statusText(inspectionStatus)}</p>
        <p className="mt-1 text-xs">仅保存在当前页面，不写入后端</p>
      </StatusPanel>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onRecordStatus('passed')}
          className="rounded-lg bg-emerald-900 px-3 py-2 text-xs font-semibold text-white"
        >
          核验通过
        </button>
        <button
          type="button"
          onClick={() => onRecordStatus('issues_found')}
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
        >
          发现问题
        </button>
      </div>
    </section>
  )
}
