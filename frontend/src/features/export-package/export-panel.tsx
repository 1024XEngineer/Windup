import { useState } from 'react'

import type { ExportPackageModel } from './model'
import {
  createAssetExportPlan,
  exportGameAssets,
  type AssetExportPhase,
  type AssetExportResult,
} from './asset-export'

export type AssetExporter = (
  model: ExportPackageModel,
  onPhase?: (phase: AssetExportPhase) => void,
) => Promise<AssetExportResult>

export interface ExportPanelProps {
  model: ExportPackageModel
  qualityIssueCount?: number
  exporter?: AssetExporter
}

export interface ExportButtonProps {
  model: ExportPackageModel
  exporter?: AssetExporter
  className?: string
}

type ExportState =
  | { status: 'idle' }
  | { status: 'working'; phase: AssetExportPhase }
  | { status: 'success' }
  | { status: 'failure'; message: string }

const PHASE_LABELS: Readonly<Record<AssetExportPhase, string>> = {
  validating: '正在检查导出条件',
  collecting: '正在整理素材',
  rendering: '正在生成图片',
  packing: '正在打包',
}

const STAGE_LABELS: Readonly<Record<ExportPackageModel['stage'], string>> = {
  character: '角色母版',
  'first-frame': '角色母版与动作首帧',
  'action-assets': '完整动作资产',
  playtest: 'Playtest 运行包',
}

const defaultExporter: AssetExporter = (model, onPhase) => exportGameAssets(model, { onPhase })

function useExportAction(model: ExportPackageModel, exporter: AssetExporter) {
  const [state, setState] = useState<ExportState>({ status: 'idle' })
  const working = state.status === 'working'

  const startExport = async () => {
    if (working) return
    setState({ status: 'working', phase: 'validating' })
    try {
      const result = await exporter(model, (phase) => setState({ status: 'working', phase }))
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      URL.revokeObjectURL(url)
      setState({ status: 'success' })
    } catch (error) {
      setState({
        status: 'failure',
        message: error instanceof Error ? error.message : '未知错误',
      })
    }
  }

  return { state, working, startExport }
}

export function ExportPanel({
  model,
  qualityIssueCount = 0,
  exporter = defaultExporter,
}: ExportPanelProps) {
  const plan = createAssetExportPlan(model)
  const { state, working, startExport } = useExportAction(model, exporter)

  return (
    <section
      aria-label="资产导出"
      aria-busy={working}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header>
        <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">GAME ASSETS</p>
        <h2 className="mt-1 text-sm font-semibold text-slate-900">资产导出</h2>
        <p className="mt-1 text-[11px] text-slate-500">逐帧透明 PNG、Sprite Sheet 与动画 JSON</p>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-slate-500">当前阶段</dt>
        <dd className="font-medium text-slate-900">{STAGE_LABELS[model.stage]}</dd>
        <dt className="text-slate-500">已确认首帧</dt>
        <dd className="font-medium text-slate-900">{model.firstFrames.length} 张</dd>
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
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          当前有 {qualityIssueCount} 项质量问题，全部通过后才能导出
        </p>
      ) : null}

      {state.status === 'working' ? (
        <p role="status" className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {PHASE_LABELS[state.phase]}
        </p>
      ) : state.status === 'failure' ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          导出失败：{state.message}
        </p>
      ) : state.status === 'success' ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">下载完成</p>
      ) : null}

      <button
        type="button"
        disabled={working || qualityIssueCount > 0}
        onClick={() => void startExport()}
        className="w-full rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state.status === 'failure' ? '重新导出' : '导出游戏资产包'}
      </button>
      {plan.length === 0 ? <p className="text-xs text-slate-500">当前包含角色母版</p> : null}
    </section>
  )
}

export function ExportButton({
  model,
  exporter = defaultExporter,
  className = '',
}: ExportButtonProps) {
  const { state, working, startExport } = useExportAction(model, exporter)
  const label =
    state.status === 'working'
      ? PHASE_LABELS[state.phase]
      : state.status === 'failure'
        ? '重新导出'
        : state.status === 'success'
          ? '下载完成'
          : `导出${STAGE_LABELS[model.stage]}`

  return (
    <button
      type="button"
      disabled={working}
      title={state.status === 'failure' ? state.message : undefined}
      onClick={() => void startExport()}
      className={`rounded-lg border border-current px-3 py-2 text-xs font-semibold disabled:opacity-50 ${className}`}
    >
      {label}
    </button>
  )
}
