import { useState } from 'react'

import type { PlaytestPreviewModel } from '../model/types'
import {
  createAssetExportPlan,
  exportGameAssets,
  type AssetExportPhase,
  type AssetExportResult,
} from './asset-export'

export type AssetExporter = (
  model: PlaytestPreviewModel,
  onPhase?: (phase: AssetExportPhase) => void,
) => Promise<AssetExportResult>

export interface ExportPanelProps {
  model: PlaytestPreviewModel
  qualityIssueCount?: number
  exporter?: AssetExporter
}

type ExportState =
  | { status: 'idle' }
  | { status: 'working'; phase: AssetExportPhase }
  | { status: 'success'; incomplete: boolean }
  | { status: 'failure' }

const PHASE_LABELS: Readonly<Record<AssetExportPhase, string>> = {
  collecting: '正在整理素材',
  rendering: '正在生成图片',
  packing: '正在打包',
}

const defaultExporter: AssetExporter = (model, onPhase) =>
  exportGameAssets(model, undefined, onPhase)

export function ExportPanel({
  model,
  qualityIssueCount = 0,
  exporter = defaultExporter,
}: ExportPanelProps) {
  const [state, setState] = useState<ExportState>({ status: 'idle' })
  const plan = createAssetExportPlan(model)
  const working = state.status === 'working'

  const startExport = async () => {
    if (working) return
    setState({ status: 'working', phase: 'collecting' })
    try {
      const result = await exporter(model, (phase) => setState({ status: 'working', phase }))
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      URL.revokeObjectURL(url)
      setState({ status: 'success', incomplete: result.incomplete })
    } catch {
      setState({ status: 'failure' })
    }
  }

  return (
    <section
      aria-label="资产导出"
      aria-busy={working}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header>
        <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">GAME ASSETS</p>
        <h2 className="mt-1 text-sm font-semibold text-slate-900">资产导出</h2>
        <p className="mt-1 text-[11px] text-slate-500">逐帧原图、Sprite Sheet 与动画 JSON</p>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-slate-500">动作方向</dt>
        <dd className="font-medium text-slate-900">{plan.length} 组</dd>
        <dt className="text-slate-500">逐帧原图</dt>
        <dd className="font-medium text-slate-900">
          {plan.reduce((total, item) => total + item.frames.length, 0)} 张
        </dd>
        <dt className="text-slate-500">每行上限</dt>
        <dd className="font-medium text-slate-900">8 帧</dd>
      </dl>

      {qualityIssueCount > 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          当前核验存在 {qualityIssueCount} 项质量问题，仍可导出
        </p>
      ) : null}

      {state.status === 'working' ? (
        <p role="status" className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {PHASE_LABELS[state.phase]}
        </p>
      ) : state.status === 'failure' ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          导出失败，可重试
        </p>
      ) : state.status === 'success' ? (
        <div className="space-y-2">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">下载完成</p>
          {state.incomplete ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              导出不完整，缺失图片已保留透明占位
            </p>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        disabled={working || plan.length === 0}
        onClick={() => void startExport()}
        className="w-full rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state.status === 'failure' ? '重新导出' : '导出游戏资产包'}
      </button>
      {plan.length === 0 ? <p className="text-xs text-slate-500">没有可导出的已确认动作</p> : null}
    </section>
  )
}
