import { useState } from 'react'
import { useNavigate } from 'react-router'

import { createWorkflowRun } from '@/entities'
import { PageHeader } from '@/shared/ui'

/** Quick Start 只生成统一工作流的初始输入，不维护第二套生成流程。 */
export function QuickStartPage() {
  const navigate = useNavigate()
  const [description, setDescription] = useState('')
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
      const run = await createWorkflowRun({
        projectId: 'quick-start',
        driver: 'ai',
        prompt,
      })
      navigate(`/workflow-editor/${run.id}/generation`)
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
          {submitting ? '创建中…' : '进入工作流'}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </>
  )
}
