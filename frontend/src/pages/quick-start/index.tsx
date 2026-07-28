import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import {
  canImportToPlaytest,
  createWorkflowRun,
  getCurrentRevision,
  useWorkflowRun,
} from '@/entities'
import { PageHeader } from '@/shared/ui'

const CREATION_COPY = {
  asset: ['正在理解你的设定', '已准备好角色创作所需的基础信息。'],
  generation: ['正在生成角色', '正在连接生成服务并准备创作素材。'],
  candidate: ['正在检查结果', '系统正在检查生成内容是否符合交付要求。'],
  review: ['正在整理交付版本', '生成结果已准备好，正在完成最终整理。'],
  export: ['正在准备文件', '正在整理可导出和可核验的角色文件。'],
} as const

/**
 * Quick Start 是面向创作的独立体验。它复用 WorkflowRun 的领域状态，
 * 但不向用户暴露节点、版本或编辑器术语。
 */
export function QuickStartPage() {
  const navigate = useNavigate()
  const { runId } = useParams()
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (runId) return <QuickStartCreation runId={runId} onCreateAnother={() => navigate('/quick-start')} />

  async function start() {
    const prompt = description.trim()
    if (!prompt) {
      setError('请先描述要制作的角色。')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const run = await createWorkflowRun({
        projectId: 'quick-start',
        driver: 'ai',
        prompt,
      })
      navigate(`/quick-start/${run.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader title="快速开始" subtitle="一句话描述你想要的角色，我们会帮你完成创作。" />
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
          {submitting ? '正在开始…' : '开始创作'}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </>
  )
}

function QuickStartCreation({ runId, onCreateAnother }: { runId: string; onCreateAnother: () => void }) {
  const navigate = useNavigate()
  const query = useWorkflowRun(runId)

  if (query.loading) return <p className="text-sm text-slate-500">正在准备创作…</p>
  if (query.error) return <p className="text-sm text-red-600">无法继续这次创作：{query.error.message}</p>
  if (!query.data) return <p className="text-sm text-red-600">未找到这次创作记录。</p>

  const run = query.data
  const revision = getCurrentRevision(run)
  const activeNode = revision.nodes.find((node) => node.status === 'active')
  const [title, detail] = CREATION_COPY[activeNode?.type ?? 'export']
  const completed = revision.generationStatus === 'completed'
  const canOpenPlaytest = Boolean(run.characterId && canImportToPlaytest(run, revision.id))

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={completed ? '角色创作完成' : title}
        subtitle={run.prompt ?? '正在根据你的描述准备角色。'}
        actions={
          <button
            type="button"
            onClick={onCreateAnother}
            className="shrink-0 whitespace-nowrap text-sm text-slate-600 hover:text-slate-900"
          >
            新建创作
          </button>
        }
      />

      <section aria-label="创作进度" className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-6">
        <div>
          <p className="text-base font-semibold">{completed ? '已经为你准备好结果。' : title}</p>
          <p className="mt-1 text-sm text-slate-600">{completed ? '你可以继续导出或导入核验台。' : detail}</p>
        </div>
        <ol className="grid gap-2 text-sm sm:grid-cols-3">
          {['理解设定', '生成角色', '检查交付'].map((label, index) => {
            const currentIndex = activeNode ? Math.min(activeNode.order, 2) : 2
            const state = completed || index < currentIndex ? '已完成' : index === currentIndex ? '进行中' : '等待中'
            return (
              <li key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                <p className="font-medium text-slate-800">{label}</p>
                <p className="mt-1 text-xs text-slate-500">{state}</p>
              </li>
            )
          })}
        </ol>
      </section>

      {completed ? (
        <section className="space-y-3 rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold">下一步</h2>
          <p className="text-sm text-slate-600">
            导出服务会在后端任务接入后显示下载入口。核验台可独立记录试用结果，不会影响当前完成状态。
          </p>
          {canOpenPlaytest ? (
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/playtest/${encodeURIComponent(run.characterId!)}?runId=${encodeURIComponent(run.id)}` +
                    `&revision=${encodeURIComponent(revision.id)}`,
                )
              }
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
            >
              导入核验台
            </button>
          ) : null}
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
          <p className="font-medium text-slate-800">生成服务暂未连接</p>
          <p className="mt-1">服务接入后，这里会持续更新创作进度和结果；当前不会显示虚假的完成结果。</p>
        </section>
      )}
    </div>
  )
}
