import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  ArrowClockwise,
  ArrowSquareIn,
  CaretDown,
  Check,
  CircleNotch,
  DownloadSimple,
  FileArrowDown,
} from '@phosphor-icons/react'

import {
  productMenuItemClass,
  productPopoverClass,
  productPopoverMotionClass,
  useProductPopoverMotion,
} from '@/shared/ui'
import { CocosBridgeClient, CocosBridgeError, type CocosImportResult } from './cocos-bridge-client'
import { cocosCreatorTarget } from './cocos-target'
import { importIntoCocos, type CocosImportCache, type CocosOneClickPhase } from './cocos-one-click'
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

export type CocosImporter = (
  model: ExportPackageModel,
  onPhase: (phase: CocosOneClickPhase) => void,
) => Promise<CocosImportResult>

export type CocosPairer = (code: string) => Promise<void>

export interface ExportPanelProps {
  model: ExportPackageModel
  qualityIssueCount?: number
  exporter?: AssetExporter
  cocosExporter?: AssetExporter
  cocosImporter?: CocosImporter
  cocosPairer?: CocosPairer
  /** Cocos Creator 一键导出;默认开启,可用 false 隐藏。 */
  enableCocosExport?: boolean
}

export interface ExportButtonProps {
  model: ExportPackageModel
  exporter?: AssetExporter
  className?: string
  icon?: ReactNode
  idleLabel?: string
  pill?: boolean
  iconOnly?: boolean
  cocosExporter?: AssetExporter
  cocosImporter?: CocosImporter
  cocosPairer?: CocosPairer
  enableCocosExport?: boolean
  /**
   * stack 竖排(卡片内默认);menu 只露一个「导出」按钮,把资产包和 Cocos 两条路径
   * 收进二级菜单 —— 页面顶部的操作行放不下三个同级导出入口。
   */
  layout?: 'stack' | 'menu'
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

const COCOS_PHASE_LABELS: Readonly<Record<CocosOneClickPhase, string>> = {
  detecting: '正在连接 Cocos Creator',
  validating: '正在检查资产',
  packing: '正在生成 Cocos 导入包',
  uploading: '正在发送到 Cocos Creator',
  queued: 'Cocos Creator 正在排队',
  converting: '正在生成 Prefab 和动画',
  writing: '正在写入当前工程',
  refreshing: '正在刷新 Cocos 资源库',
  verifying: '正在校验导入结果',
}

const STAGE_LABELS: Readonly<Record<ExportPackageModel['stage'], string>> = {
  character: '角色母版',
  'first-frame': '角色母版与动作首帧',
  'action-assets': '完整动作资产',
  playtest: 'Playtest 运行包',
}

/**
 * 导出入口共用的结构类。这里刻意不写 padding、min-height、边框色和字号:
 * 它们由调用方的 className 给,基础类再写一份会和调用方的同类 utility 撞车,
 * 谁生效取决于 CSS 产出顺序而不是拼接顺序。
 */
function exportActionClass(pill: boolean, className: string): string {
  return `${pill ? 'rounded-full' : ''} inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`
}

const EXPORT_ALERT_CLASS =
  'rounded-app-compact border border-app-danger-line bg-app-danger-soft px-3 py-2 text-[11px] font-medium leading-4 text-app-danger'

const defaultExporter: AssetExporter = (model, onPhase) => exportGameAssets(model, { onPhase })
const defaultCocosExporter: AssetExporter = (model, onPhase) =>
  exportGameAssets(model, { targets: [cocosCreatorTarget], onPhase })

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

type CocosImportState =
  | { status: 'idle' }
  | { status: 'working'; phase: CocosOneClickPhase }
  | { status: 'pairing'; message: string }
  | { status: 'success'; result: CocosImportResult }
  | {
      status: 'failure'
      message: string
      jobCode?: string
      phase?: CocosOneClickPhase
      rolledBack?: boolean
    }

function importFailureState(error: unknown): CocosImportState {
  return {
    status: 'failure',
    message: error instanceof Error ? error.message : '未知错误',
    ...(error instanceof CocosBridgeError
      ? { jobCode: error.jobCode, phase: error.phase, rolledBack: error.rolledBack }
      : {}),
  }
}

function useCocosImportAction(
  model: ExportPackageModel,
  importer?: CocosImporter,
  pairer?: CocosPairer,
) {
  const defaults = useRef<{ client: CocosBridgeClient; cache: CocosImportCache } | null>(null)
  if (defaults.current === null) {
    defaults.current = { client: new CocosBridgeClient(), cache: {} }
  }
  const resolvedImporter: CocosImporter =
    importer ??
    ((currentModel, onPhase) =>
      importIntoCocos(currentModel, defaults.current!.client, onPhase, {
        cache: defaults.current!.cache,
      }))
  const resolvedPairer = pairer ?? ((code: string) => defaults.current!.client.pair(code))
  const [state, setState] = useState<CocosImportState>({ status: 'idle' })
  const [pairingCode, setPairingCode] = useState('')
  const working = state.status === 'working'

  const handleError = (error: unknown) => {
    if (error instanceof CocosBridgeError && error.code === 'PAIRING_REQUIRED') {
      setState({ status: 'pairing', message: error.message })
    } else {
      setState(importFailureState(error))
    }
  }

  const executeImport = async () => {
    try {
      const result = await resolvedImporter(model, (phase) =>
        setState({ status: 'working', phase }),
      )
      setState({ status: 'success', result })
    } catch (error) {
      handleError(error)
    }
  }

  const startImport = async () => {
    if (working) return
    setState({ status: 'working', phase: 'detecting' })
    await executeImport()
  }

  const pairAndImport = async () => {
    if (!/^\d{6}$/.test(pairingCode)) {
      setState({ status: 'pairing', message: '请输入 Creator 显示的 6 位连接码' })
      return
    }
    setState({ status: 'working', phase: 'detecting' })
    try {
      await resolvedPairer(pairingCode)
      setPairingCode('')
      await executeImport()
    } catch (error) {
      handleError(error)
    }
  }

  return { state, working, pairingCode, setPairingCode, startImport, pairAndImport }
}

function CocosImportFeedback({
  action,
  inline = false,
}: {
  action: ReturnType<typeof useCocosImportAction>
  inline?: boolean
}) {
  // inline 时反馈块独占一行,不跟按钮抢同一行的横向空间。
  const block = inline ? 'basis-full' : ''
  if (action.state.status === 'working') {
    return (
      <p
        role="status"
        className={`rounded-app-compact border border-app-line bg-app-surface-muted px-3 py-2 text-xs text-app-ink-soft ${block}`}
      >
        {COCOS_PHASE_LABELS[action.state.phase]}
      </p>
    )
  }
  if (action.state.status === 'pairing') {
    return (
      <div
        className={`space-y-2 rounded-app-compact border border-app-line bg-app-surface-muted p-2 ${block}`}
      >
        <p role="alert" className="text-xs text-app-ink-soft">
          {action.state.message}
        </p>
        <label className="block text-[11px] font-medium text-app-ink-soft">
          Creator 连接码
          <input
            aria-label="Creator 连接码"
            inputMode="numeric"
            maxLength={6}
            value={action.pairingCode}
            onChange={(event) => action.setPairingCode(event.target.value.replace(/\D/g, ''))}
            className="mt-1 w-full rounded border border-app-line bg-app-surface-raised px-2 py-1 text-xs text-app-ink"
          />
        </label>
        <button
          type="button"
          onClick={() => void action.pairAndImport()}
          className="w-full rounded bg-app-accent px-2 py-1 text-xs font-semibold text-app-on-accent transition-colors hover:bg-app-accent-hover"
        >
          连接并导入
        </button>
      </div>
    )
  }
  if (action.state.status === 'failure') {
    return (
      <div
        role="alert"
        className={`rounded-app-compact border border-app-danger-line bg-app-danger-soft px-3 py-2 text-xs text-app-danger ${block}`}
      >
        <p>导入失败：{action.state.message}</p>
        {action.state.jobCode ? (
          <p className="mt-1 text-[11px]">
            阶段：{COCOS_PHASE_LABELS[action.state.phase ?? 'queued']} · 错误码：
            {action.state.jobCode} · 回滚：
            {action.state.rolledBack
              ? '已完成'
              : action.state.jobCode === 'IMPORT_ROLLBACK_FAILED'
                ? '未完成，请检查工程资产'
                : '未执行'}
          </p>
        ) : null}
      </div>
    )
  }
  if (action.state.status === 'success') {
    return (
      <div
        className={`rounded-app-compact border border-app-accent-soft bg-app-accent-muted px-3 py-2 text-xs text-app-accent ${block}`}
      >
        <p className="font-semibold">已导入到当前 Cocos 工程</p>
        <p className="mt-1">
          {action.state.result.projectName} · {action.state.result.animationCount} 个动作，
          {action.state.result.frameCount} 帧
        </p>
      </div>
    )
  }
  return null
}

function StateBanner({ state }: { state: ExportState }) {
  if (state.status === 'working') {
    return (
      <p
        role="status"
        className="rounded-lg bg-slate-50 dark:bg-app-surface-muted px-3 py-2 text-xs text-slate-700 dark:text-app-ink-soft"
      >
        {PHASE_LABELS[state.phase]}
      </p>
    )
  }
  if (state.status === 'failure') {
    return (
      <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
        导出失败：{state.message}
      </p>
    )
  }
  if (state.status === 'success') {
    return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">下载完成</p>
  }
  return null
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
  cocosExporter = defaultCocosExporter,
  cocosImporter,
  cocosPairer,
  enableCocosExport = true,
}: ExportPanelProps) {
  const plan = createAssetExportPlan(model)
  const { state, working, startExport } = useExportAction(model, exporter)
  const cocos = useExportAction(model, cocosExporter)
  const cocosImport = useCocosImportAction(model, cocosImporter, cocosPairer)
  const cocosButtonLabel =
    cocos.state.status === 'working'
      ? PHASE_LABELS[cocos.state.phase]
      : cocos.state.status === 'failure'
        ? '重新导出 Cocos 包'
        : cocos.state.status === 'success'
          ? 'Cocos 包下载完成'
          : '下载 Cocos 包'

  return (
    <section
      aria-label="资产导出"
      aria-busy={working || cocos.working || cocosImport.working}
      className="space-y-4 rounded-xl border border-slate-200 dark:border-app-line bg-white dark:bg-app-surface-raised p-4 shadow-sm"
    >
      <header>
        <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400 dark:text-app-faint">
          GAME ASSETS
        </p>
        <h2 className="mt-1 text-sm font-semibold text-slate-900 dark:text-app-ink">资产导出</h2>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-app-muted">
          逐帧透明 PNG、Sprite Sheet 与动画 JSON
        </p>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-slate-500 dark:text-app-muted">当前阶段</dt>
        <dd className="font-medium text-slate-900 dark:text-app-ink">
          {STAGE_LABELS[model.stage]}
        </dd>
        <dt className="text-slate-500 dark:text-app-muted">已确认首帧</dt>
        <dd className="font-medium text-slate-900 dark:text-app-ink">
          {model.firstFrames.length} 张
        </dd>
        <dt className="text-slate-500 dark:text-app-muted">动作方向</dt>
        <dd className="font-medium text-slate-900 dark:text-app-ink">{plan.length} 组</dd>
        <dt className="text-slate-500 dark:text-app-muted">逐帧原图</dt>
        <dd className="font-medium text-slate-900 dark:text-app-ink">
          {plan.reduce((total, item) => total + item.frames.length, 0)} 张
        </dd>
        <dt className="text-slate-500 dark:text-app-muted">每行上限</dt>
        <dd className="font-medium text-slate-900 dark:text-app-ink">8 帧</dd>
      </dl>

      {qualityIssueCount > 0 ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          当前有 {qualityIssueCount} 项质量问题，全部通过后才能导出
        </p>
      ) : null}

      {state.status === 'working' ? (
        <p
          role="status"
          className="rounded-lg bg-slate-50 dark:bg-app-surface-muted px-3 py-2 text-xs text-slate-700 dark:text-app-ink-soft"
        >
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
        disabled={working || cocos.working || cocosImport.working || qualityIssueCount > 0}
        onClick={() => void startExport()}
        className="w-full rounded-lg bg-orange-500 dark:bg-app-accent px-3 py-2 text-xs font-semibold text-white dark:text-app-on-accent hover:bg-orange-600 dark:hover:bg-app-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state.status === 'failure' ? '重新导出' : '导出游戏资产包'}
      </button>
      {plan.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-app-muted">当前包含角色母版</p>
      ) : null}

      {enableCocosExport ? (
        <div className="space-y-2 rounded-lg border border-amber-200 dark:border-app-warning-line bg-amber-50 dark:bg-app-warning-soft p-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-200 dark:bg-app-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900 dark:text-app-warning">
              一键导入
            </span>
            <p className="text-xs font-semibold text-amber-900 dark:text-app-warning">
              Cocos Creator 3.8 适配
            </p>
          </div>
          <p className="text-[11px] leading-4 text-amber-800 dark:text-app-warning">
            首次安装并配对插件后，可直接写入当前 2D 工程并刷新 Prefab、动画和 SpriteFrame。
          </p>
          <CocosImportFeedback action={cocosImport} />
          <button
            type="button"
            disabled={working || cocos.working || cocosImport.working || qualityIssueCount > 0}
            onClick={() => void cocosImport.startImport()}
            className="w-full rounded-lg bg-sky-700 dark:bg-app-accent px-3 py-2 text-xs font-semibold text-white dark:text-app-on-accent hover:bg-sky-800 dark:hover:bg-app-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cocosImport.state.status === 'failure' ? '重新导入 Cocos' : '一键导入 Cocos'}
          </button>
          <StateBanner state={cocos.state} />
          <button
            type="button"
            disabled={working || cocos.working || cocosImport.working || qualityIssueCount > 0}
            onClick={() => void cocos.startExport()}
            title={
              cocos.state.status === 'failure'
                ? cocos.state.message
                : '插件不可用时下载 Cocos 适配包'
            }
            className="w-full rounded-lg border border-amber-300 dark:border-app-warning-line bg-white dark:bg-app-surface-raised px-3 py-2 text-xs font-semibold text-amber-900 dark:text-app-warning hover:bg-amber-100 dark:hover:bg-app-warning-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cocosButtonLabel}
          </button>
          <p className="text-[10px] leading-4 text-amber-700 dark:text-app-warning">
            首次使用需要在 Creator 中安装全局插件并输入连接码。
          </p>
        </div>
      ) : null}
    </section>
  )
}

