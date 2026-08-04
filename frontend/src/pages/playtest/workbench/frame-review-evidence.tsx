import type { EvidenceState, MotionVector } from './analysis/sequence-evidence'
import type { FrameReviewEvidenceState } from './analysis/use-frame-review-evidence'
import type { PlaytestActionType } from './model/types'

export interface FrameReviewEvidencePanelProps {
  state: FrameReviewEvidenceState
  frameIndex: number
  actionType: PlaytestActionType
}

const STATE_LABELS: Record<EvidenceState, string> = {
  normal: '正常',
  attention: '注意',
  anomaly: '异常',
  not_applicable: '不适用',
}

const STATE_CLASSES: Record<EvidenceState, string> = {
  normal: 'bg-emerald-50 text-emerald-800',
  attention: 'bg-amber-50 text-amber-800',
  anomaly: 'bg-rose-50 text-rose-800',
  not_applicable: 'bg-slate-100 text-slate-500',
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

function vectorText(vector: MotionVector | null): string {
  if (vector === null) return '相邻对比不适用'
  return `x ${signed(vector.dx)} px，y ${signed(vector.dy)} px，距离 ${vector.distance.toFixed(1)} px`
}

function optionalPixels(value: number | null): string {
  return value === null ? '不适用' : `${value.toFixed(1)} px`
}

function StateBadge({ state }: { state: EvidenceState }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATE_CLASSES[state]}`}>
      {STATE_LABELS[state]}
    </span>
  )
}

function EvidenceRow({
  label,
  value,
  state,
}: {
  label: string
  value: string
  state?: EvidenceState
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-t border-slate-100 py-2 first:border-t-0">
      <div className="min-w-0">
        <dt className="text-[11px] text-slate-500">{label}</dt>
        <dd className="mt-0.5 break-words text-xs font-medium text-slate-900">{value}</dd>
      </div>
      {state === undefined ? null : <StateBadge state={state} />}
    </div>
  )
}

export function FrameReviewEvidencePanel({
  state,
  frameIndex,
  actionType,
}: FrameReviewEvidencePanelProps) {
  return (
    <section
      role="region"
      aria-label="自动审核依据"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header>
        <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">AUTO REVIEW</p>
        <h2 className="mt-1 text-sm font-semibold text-slate-900">自动审核依据</h2>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">检查画面与序列质量，不修改 QC</p>
      </header>

      {state.status === 'idle' ? (
        <p className="mt-3 text-xs text-slate-500">未开始分析</p>
      ) : state.status === 'loading' ? (
        <p role="status" className="mt-3 text-xs text-slate-500">
          分析中，请稍候…
        </p>
      ) : (
        <EvidenceContent state={state} frameIndex={frameIndex} actionType={actionType} />
      )}
    </section>
  )
}

function EvidenceContent({
  state,
  frameIndex,
  actionType,
}: {
  state: Extract<FrameReviewEvidenceState, { status: 'ready' }>
  frameIndex: number
  actionType: PlaytestActionType
}) {
  const { evidence } = state
  const frame = evidence.frames[frameIndex] ?? null
  const summary = evidence.summary

  if (frame === null) return <p className="mt-3 text-xs text-slate-500">当前帧没有分析结果</p>

  return (
    <div className="mt-3 space-y-4">
      {frame.unavailableReason === null ? null : (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          无法计算：{frame.unavailableReason}
        </p>
      )}

      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-800">质量问题</h3>
          {!evidence.complete ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              分析不完整
            </span>
          ) : null}
        </div>
        {evidence.findings.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">未发现自动质量问题</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {evidence.findings.map((finding, index) => (
              <li
                key={`${finding.code}-${finding.frameIndex ?? 'sequence'}-${index}`}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  finding.severity === 'error'
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span>{finding.message}</span>
                  <strong className="shrink-0 text-[10px]">
                    {finding.severity === 'error' ? '错误' : '提醒'}
                  </strong>
                </div>
                <span className="mt-1 block text-[10px] opacity-70">
                  {finding.frameIndex === null ? '整段序列' : `第 ${finding.frameIndex + 1} 帧`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-800">当前帧</h3>
        <dl className="mt-1">
          <EvidenceRow
            label="画面内额外漂移"
            value={vectorText(frame.previousDelta)}
            state={frame.movementState}
          />
          <EvidenceRow label="预期根位移增量" value={vectorText(frame.expectedRootDelta)} />
          <EvidenceRow label="合成预览位移" value={vectorText(frame.composedPreviewDelta)} />
          <EvidenceRow
            label="画布尺寸"
            value={
              frame.geometry === null
                ? '无法计算'
                : `${frame.geometry.width} × ${frame.geometry.height} px`
            }
            state={frame.canvasState}
          />
          <EvidenceRow
            label="脚底线"
            value={frame.geometry === null ? '无法计算' : `${frame.geometry.footY} px`}
          />
          <EvidenceRow
            label="主体高度"
            value={frame.geometry === null ? '无法计算' : `${frame.geometry.subjectHeight} px`}
          />
          <EvidenceRow
            label="主体覆盖率"
            value={
              frame.geometry === null
                ? '无法计算'
                : `${(frame.geometry.coverageRatio * 100).toFixed(1)}%`
            }
            state={frame.coverageState}
          />
          <EvidenceRow
            label="轮廓面积变化"
            value={
              frame.previousDelta === null
                ? '不适用'
                : `${frame.previousDelta.areaDeltaPercent.toFixed(1)}%`
            }
            state={frame.areaState}
          />
        </dl>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-800">序列基线</h3>
        {!evidence.complete ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            {evidence.unavailableFrameCount} 帧无法计算，序列结论不完整
          </p>
        ) : null}
        <dl className="mt-1">
          <EvidenceRow
            label="整段画布规格"
            value={
              summary.expectedCanvas === null
                ? '无法推断序列基线'
                : `序列基线 ${summary.expectedCanvas.width} × ${summary.expectedCanvas.height}`
            }
            state={summary.canvasState}
          />
          <EvidenceRow
            label="最大脚底漂移"
            value={
              actionType === 'jump' && summary.footState === 'attention'
                ? `${optionalPixels(summary.footDrift)} / 本序列阈值 ${optionalPixels(summary.footThreshold)}；允许离地，需人工判断`
                : `${optionalPixels(summary.footDrift)} / 阈值 ${optionalPixels(summary.footThreshold)}`
            }
            state={summary.footState}
          />
          <EvidenceRow
            label="最大高度波动"
            value={
              summary.heightThreshold === null && summary.heightDrift !== null
                ? `${optionalPixels(summary.heightDrift)} / 动作允许高度变化，需人工判断`
                : `${optionalPixels(summary.heightDrift)} / 阈值 ${summary.heightThreshold?.toFixed(1) ?? '不适用'} px`
            }
            state={summary.heightState}
          />
          <EvidenceRow
            label="相邻位移连续性"
            value={
              summary.maxStep === null ||
              summary.medianStep === null ||
              summary.movementThreshold === null
                ? '不适用'
                : `最大 ${summary.maxStep.toFixed(1)} px，中值 ${summary.medianStep.toFixed(1)} px，阈值 ${summary.movementThreshold.toFixed(1)} px`
            }
            state={summary.movementState}
          />
          <EvidenceRow
            label="最大轮廓面积变化"
            value={
              summary.maxAreaDeltaPercent === null
                ? '不适用'
                : `最大 ${summary.maxAreaDeltaPercent.toFixed(1)}% / 阈值 ${summary.areaThresholdPercent.toFixed(1)}%`
            }
            state={summary.areaState}
          />
        </dl>
      </div>
    </div>
  )
}
