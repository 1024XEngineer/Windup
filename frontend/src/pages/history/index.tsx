import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import type {
  WorkflowRevision,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepStatus,
  WorkflowStepType,
} from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'

/**
 * History 只需要 Controller 的两个只读能力。
 * 使用 Pick 可以防止页面顺手调用生成、确认或审核命令，守住“历史页面不改业务”的边界。
 */
export type HistoryController = Pick<WorkflowController, 'listWorkflows' | 'subscribeAll'>

export interface HistoryPageProps {
  controller: HistoryController
}

const RUN_SECTIONS: ReadonlyArray<{
  status: WorkflowRunStatus
  title: string
  emptyLabel: string
}> = [
  { status: 'active', title: '进行中', emptyLabel: '没有正在进行的任务' },
  { status: 'interrupted', title: '已中断', emptyLabel: '没有已中断的任务' },
  { status: 'failed', title: '失败', emptyLabel: '没有失败任务' },
  { status: 'completed', title: '已完成', emptyLabel: '没有已完成任务' },
]

const RUN_STATUS_LABELS: Readonly<Record<WorkflowRunStatus, string>> = {
  active: '进行中',
  interrupted: '已中断',
  failed: '失败',
  completed: '已完成',
}

const RUN_STATUS_STYLES: Readonly<Record<WorkflowRunStatus, string>> = {
  active: 'border-sky-200 bg-sky-50 text-sky-800',
  interrupted: 'border-amber-200 bg-amber-50 text-amber-900',
  failed: 'border-rose-200 bg-rose-50 text-rose-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
}

const STEP_STATUS_LABELS: Readonly<Record<WorkflowStepStatus, string>> = {
  locked: '未解锁',
  available: '可开始',
  active: '进行中',
  passed: '已通过',
  failed: '失败',
}

const STEP_LABELS: Readonly<Record<WorkflowStepType, string>> = {
  'character-setup': '角色设定',
  'character-template': '角色候选生成',
  'template-candidate': '确认角色候选',
  'action-setup': '动作设定',
  'first-frame': '动作首帧生成',
  'first-frame-candidate': '确认动作首帧',
  'complete-animation': '完整动画生成',
  review: '动作审核',
  export: '写入角色资产',
}

/**
 * 项目历史页展示 WorkflowRun 与其 Revision，不展示 Character 资产或 Playtest 结论。
 * Run 是一次用户任务；Revision 是该任务内部的重做版本，两者不能拍平成同一级列表。
 */
