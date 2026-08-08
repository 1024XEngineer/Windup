import { type FormEvent, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import type { QuickStartService, QuickStartView } from './service'
import { unavailableQuickStartService } from './service'

const EXAMPLES = [
  '轻装信使，侧视像素风，轮廓清晰',
  '戴护目镜的机械师，明亮街机风格',
  '披斗篷的森林法师，动作轻快',
]

export interface QuickStartPageProps {
  service?: QuickStartService
}

/** Quick Start 是独立 AI 界面；节点推进仍交给与 Workflow Editor 共用的 Controller。 */
export function QuickStartPage({ service = unavailableQuickStartService }: QuickStartPageProps) {
  const { runId } = useParams<{ runId: string }>()
  return runId ? (
    <QuickStartRun service={service} runId={runId} />
  ) : (
    <QuickStartInput service={service} />
  )
}

function QuickStartInput({ service }: { service: QuickStartService }) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [actionDescription, setActionDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting || service.unavailableReason || !prompt.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await service.start({
        prompt: prompt.trim(),
        actionDescription: actionDescription.trim() || null,
      })
      navigate(`/quick-start/${encodeURIComponent(result.runId)}`)
    } catch (cause) {
      setError(errorMessage(cause, '创建失败，请稍后重试'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
      <header className="border-b border-slate-200 pb-7">
        <p className="text-xs font-semibold text-emerald-700">QUICK START</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950 sm:text-4xl">
          一句话完成角色与动作
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          AI 自动推进同一条工作流，你只需描述目标并审核最终动画。
        </p>
      </header>

      <form onSubmit={(event) => void submit(event)} className="mt-8 space-y-5">
        <label className="block text-sm font-medium text-slate-800" htmlFor="quick-start-prompt">
          角色描述
          <textarea
            id="quick-start-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            maxLength={600}
            placeholder="例如：轻装信使，侧视像素风，轮廓清晰"
            className="mt-2 w-full resize-y border border-slate-300 bg-white p-4 text-base outline-none focus:border-emerald-600"
          />
        </label>

        <div className="flex flex-wrap gap-2" aria-label="示例描述">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 hover:border-slate-400"
            >
              {example}
            </button>
          ))}
        </div>

        <label className="block text-sm font-medium text-slate-800" htmlFor="quick-start-action">
          动作描述（可选）
          <input
            id="quick-start-action"
            value={actionDescription}
            onChange={(event) => setActionDescription(event.target.value)}
            placeholder="例如：向前奔跑；留空则生成待机动作"
            className="mt-2 w-full border border-slate-300 bg-white p-3 outline-none focus:border-emerald-600"
          />
        </label>

        {(error || service.unavailableReason) && (
          <p
            role="alert"
            className="border-l-4 border-rose-500 bg-rose-50 p-3 text-sm text-rose-800"
          >
            {error ?? service.unavailableReason}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || Boolean(service.unavailableReason) || !prompt.trim()}
          className="bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? '正在创建工作流...' : '开始自动生成'}
        </button>
      </form>
    </main>
  )
}

function QuickStartRun({ service, runId }: { service: QuickStartService; runId: string }) {
  const navigate = useNavigate()
  const [view, setView] = useState<QuickStartView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    service.load(runId).then(
      (next) => {
        if (!active) return
        setView(next)
        setLoading(false)
      },
      (cause: unknown) => {
        if (!active) return
        setError(errorMessage(cause, '恢复创作任务失败'))
        setLoading(false)
      },
    )
    const unsubscribe = service.subscribe(runId, (next) => {
      if (active) setView(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [runId, service])

  useEffect(() => {
    const frameCount = view?.animationFrames.length ?? 0
    if (!playing || frameCount < 2) return
    const timer = window.setInterval(
      () => setFrameIndex((index) => (index + 1) % frameCount),
      1000 / Math.max(view?.fps ?? 12, 1),
    )
    return () => window.clearInterval(timer)
  }, [playing, view?.animationFrames.length, view?.fps])

  async function interrupt() {
    if (busy) return
    setBusy(true)
    try {
      await service.interrupt(runId)
    } catch (cause) {
      setError(errorMessage(cause, '中断失败'))
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    if (busy || view?.status !== 'review') return
    setBusy(true)
    try {
      const target = await service.approve(runId)
      navigate(
        `/playtest/${encodeURIComponent(target.characterId)}/${encodeURIComponent(target.outfitId)}`,
      )
    } catch (cause) {
      setError(errorMessage(cause, '审核保存失败'))
      setBusy(false)
    }
  }

  if (loading) return <PageMessage>正在恢复创作任务...</PageMessage>
  if (error && !view) return <PageMessage tone="error">{error}</PageMessage>
  if (!view) return <PageMessage tone="error">没有找到这次创作任务</PageMessage>

  const currentFrame = view.animationFrames[frameIndex % Math.max(view.animationFrames.length, 1)]

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold text-emerald-700">
            QUICK START · {runId.slice(0, 8)}
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{view.title}</h1>
          <p role="status" className="mt-2 text-sm text-slate-600">
            {view.message}
          </p>
        </div>
        {view.status === 'running' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void interrupt()}
            className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
          >
            中断自动生成
          </button>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="mt-5 border-l-4 border-rose-500 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-h-96 items-center justify-center border border-slate-200 bg-slate-50 p-6">
          {currentFrame ? (
            <img
              src={currentFrame}
              alt={`动画第 ${frameIndex + 1} 帧`}
              className="max-h-80 max-w-full object-contain [image-rendering:pixelated]"
            />
          ) : (
            <p className="text-sm text-slate-500">动画生成完成后会在这里预览</p>
          )}
        </div>
        <aside className="border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">自动流程</h2>
          <p className="mt-2 text-sm text-slate-600">
            已完成 {view.completedNodes} / {view.totalNodes} 个节点
          </p>
          <p className="mt-2 text-xs text-slate-500">
            资产路线：{generationMethodLabel(view.generationMethod)}
          </p>
          {view.animationFrames.length > 0 && (
            <div className="mt-5 space-y-3">
              <p className="text-xs text-slate-500">
                第 {frameIndex + 1} / {view.animationFrames.length} 帧
              </p>
              <button
                type="button"
                onClick={() => setPlaying((value) => !value)}
                className="w-full border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                {playing ? '暂停播放' : '继续播放'}
              </button>
            </div>
          )}
          {view.status === 'review' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void approve()}
              className="mt-5 w-full bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
            >
              审核通过并打开预览台
            </button>
          )}
        </aside>
      </section>
    </main>
  )
}

function PageMessage({
  children,
  tone = 'normal',
}: {
  children: string
  tone?: 'normal' | 'error'
}) {
  return (
    <main
      className={`mx-auto mt-16 max-w-xl border p-6 text-sm ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700'}`}
    >
      {children}
    </main>
  )
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback
}

function generationMethodLabel(method: QuickStartView['generationMethod']) {
  if (method === 'video-cropping') return '视频裁剪（自动选择）'
  if (method === '3d-to-2d') return '3D 转 2D（自动选择）'
  return '等待首帧确认'
}
