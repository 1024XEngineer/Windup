import { useState } from 'react'

import type { QualityFinding } from '../analysis/sequence-evidence'
import type { PlaytestDirection, PreviewFrame } from '../model/types'
import type { ManualAuditIssue, ManualIssueCategory } from './audit-session'

const CATEGORY_LABELS: Readonly<Record<ManualIssueCategory, string>> = {
  subject_cropped: '主体裁切',
  transparency: '透明背景异常',
  image_unavailable: '空白或加载失败',
  duplicate_frame: '重复帧',
  motion_discontinuity: '动作抖动或不连续',
  motion_direction: '位移或方向错误',
  style_inconsistent: '风格不一致',
  other: '其他',
}

let fallbackId = 0

function createIssueId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  fallbackId += 1
  return `manual-${Date.now()}-${fallbackId}`
}

export interface AuditPanelProps {
  actionId: string | null
  actionName: string | null
  direction: PlaytestDirection | null
  frameIndex: number
  frame: PreviewFrame | null
  automaticFindings: readonly QualityFinding[]
  issues: readonly ManualAuditIssue[]
  onAdd(issue: ManualAuditIssue): void
  onUpdate(id: string, category: ManualIssueCategory, note: string): void
  onRemove(id: string): void
}

export function AuditPanel({
  actionId,
  actionName,
  direction,
  frameIndex,
  frame,
  automaticFindings,
  issues,
  onAdd,
  onUpdate,
  onRemove,
}: AuditPanelProps) {
  const [category, setCategory] = useState<ManualIssueCategory>('subject_cropped')
  const [note, setNote] = useState('')
  const canMark = actionId !== null && direction !== null && frame !== null

  return (
    <section
      aria-label="问题记录"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header>
        <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">QUALITY ISSUES</p>
        <h2 className="mt-1 text-sm font-semibold text-slate-900">问题记录</h2>
        <p className="mt-1 text-[11px] text-slate-500">仅保留在当前 Playtest 会话</p>
      </header>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-800">自动发现</h3>
        {automaticFindings.length === 0 ? (
          <p className="text-xs text-slate-500">当前序列没有自动问题</p>
        ) : (
          <ul className="space-y-2">
            {automaticFindings.map((finding, index) => (
              <li
                key={`${finding.code}-${finding.frameIndex ?? 'sequence'}-${index}`}
                className="rounded-lg bg-slate-50 p-2 text-xs"
              >
                <div className="flex justify-between gap-2">
                  <span>{finding.message}</span>
                  <strong className="text-[10px] text-slate-500">自动</strong>
                </div>
                <span className="mt-1 block text-[10px] text-slate-500">
                  {finding.frameIndex === null ? '整段序列' : `第 ${finding.frameIndex + 1} 帧`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <h3 className="text-xs font-semibold text-slate-800">
          标记当前帧{actionName === null ? '' : ` · ${actionName} #${frameIndex + 1}`}
        </h3>
        <label className="block text-xs text-slate-600">
          问题类型
          <select
            aria-label="问题类型"
            value={category}
            onChange={(event) => setCategory(event.target.value as ManualIssueCategory)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2"
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          问题说明
          <textarea
            aria-label="问题说明"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 min-h-16 w-full rounded-lg border border-slate-200 px-2 py-2"
          />
        </label>
        <button
          type="button"
          disabled={!canMark}
          onClick={() => {
            if (actionId === null || direction === null || frame === null) return
            onAdd({
              id: createIssueId(),
              category,
              actionId,
              direction,
              frameIndex,
              imageUrl: frame.imageUrl,
              note: note.trim(),
            })
            setNote('')
          }}
          className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          标记当前帧问题
        </button>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <h3 className="text-xs font-semibold text-slate-800">人工记录</h3>
        {issues.length === 0 ? (
          <p className="text-xs text-slate-500">尚未标记人工问题</p>
        ) : (
          issues.map((issue) => (
            <article key={issue.id} className="space-y-2 rounded-lg border border-slate-200 p-2">
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <strong>人工</strong>
                <span>
                  {issue.actionId} · {issue.direction} · 第 {issue.frameIndex + 1} 帧
                </span>
              </div>
              <select
                aria-label="人工问题类型"
                value={issue.category}
                onChange={(event) =>
                  onUpdate(issue.id, event.target.value as ManualIssueCategory, issue.note)
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <textarea
                aria-label="人工问题说明"
                value={issue.note}
                onChange={(event) => onUpdate(issue.id, issue.category, event.target.value)}
                className="min-h-14 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs"
              />
              <button
                type="button"
                aria-label="删除人工问题"
                onClick={() => onRemove(issue.id)}
                className="text-xs font-semibold text-rose-700"
              >
                删除
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
