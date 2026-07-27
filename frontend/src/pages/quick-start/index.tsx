import { useState } from 'react'
import { useNavigate } from 'react-router'

import { createWorkflowRun } from '@/entities'
import { CharacterSetup } from '@/features/character-setup'
import { PageHeader } from '@/shared/ui'

/**
 * 首页。解析一句话描述后，调 CharacterSetup、Generation，创建/恢复 WorkflowRun，
 * 跳转 workflow-editor/${runId}。后台自动建项目，跳过创建步骤。
 */
export function QuickStartPage() {
  const navigate = useNavigate()
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setSubmitting(true)
    setError(null)
    try {
      // 待实现：先解析描述得到计划；项目 id 暂用快速开始的默认项目
      const run = await createWorkflowRun({ projectId: 1, driver: 'ai', prompt: description })
      navigate(`/workflow-editor/${run.id}`)
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
          rows={3}
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
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
      </form>
      <div className="mt-8">
        <CharacterSetup projectId={1} />
      </div>
    </>
  )
}