export function ExportButton({
  model,
  exporter = defaultExporter,
  cocosExporter,
  cocosImporter,
  cocosPairer,
  className = '',
  icon,
  idleLabel,
  pill = false,
  iconOnly = false,
  enableCocosExport = false,
  layout = 'stack',
}: ExportButtonProps) {
  const { state, working, startExport } = useExportAction(model, exporter)
  const tooltipId = useId()
  const cocos = useExportAction(model, cocosExporter ?? defaultCocosExporter)
  const cocosImport = useCocosImportAction(model, cocosImporter, cocosPairer)
  const showCocosExport =
    enableCocosExport || Boolean(cocosExporter || cocosImporter || cocosPairer)
  const busy = working || cocos.working || cocosImport.working
  const packageLabel =
    state.status === 'working'
      ? PHASE_LABELS[state.phase]
      : state.status === 'failure'
        ? '重新导出'
        : state.status === 'success'
          ? '下载完成'
          : (idleLabel ?? `导出${STAGE_LABELS[model.stage]}`)
  const cocosPackageLabel =
    cocos.state.status === 'working'
      ? PHASE_LABELS[cocos.state.phase]
      : cocos.state.status === 'failure'
        ? '重新导出 Cocos 包'
        : cocos.state.status === 'success'
          ? 'Cocos 包下载完成'
          : '下载 Cocos 包'
  const cocosImportLabel =
    cocosImport.state.status === 'failure' ? '重新导入 Cocos' : '一键导入 Cocos'

  if (layout === 'menu' && showCocosExport && !iconOnly) {
    return (
      <ExportMenuButton
        busy={busy}
        className={className}
        pill={pill}
        packageLabel={packageLabel}
        packageState={state.status}
        onExportPackage={() => void startExport()}
        cocosImportLabel={cocosImportLabel}
        onImportCocos={() => void cocosImport.startImport()}
        cocosPackageLabel={cocosPackageLabel}
        cocosPackageTitle={
          cocos.state.status === 'failure' ? cocos.state.message : '插件不可用时下载 Cocos 适配包'
        }
        onExportCocosPackage={() => void cocos.startExport()}
        feedback={
          <>
            {state.status === 'failure' ? (
              <span role="alert" className={EXPORT_ALERT_CLASS}>
                导出失败：{state.message}
              </span>
            ) : null}
            <CocosImportFeedback action={cocosImport} />
            {cocos.state.status === 'failure' ? (
              <span role="alert" className={EXPORT_ALERT_CLASS}>
                Cocos 导出失败：{cocos.state.message}
              </span>
            ) : null}
          </>
        }
      />
    )
  }

  return (
    <div className="grid min-w-0 gap-1">
      <button
        type="button"
        disabled={busy}
        aria-label={iconOnly ? packageLabel : undefined}
        aria-describedby={iconOnly ? tooltipId : undefined}
        title={state.status === 'failure' ? state.message : undefined}
        onClick={() => void startExport()}
        className={
          iconOnly
            ? `group/export-action relative grid size-10 shrink-0 place-items-center rounded-lg transition focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`
            : exportActionClass(pill, className)
        }
      >
        {iconOnly ? (
          <>
            <ExportStateIcon status={state.status} size={18} />
            <span
              id={tooltipId}
              role="tooltip"
              className="pointer-events-none invisible absolute top-full left-1/2 z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-app-ink px-2 py-1 text-[11px] font-medium text-app-canvas opacity-0 shadow-app-card transition group-hover/export-action:visible group-hover/export-action:opacity-100 group-focus-within/export-action:visible group-focus-within/export-action:opacity-100"
            >
              {packageLabel}
            </span>
          </>
        ) : (
          <>
            {icon ? (
              <span aria-hidden="true" className="inline-flex shrink-0">
                {icon}
              </span>
            ) : null}
            <span>{packageLabel}</span>
          </>
        )}
      </button>
      {state.status === 'failure' ? (
        <span role="alert" className={EXPORT_ALERT_CLASS}>
          导出失败：{state.message}
        </span>
      ) : null}
      {showCocosExport ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void cocosImport.startImport()}
            className={exportActionClass(pill, className)}
          >
            {cocosImportLabel}
          </button>
          <CocosImportFeedback action={cocosImport} />
          <button
            type="button"
            disabled={busy}
            title={
              cocos.state.status === 'failure'
                ? cocos.state.message
                : '插件不可用时下载 Cocos 适配包'
            }
            onClick={() => void cocos.startExport()}
            className={exportActionClass(pill, className)}
          >
            {cocosPackageLabel}
          </button>
          {cocos.state.status === 'failure' ? (
            <span role="alert" className={EXPORT_ALERT_CLASS}>
              Cocos 导出失败：{cocos.state.message}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function ExportStateIcon({ status, size }: { status: ExportState['status']; size: number }) {
  if (status === 'working') {
    return <CircleNotch aria-hidden="true" size={size} weight="bold" className="animate-spin" />
  }
  if (status === 'success') return <Check aria-hidden="true" size={size} weight="bold" />
  if (status === 'failure') return <ArrowClockwise aria-hidden="true" size={size} weight="bold" />
  return <DownloadSimple aria-hidden="true" size={size} weight="bold" />
}

/**
 * 顶部操作行里的导出入口:按钮只占一格,资产包与 Cocos 两条路径都在菜单里,
 * 每一项都是「图标 + 文案」,不让同一行出现有图标和纯文字两种按钮。
 */
function ExportMenuButton({
  busy,
  className,
  pill,
  packageLabel,
  packageState,
  onExportPackage,
  cocosImportLabel,
  onImportCocos,
  cocosPackageLabel,
  cocosPackageTitle,
  onExportCocosPackage,
  feedback,
}: {
  busy: boolean
  className: string
  pill: boolean
  packageLabel: string
  packageState: ExportState['status']
  onExportPackage: () => void
  cocosImportLabel: string
  onImportCocos: () => void
  cocosPackageLabel: string
  cocosPackageTitle: string
  onExportCocosPackage: () => void
  feedback: ReactNode
}) {
  const menu = useProductPopoverMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

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

  const choose = (run: () => void) => {
    menu.close()
    triggerRef.current?.focus()
    run()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={menu.expanded}
        aria-controls={menu.mounted ? menuId : undefined}
        onClick={menu.toggle}
        className={exportActionClass(pill, className)}
      >
        <ExportStateIcon status={packageState} size={15} />
        导出
        <CaretDown aria-hidden="true" size={12} weight="bold" />
      </button>

      {menu.mounted ? (
        <div
          ref={menuRef}
          id={menuId}
          data-state={menu.state}
          data-motion="scale-fade"
          role="menu"
          aria-label="导出方式"
          aria-hidden={menu.expanded ? undefined : true}
          inert={!menu.expanded}
          onAnimationEnd={menu.finish}
          className={`${productPopoverClass} absolute top-[calc(100%+0.4rem)] right-0 z-30 grid min-w-52 gap-0.5 overflow-hidden p-1.5 ${productPopoverMotionClass(menu.state)}`}
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => choose(onExportPackage)}
            className={`${productMenuItemClass} gap-2.5 text-left text-app-ink-soft disabled:opacity-50`}
          >
            <DownloadSimple aria-hidden="true" size={15} weight="bold" />
            {packageLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => choose(onImportCocos)}
            className={`${productMenuItemClass} gap-2.5 text-left text-app-ink-soft disabled:opacity-50`}
          >
            <ArrowSquareIn aria-hidden="true" size={15} weight="bold" />
            {cocosImportLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            title={cocosPackageTitle}
            onClick={() => choose(onExportCocosPackage)}
            className={`${productMenuItemClass} gap-2.5 text-left text-app-muted disabled:opacity-50`}
          >
            <FileArrowDown aria-hidden="true" size={15} weight="bold" />
            {cocosPackageLabel}
          </button>
        </div>
      ) : null}

      {feedback ? (
        <div className="absolute top-[calc(100%+0.4rem)] right-0 z-20 grid w-72 gap-1">
          {feedback}
        </div>
      ) : null}
    </div>
  )
}
