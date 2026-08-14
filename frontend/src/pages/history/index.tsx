import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import type { WorkflowNode, WorkflowRun } from '@/entities'

/**
 * 后端 PR #176 已提供按项目分页查询 WorkflowRun 的接口；本模块仍只依赖读取边界。
 * 待 WorkflowRunStore 合并并由 App 装配后再开放入口，页面不依赖单 Run 的 Controller。
 */
export interface WorkflowHistoryReader {
  listByProject(projectId: string): Promise<readonly WorkflowRun[]>
}

export interface HistoryPageProps {
  reader: WorkflowHistoryReader
}

type DerivedRunState = 'active' | 'failed' | 'completed'

const RUN_SECTIONS: ReadonlyArray<{
  state: DerivedRunState
  title: string
}> = [
  { state: 'active', title: '进行中' },
  { state: 'failed', title: '失败' },
  { state: 'completed', title: '已完成' },
]

const RUN_STATUS_LABELS: Readonly<Record<DerivedRunState, string>> = {
  active: '进行中',
  failed: '失败',
  completed: '已完成',
}

const RUN_STATUS_STYLES: Readonly<Record<DerivedRunState, string>> = {
  active: 'border-sky-200 bg-sky-50 text-sky-800',
  failed: 'border-rose-200 bg-rose-50 text-rose-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
}

const NODE_LABELS: Readonly<Record<string, string>> = {
  character: '角色制作',
  action: '动作制作',
  'character-setup': '角色设定',
  'character-template': '角色母版',
  'action-first-frame': '动作首帧',
  'action-generation-method': '资产生成方式',
  'action-full-frame': '完整动画',
  review: '动作审核',
}

const NODE_STATUS_LABELS: Readonly<Record<WorkflowNode['status'], string>> = {
  locked: '等待上游',
  active: '进行中',
  passed: '已完成',
  failed: '失败',
}

/** 只读展示 WorkflowRun 当前节点图；不恢复旧 Revision、Step 或 driver 概念。 */
export function HistoryPage({ reader }: HistoryPageProps) {
  const { projectId = '' } = useParams()
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    if (!projectId) {
      setRuns([])
      setError('路由缺少项目 ID，无法读取历史记录')
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    void reader.listByProject(projectId).then(
      (items) => {
        if (cancelled) return
        setRuns(
          items.filter((run) => run.projectId === projectId).map((run) => structuredClone(run)),
        )
        setLoading(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setRuns([])
        setError(cause instanceof Error ? cause.message : '历史记录加载失败')
        setLoading(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [projectId, reader])

  const groupedRuns = useMemo(
    () =>
      RUN_SECTIONS.map((section) => ({
        ...section,
        runs: runs.filter((run) => deriveRunState(run) === section.state),
      })),
    [runs],
  )

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-8" aria-labelledby="history-title">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold text-slate-500">HISTORY</p>
        <h1 id="history-title" className="mt-2 text-3xl font-semibold text-slate-950">
          创作历史
        </h1>
        <p className="mt-2 text-sm text-slate-600">查看每条工作流当前保存的节点进度。</p>
      </header>

      {loading ? (
        <p role="status" className="py-10 text-sm text-slate-600">
          正在读取历史记录...
        </p>
      ) : error !== null ? (
        <p
          role="alert"
          className="mt-6 border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {error}
        </p>
      ) : runs.length === 0 ? (
        <div className="mt-8 border border-dashed border-slate-300 p-10 text-center">
          <h2 className="text-base font-semibold text-slate-900">还没有创作记录</h2>
          <p className="mt-2 text-sm text-slate-600">
            History 暂未接入产品入口；后端列表接口确定后再启用。
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {groupedRuns.map((section) =>
            section.runs.length > 0 ? (
              <section key={section.state} aria-labelledby={`history-${section.state}`}>
                <div className="mb-3 flex items-center gap-2">
                  <h2
                    id={`history-${section.state}`}
                    className="text-sm font-semibold text-slate-900"
                  >
                    {section.title}
                  </h2>
                  <span className="text-xs text-slate-500">{section.runs.length}</span>
                </div>
                <div className="space-y-3">
                  {section.runs.map((run) => (
                    <RunCard key={run.id} run={run} />
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      )}
    </section>
  )
}

function RunCard({ run }: { run: WorkflowRun }) {
  const state = deriveRunState(run)
  const passedCount = run.nodes.filter((node) => node.status === 'passed').length

  return (
    <article data-testid="history-run" className="border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className={`border px-2 py-0.5 text-xs font-medium ${RUN_STATUS_STYLES[state]}`}>
            {RUN_STATUS_LABELS[state]}
          </span>
          <h3 className="mt-2 text-base font-semibold text-slate-950">工作流 {shortId(run.id)}</h3>
          <p className="mt-1 text-xs text-slate-500">
            版本 {run.version} · 节点 {passedCount} / {run.nodes.length}
          </p>
        </div>
        <Link
          to={`/workflow-editor/${encodeURIComponent(run.id)}`}
          className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:border-slate-500"
        >
          {state === 'completed' ? '查看记录' : '继续任务'}
        </Link>
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {run.nodes.map((node) => (
          <li
            key={node.id}
            className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2 text-xs"
          >
            <span className="text-slate-800">{NODE_LABELS[node.type] ?? node.type}</span>
            <span className="text-slate-500">{NODE_STATUS_LABELS[node.status]}</span>
          </li>
        ))}
      </ol>
    </article>
  )
}

function deriveRunState(run: WorkflowRun): DerivedRunState {
  if (run.nodes.some((node) => node.status === 'failed')) return 'failed'
  if (run.nodes.length > 0 && run.nodes.every((node) => node.status === 'passed'))
    return 'completed'
  return 'active'
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value
}
