import type { FrameReviewEvidenceState } from './analysis/use-frame-review-evidence'
import { FrameReviewEvidencePanel } from './frame-review-evidence'
import type { PreviewAction, PreviewFrame, PreviewSequence } from './model/types'

export interface InspectorProps {
  action: PreviewAction | null
  sequence: PreviewSequence | null
  frame: PreviewFrame | null
  frameIndex: number
  reviewEvidence?: FrameReviewEvidenceState | null
}

function rootMotionText(frame: PreviewFrame | null): string {
  if (frame?.rootMotion === null || frame === null) return '无'
  return `x ${frame.rootMotion.dx}, y ${frame.rootMotion.dy}`
}

export function Inspector({
  action,
  sequence,
  frame,
  frameIndex,
  reviewEvidence = null,
}: InspectorProps) {
  const frameCount = sequence?.frames.length ?? 0

  return (
    <aside aria-label="资产检查器" className="space-y-4">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <header>
          <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">INSPECTOR</p>
          <h2 className="mt-1 text-sm font-semibold text-slate-900">资产检查器</h2>
        </header>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="text-slate-500">动作</dt>
          <dd className="font-medium text-slate-900">{action?.name ?? '未选择'}</dd>
          <dt className="text-slate-500">方向</dt>
          <dd className="font-medium text-slate-900">{sequence?.direction ?? '—'}</dd>
          <dt className="text-slate-500">帧序号</dt>
          <dd className="font-medium text-slate-900">
            {frameCount === 0 ? '0 / 0' : `${frameIndex + 1} / ${frameCount}`}
          </dd>
          <dt className="text-slate-500">时长</dt>
          <dd className="font-medium text-slate-900">
            {frame === null ? '—' : `${frame.durationMs} ms`}
          </dd>
          <dt className="text-slate-500">FPS</dt>
          <dd className="font-medium text-slate-900">{action?.fps ?? '—'}</dd>
          <dt className="text-slate-500">预期根位移</dt>
          <dd className="font-medium text-slate-900">{rootMotionText(frame)}</dd>
          <dt className="text-slate-500">关键帧</dt>
          <dd className="font-medium text-slate-900">{frame?.keyFrame ? '是' : '否'}</dd>
        </dl>
      </section>
      {reviewEvidence !== null && action !== null ? (
        <FrameReviewEvidencePanel
          state={reviewEvidence}
          frameIndex={frameIndex}
          actionType={action.type}
        />
      ) : null}
    </aside>
  )
}
