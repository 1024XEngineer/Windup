import { useState } from 'react'
import { Link } from 'react-router'

import { createWorkflowRun, getCurrentRevision, useWorkflowRun } from '@/entities'
import { Generation } from '@/features/generation'
import { PageHeader } from '@/shared/ui'

/** AI 入口。与手动入口共用同一种 WorkflowRun，但结果留在本页，不自动跳走。 */
export function QuickStartPage() {
  const [description, setDescription] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    const prompt = description.trim()
    if (!prompt) {
      setError('请先描述要制作的角色。')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const run = await createWorkflowRun({ projectId: 'quick-start', driver: 'ai', prompt })
      setRunId(run.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader title="快速开始" subtitle="一句话描述你想要的角色" />
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void start()
        }}
      >
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="例如：一个戴斗篷的像素小骑士，要走路、奔跑和跳跃"
          className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-slate-400"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? '创建中…' : '开始生成'}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
      {runId ? <QuickStartRun runId={runId} /> : null}
    </>
  )
}

function QuickStartRun({ runId }: { runId: string }) {
  const { data: run, loading, error } = useWorkflowRun(runId)

  if (loading) return <p className="mt-8 text-sm text-slate-500">加载生成进度…</p>
  if (error) return <p className="mt-8 text-sm text-red-600">加载失败：{error.message}</p>
  if (!run) return null

  return (
    <section className="mt-8 space-y-3" aria-label="AI 快速生成">
      <p className="text-sm text-slate-500">
        工作流 {run.id} · 生成 {getCurrentRevision(run).generationStatus}
      </p>
      <Generation runId={run.id} />
      {/* 跳转由用户主动触发；审核、导出这些节点只在编辑器里做。 */}
      <Link
        to={`/workflow-editor/${run.id}/generation`}
        className="inline-block border border-slate-300 px-4 py-2 text-sm hover:border-slate-500"
      >
        打开完整工作流
      </Link>
    </section>
  )
}
