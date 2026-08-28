import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowClockwise, Check, CircleNotch, DownloadSimple } from '@phosphor-icons/react'

import {
  productMenuItemClass,
  productPopoverClass,
  productPopoverMotionClass,
  useProductPopoverMotion,
} from '@/shared/ui'
import type { ExportPackageModel } from './model'
import { COCOS_CREATOR_TARGET } from './cocos-target'
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
  icon?: ReactNode
  idleLabel?: string
  pill?: boolean
  iconOnly?: boolean
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

const defaultExporter: AssetExporter = (model, onPhase) =>
  exportGameAssets(model, { onPhase, targets: [COCOS_CREATOR_TARGET] })

interface ExportRequest {
  model: ExportPackageModel
  filenameSuffix?: string
}

function addFilenameSuffix(filename: string, suffix?: string): string {
  if (!suffix) return filename
  const extensionIndex = filename.lastIndexOf('.')
  return extensionIndex > 0
    ? `${filename.slice(0, extensionIndex)}-${suffix}${filename.slice(extensionIndex)}`
    : `${filename}-${suffix}`
}

function useExportAction(model: ExportPackageModel, exporter: AssetExporter) {
  const [state, setState] = useState<ExportState>({ status: 'idle' })
  const working = state.status === 'working'

  const startExport = async (requests: readonly ExportRequest[] = [{ model }]) => {
    if (working) return
    setState({ status: 'working', phase: 'validating' })
    try {
      for (const request of requests) {
        const result = await exporter(request.model, (phase) =>
          setState({ status: 'working', phase }),
        )
        const url = URL.createObjectURL(result.blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = addFilenameSuffix(result.filename, request.filenameSuffix)
        anchor.click()
        URL.revokeObjectURL(url)
      }
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

export function AssetVersionExportButton({
  originalModel,
  pixelPerfectModel,
  exporter = defaultExporter,
  className = '',
}: {
  originalModel: ExportPackageModel
  pixelPerfectModel: ExportPackageModel
  exporter?: AssetExporter
  className?: string
}) {
  const { state, working, startExport } = useExportAction(originalModel, exporter)
  const menu = useProductPopoverMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const tooltipId = useId()
  const label =
    state.status === 'working'
      ? PHASE_LABELS[state.phase]
      : state.status === 'failure'
        ? '重新选择下载版本'
        : state.status === 'success'
          ? '下载完成'
          : '选择下载版本'

  useEffect(() => {
    if (!menu.expanded) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) menu.close()
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        menu.close()
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [menu])

  const choose = (requests: readonly ExportRequest[]) => {
    menu.close()
    triggerRef.current?.focus()
    void startExport(requests)
  }

  return (
    <div ref={rootRef} className="relative grid min-w-0 gap-1">
      <button
        ref={triggerRef}
        type="button"
        disabled={working}
        aria-label={label}
        aria-describedby={tooltipId}
        aria-haspopup="menu"
        aria-expanded={menu.expanded}
        aria-controls={menu.mounted ? menuId : undefined}
        title={state.status === 'failure' ? state.message : undefined}
        onClick={menu.toggle}
        className={`group/export-action relative grid size-10 shrink-0 place-items-center rounded-lg transition focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        {state.status === 'working' ? (
          <CircleNotch aria-hidden="true" size={18} weight="bold" className="animate-spin" />
        ) : state.status === 'success' ? (
          <Check aria-hidden="true" size={18} weight="bold" />
        ) : state.status === 'failure' ? (
          <ArrowClockwise aria-hidden="true" size={18} weight="bold" />
        ) : (
          <DownloadSimple aria-hidden="true" size={18} weight="bold" />
        )}
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none invisible absolute top-full left-1/2 z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-app-ink px-2 py-1 text-[11px] font-medium text-app-canvas opacity-0 shadow-app-card transition group-hover/export-action:visible group-hover/export-action:opacity-100 group-focus-within/export-action:visible group-focus-within/export-action:opacity-100"
        >
          {label}
        </span>
      </button>

      {menu.mounted ? (
        <div
          ref={menuRef}
          id={menuId}
          data-testid="asset-version-menu"
          data-state={menu.state}
          data-motion="scale-fade"
          data-popover-placement="top"
          role="menu"
          aria-label="选择下载版本"
          aria-hidden={menu.expanded ? undefined : true}
          inert={!menu.expanded}
          onAnimationEnd={menu.finish}
          className={`${productPopoverClass} absolute bottom-full left-0 z-30 mb-3 grid min-w-44 overflow-hidden p-1.5 ${productPopoverMotionClass(menu.state)}`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => choose([{ model: originalModel, filenameSuffix: 'original' }])}
            className={`${productMenuItemClass} text-left text-app-ink-soft`}
          >
            原始资产
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose([{ model: pixelPerfectModel, filenameSuffix: 'pixel-perfect' }])}
            className={`${productMenuItemClass} text-left text-app-ink-soft`}
          >
            完美像素版
          </button>
          <div className="mx-3 my-1 border-t border-app-ink/10" />
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              choose([
                { model: originalModel, filenameSuffix: 'original' },
                { model: pixelPerfectModel, filenameSuffix: 'pixel-perfect' },
              ])
            }
            className={`${productMenuItemClass} text-left text-app-accent`}
          >
            全部下载
          </button>
        </div>
      ) : null}

      {state.status === 'failure' ? (
        <span role="alert" className="max-w-64 text-[11px] font-medium leading-4 text-app-danger">
          导出失败：{state.message}
        </span>
      ) : null}
    </div>
  )
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
  icon,
  idleLabel,
  pill = false,
  iconOnly = false,
}: ExportButtonProps) {
  const { state, working, startExport } = useExportAction(model, exporter)
  const tooltipId = useId()
  const label =
    state.status === 'working'
      ? PHASE_LABELS[state.phase]
      : state.status === 'failure'
        ? '重新导出'
        : state.status === 'success'
          ? '下载完成'
          : (idleLabel ?? `导出${STAGE_LABELS[model.stage]}`)

  return (
    <div className="grid min-w-0 gap-1">
      <button
        type="button"
        disabled={working}
        aria-label={iconOnly ? label : undefined}
        aria-describedby={iconOnly ? tooltipId : undefined}
        title={state.status === 'failure' ? state.message : undefined}
        onClick={() => void startExport()}
        className={
          iconOnly
            ? `group/export-action relative grid size-10 shrink-0 place-items-center rounded-lg transition focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`
            : `${pill ? 'rounded-full' : 'rounded-lg'} inline-flex min-h-10 items-center justify-center gap-2 border border-current px-3 py-2 text-xs font-semibold disabled:opacity-50 ${className}`
        }
      >
        {iconOnly ? (
          <>
            {state.status === 'working' ? (
              <CircleNotch aria-hidden="true" size={18} weight="bold" className="animate-spin" />
            ) : state.status === 'success' ? (
              <Check aria-hidden="true" size={18} weight="bold" />
            ) : state.status === 'failure' ? (
              <ArrowClockwise aria-hidden="true" size={18} weight="bold" />
            ) : (
              <DownloadSimple aria-hidden="true" size={18} weight="bold" />
            )}
            <span
              id={tooltipId}
              role="tooltip"
              className="pointer-events-none invisible absolute top-full left-1/2 z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-app-ink px-2 py-1 text-[11px] font-medium text-app-canvas opacity-0 shadow-app-card transition group-hover/export-action:visible group-hover/export-action:opacity-100 group-focus-within/export-action:visible group-focus-within/export-action:opacity-100"
            >
              {label}
            </span>
          </>
        ) : (
          <>
            {icon ? (
              <span aria-hidden="true" className="inline-flex shrink-0">
                {icon}
              </span>
            ) : null}
            <span>{label}</span>
          </>
        )}
      </button>
      {state.status === 'failure' ? (
        <span role="alert" className="max-w-64 text-[11px] font-medium leading-4 text-app-danger">
          导出失败：{state.message}
        </span>
      ) : null}
    </div>
  )
}
