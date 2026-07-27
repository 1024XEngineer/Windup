import { useState } from 'react'

import {
  createWorkflowRun,
  submitWorkflowStep,
  suggestNextCommand,
  useWorkflowRun,
} from '@/entities'
import { CharacterSetup } from '@/features/character-setup'
import { Generation } from '@/features/generation'
import { PageHeader } from '@/shared/ui'

/**
 * AI 快速生成页。创建 AI 驱动的 WorkflowRun 后继续在本页展示进度和结果，
 * 不进入独立的 Workflow Editor。
 */
export function QuickStartPage() {
  const [description, setDescription] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setSubmitting(true)
    setError(null)
    // 记在 try 外面：中途失败时也要把 run 显示出来，否则它只存在于
    // localStorage 里，用户既看不到推进到哪一步，也没法接着处理。
    let createdRunId: string | null = null
    try {
      // 待实现：先解析描述得到计划；项目 id 暂用快速开始的默认项目
      const createdRun = await createWorkflowRun({
        projectId: 1,
        driver: 'ai',
        prompt: description,
      })
      createdRunId = createdRun.id
      const plan = quickStartPlan(description)
      let currentRun = createdRun
      // 上限对应 suggestNextCommand 当前的流程：生成母版、确认母版、收尾各一条，
      // 每个动作两条（add-action + generate-action）。改流程要同步改这里。
      const maxCommands = 3 + plan.actionNames.length * 2

      for (let index = 0; index < maxCommands; index += 1) {
        const command = suggestNextCommand(currentRun, plan)
        if (!command) break
        currentRun = await submitWorkflowStep(currentRun.id, command)
      }

      if (suggestNextCommand(currentRun, plan)) {
        throw new Error('AI 工作流超过预期步数，已停止自动推进')
      }
      setRunId(currentRun.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      if (createdRunId) setRunId(createdRunId)
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
      {runId ? <QuickStartRun runId={runId} /> : null}
    </>
  )
}

function QuickStartRun({ runId }: { runId: string }) {
  const { data: run, loading, error } = useWorkflowRun(runId)

  if (loading) return <p className="mt-8 text-sm text-slate-400">加载生成结果…</p>
  if (error) return <p className="mt-8 text-sm text-red-500">加载失败：{error.message}</p>
  if (!run) return null

  return (
    <section className="mt-8 space-y-4" aria-label="AI 快速生成">
      <p className="text-sm text-slate-500">
        AI 快速生成已启动 · 运行 {run.id} · 状态 {run.status}
      </p>
      <Generation runId={run.id} />
    </section>
  )
}

/** Mock 阶段先从文本里取明确动作；真实 AI 解析后替换这个入口。 */
function quickStartPlan(description: string): { description: string; actionNames: string[] } {
  const actions = [
    { name: '待机', aliases: ['待机'] },
    { name: '行走', aliases: ['行走', '走路'] },
    { name: '奔跑', aliases: ['奔跑', '跑步'] },
    { name: '跳跃', aliases: ['跳跃', '跳起'] },
    { name: '攻击', aliases: ['攻击'] },
    { name: '蹲下', aliases: ['蹲下', '下蹲'] },
  ]

  return {
    description,
    actionNames: actions
      .filter((action) => action.aliases.some((alias) => description.includes(alias)))
      .map((action) => action.name),
  }
}
