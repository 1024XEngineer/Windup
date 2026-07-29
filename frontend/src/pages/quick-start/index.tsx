import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import type { QuickStartPort, QuickStartSessionSnapshot } from '@/features/quick-start'
import { PageHeader } from '@/shared/ui'

export interface QuickStartPageProps {
  /** 页面只调用 Quick Start 用例，不直接操作生成、Repository 或重启端口。 */
  quickStart: QuickStartPort
}

/** Quick Start 独立页面；页面只调用用例，项目与 WorkflowRun 由用例协调创建。 */
export function QuickStartPage({ quickStart }: QuickStartPageProps) {
  const { runId } = useParams()
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<QuickStartSessionSnapshot | null>(null)

  useEffect(() => {
    if (!runId) return
    let active = true
    async function refresh(): Promise<void> {
      try {
        const snapshot = await quickStart.getSession(runId ?? '')
        if (active) {
          setSession(snapshot)
          setError(null)
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : '读取创作会话失败')
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 250)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [quickStart, runId])

  async function start(): Promise<void> {
    if (!prompt.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const session = await quickStart.start({ prompt: prompt.trim() })
      navigate(`/quick-start/${encodeURIComponent(session.runId)}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '开始创作失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function interruptSession(): Promise<void> {
    if (!runId) return
    try {
      await quickStart.interrupt(runId)
      setSession(await quickStart.getSession(runId))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '中断创作会话失败')
    }
  }

  if (runId) {
    const statusText = session
      ? session.status === 'active'
        ? session.currentStage === 'review'
          ? '等待人工审核'
          : '自动制作中'
        : session.status === 'completed'
          ? '制作已完成'
          : session.status === 'interrupted'
            ? '制作已中断'
            : '制作失败'
      : '正在恢复会话…'
    return (
      <>
        <PageHeader title="快速开始" subtitle={`创作会话 ${runId}`} />
        <section className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
          <p className="font-medium text-slate-800">自动制作会话</p>
          <p className="mt-2">{statusText}</p>
          <p className="mt-2">
            Quick Start 会隐藏节点细节，但内部仍使用与 Workflow Editor 相同的 WorkflowRun。
          </p>
          {session?.status === 'active' ? (
            <button
              type="button"
              onClick={() => void interruptSession()}
              className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm"
            >
              中断自动制作
            </button>
          ) : null}
          {error ? <p className="mt-2 text-red-600">读取失败：{error}</p> : null}
        </section>
      </>
    )
  }

  return (
    <>
      <PageHeader title="快速开始" subtitle="用自然语言和参考图描述最终产物。" />
      <section className="space-y-4 rounded-xl border border-slate-200 p-6">
        <label htmlFor="quick-start-prompt" className="block text-sm font-medium">
          创作描述
        </label>
        <textarea
          id="quick-start-prompt"
          rows={4}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：一个戴斗篷的像素小骑士，要走路、奔跑和跳跃"
          className="w-full rounded-lg border border-slate-200 p-3 text-sm"
        />
        <p className="text-sm text-slate-500">
          底层媒体上传已可用；参考图控件将在 Quick Start 用例实现时接入。
        </p>
        <button
          type="button"
          disabled={!prompt.trim() || submitting}
          onClick={() => void start()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {submitting ? '正在创建…' : '开始创作'}
        </button>
        {error ? <p className="text-sm text-red-600">创建失败：{error}</p> : null}
      </section>
    </>
  )
}
