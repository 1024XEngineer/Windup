import { StatusPanel } from './status-panel'

import type { PlaytestInspectionStatus } from '@/entities/playtest-inspection'

export interface AcceptanceProps {
  inspectionStatus: PlaytestInspectionStatus | null
  available: boolean
  loading: boolean
  saving: boolean
  error: string | null
  onRecordStatus(status: PlaytestInspectionStatus): Promise<void>
}

function statusText(status: PlaytestInspectionStatus | null): string {
  if (status === 'passed') return '通过'
  if (status === 'issues_found') return '发现问题'
  return '尚未核验'
}

/** Playtest 自己的动作核验结论，不写回 Character 或创作历史。 */
export function Acceptance({
  inspectionStatus,
  available,
  loading,
  saving,
  error,
  onRecordStatus,
}: AcceptanceProps) {
  const detail = !available
    ? '当前预览未连接核验记录'
    : loading
      ? '正在读取核验记录'
      : saving
        ? '正在保存核验记录'
        : error
          ? error
          : inspectionStatus === null
            ? '尚未保存核验结论'
            : '已保存到 Playtest 核验记录'

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
        title="Playtest 核验记录"
        tone={inspectionStatus === 'issues_found' ? 'warning' : 'neutral'}
      >
        <p>{statusText(inspectionStatus)}</p>
        <p className="mt-1 text-xs">{detail}</p>
      </StatusPanel>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!available || loading || saving}
          onClick={() => void onRecordStatus('passed')}
          className="rounded-lg bg-emerald-900 px-3 py-2 text-xs font-semibold text-white"
        >
          核验通过
        </button>
        <button
          type="button"
          disabled={!available || loading || saving}
          onClick={() => void onRecordStatus('issues_found')}
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
        >
          发现问题
        </button>
      </div>
    </section>
  )
}