export function HistoryPage({ controller }: HistoryPageProps) {
  const { projectId = '' } = useParams()
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) {
      setRuns([])
      setError('路由缺少项目 ID，无法读取历史记录')
      setLoading(false)
      return
    }

    /**
     * listWorkflows 可以直接按项目读取；subscribeAll 返回全局变化，回调里必须再次过滤。
     * 这样即使其他项目同时产生任务，也不会把记录混进当前页面。
     */
    const applyProjectRuns = (items: readonly WorkflowRun[]) => {
      setRuns(sortRuns(items.filter((run) => run.projectId === projectId)))
      setError(null)
      setLoading(false)
    }

    try {
      applyProjectRuns(controller.listWorkflows(projectId))
      return controller.subscribeAll(applyProjectRuns)
    } catch (cause) {
      setRuns([])
      setError(cause instanceof Error ? cause.message : '历史记录加载失败')
      setLoading(false)
    }
  }, [controller, projectId])

  const groupedRuns = useMemo(
    () =>
      RUN_SECTIONS.map((section) => ({
        ...section,
        runs: runs.filter((run) => run.status === section.status),
      })),
    [runs],
  )

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-8" aria-labelledby="history-title">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold text-slate-500">HISTORY</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 id="history-title" className="text-3xl font-semibold text-slate-950">
              创作历史
            </h1>
            <p className="mt-2 text-sm text-slate-600">查看任务进度、重做版本与每一步结果。</p>
          </div>
          <Link
            to={`/workflow-editor?projectId=${encodeURIComponent(projectId)}`}
            className="bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            新建创作任务
          </Link>
        </div>
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
            创建角色或生成动作后，任务会按项目出现在这里。
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {groupedRuns.map((section) =>
            section.runs.length > 0 ? (
              <section key={section.status} aria-labelledby={`history-${section.status}`}>
                <div className="mb-3 flex items-center gap-2">
                  <h2
                    id={`history-${section.status}`}
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
  const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
  const purposeLabel = run.purpose === 'create_character' ? '创建角色' : '生成动作'
  const title = run.prompt?.trim() || `${purposeLabel}任务 ${shortId(run.id)}`
  const passedCount = revision?.steps.filter((step) => step.status === 'passed').length ?? 0
  const totalCount = revision?.steps.length ?? 0

  return (
    <article data-testid="history-run" className="border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">{purposeLabel}</span>
            <span
              className={`border px-2 py-0.5 text-xs font-medium ${RUN_STATUS_STYLES[run.status]}`}
            >
              {RUN_STATUS_LABELS[run.status]}
            </span>
          </div>
          <h3 className="mt-2 break-words text-base font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            Run {shortId(run.id)} · 更新于{' '}
            <time dateTime={run.updatedAt}>{formatTime(run.updatedAt)}</time>
          </p>
        </div>
        <Link
          to={`/workflow-editor/${encodeURIComponent(run.id)}`}
          className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:border-slate-500"
        >
          {run.status === 'active' || run.status === 'interrupted' ? '继续任务' : '查看记录'}
        </Link>
      </div>

      {revision === undefined ? (
        <p
          role="alert"
          className="mt-4 border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
        >
          当前版本 {run.currentRevisionId} 不存在，这条记录需要修复后才能继续。
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 border-y border-slate-100 py-4 text-xs sm:grid-cols-3">
            <p>
              <span className="text-slate-500">当前版本</span>
              <strong className="ml-2 text-slate-900">{shortId(revision.id)}</strong>
            </p>
            <p>
              <span className="text-slate-500">步骤进度</span>
              <strong className="ml-2 text-slate-900">
                {passedCount} / {totalCount}
              </strong>
            </p>
            <p>
              <span className="text-slate-500">重做版本</span>
              <strong className="ml-2 text-slate-900">{run.revisions.length}</strong>
            </p>
          </div>
          <RevisionHistory revisions={run.revisions} currentRevisionId={run.currentRevisionId} />
        </>
      )}
    </article>
  )
}

function RevisionHistory({
  revisions,
  currentRevisionId,
}: {
  revisions: readonly WorkflowRevision[]
  currentRevisionId: string
}) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">
        查看 {revisions.length} 个版本
      </summary>
      <div className="mt-3 space-y-3">
        {revisions.map((revision, revisionIndex) => (
          <section
            key={revision.id}
            className="bg-slate-50 p-4"
            aria-label={`版本 ${revisionIndex + 1}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-900">
                版本 {revisionIndex + 1} · {shortId(revision.id)}
                {revision.id === currentRevisionId ? '（当前）' : ''}
              </h4>
              <span className="text-xs text-slate-500">{revision.status}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {revision.basedOnRevisionId === null
                ? '首次执行'
                : `基于版本 ${shortId(revision.basedOnRevisionId)}，从 ${revision.restartStepId ? stepLabel(revision.restartStepId) : '未记录步骤'} 重开`}
            </p>
            <ol className="mt-3 grid gap-2 sm:grid-cols-2">
              {revision.steps.map((step) => (
                <li
                  key={step.id}
                  className="flex items-center justify-between gap-3 bg-white px-3 py-2 text-xs"
                >
                  <span className="text-slate-800">{STEP_LABELS[step.type]}</span>
                  <span className="text-slate-500">{STEP_STATUS_LABELS[step.status]}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </details>
  )
}

function sortRuns(runs: readonly WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatTime(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value
}

/** 水合失败的旧记录可能带未知步骤名；历史页应原样展示，而不是因此崩溃。 */
function stepLabel(value: string): string {
  return Object.hasOwn(STEP_LABELS, value) ? STEP_LABELS[value as WorkflowStepType] : value
}
