import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'

import {
  WORKFLOW_STEP_ORDER,
  type CharacterTemplateWorkflowStep,
  type WorkflowRevision,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowStepType,
} from '@/entities'
import { unavailableQuickStartService, type QuickStartService } from './service'

export type {
  CreateQuickStartServiceOptions,
  PrepareQuickStartProject,
  QuickStartService,
} from './service'

const STEP_LABELS: Record<WorkflowStepType, string> = {
  'character-setup': '角色设定',
  'character-template': '角色图',
  'template-candidate': '候选选择',
  'action-setup': '动作设定',
  'first-frame': '动作首帧',
  'complete-animation': '完整动画',
  review: '审核',
  export: '导出',
}

const EXAMPLES = [
  {
    label: '像素守夜人',
    prompt: '一位提着风灯、披深色斗篷的像素守夜人',
  },
  {
    label: '轻装信使',
    prompt: '轻装信使，侧视像素风，轮廓清晰，动作轻快',
  },
] as const

export interface QuickStartPageProps {
  /**
   * 页面测试与后续生产组合可以注入同一份服务实例。
   * 默认实现明确不可用，直到真实 Project / Generation / Task 实现到位。
   */
  service?: QuickStartService
}

/** Quick Start 独立完成 AI 入口；它不跳转 Workflow Editor。 */
export function QuickStartPage({ service = unavailableQuickStartService }: QuickStartPageProps) {
  const { runId } = useParams()

  return runId ? (
    <QuickStartRun service={service} runId={runId} />
  ) : (
    <QuickStartInput service={service} />
  )
}

function QuickStartInput({ service }: { service: QuickStartService }) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unavailableReason = service.unavailableReason

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt || submitting || unavailableReason) return

    setSubmitting(true)
    setError(null)
    try {
      const run = await service.start(normalizedPrompt)
      navigate(`/quick-start/${encodeURIComponent(run.id)}`)
    } catch (cause) {
      setError(errorMessage(cause, '创建失败，请稍后重试'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="relative min-h-[640px] overflow-hidden rounded-[2rem] border border-[#c9d0ca] bg-[#dfe3df] text-[#171817] shadow-[0_26px_80px_rgba(31,43,35,0.10)]">
      <AmbientGrid />

      <div className="relative z-10 grid min-h-[640px] grid-rows-[auto_1fr_auto] p-5 sm:p-8">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[#687069]">
              QUICK START / CREATE CHARACTER
            </p>
            <h1 className="mt-3 max-w-3xl font-serif text-3xl leading-tight tracking-[-0.035em] sm:text-5xl">
              用一句角色设定，
              <br />
              开始一条可追踪的制作流程。
            </h1>
          </div>
          <span className="hidden rounded-full border border-[#bcc6be] bg-[#f3f5f1]/80 px-4 py-2 text-xs font-semibold text-[#35583f] sm:inline-flex">
            AI 快捷创作
          </span>
        </header>

        <div className="grid items-center gap-8 py-12 lg:grid-cols-[1fr_220px]">
          <button
            type="button"
            onClick={() => setPrompt(EXAMPLES[0].prompt)}
            className="group flex min-h-24 w-full items-center gap-4 rounded-full border border-[#c4cbc5] bg-[#f7f8f4] px-7 text-left shadow-[0_18px_45px_rgba(31,43,35,0.09)] transition hover:-translate-y-0.5 hover:border-[#8fa092] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#35583f] motion-reduce:transform-none"
          >
            <span className="shrink-0 text-sm font-semibold text-[#747973]">你可能想做：</span>
            <strong className="text-base font-semibold text-[#35583f] sm:text-xl">
              {EXAMPLES[0].prompt}
            </strong>
          </button>

          <div
            className="mx-auto grid aspect-square w-44 grid-cols-7 gap-1 rounded-[1.4rem] border border-[#c4cbc5] bg-[#eef1ed] p-5 shadow-[0_18px_45px_rgba(31,43,35,0.08)]"
            aria-hidden="true"
          >
            {Array.from({ length: 49 }, (_, index) => {
              const row = Math.floor(index / 7)
              const column = index % 7
              const active =
                (row === 1 && column >= 2 && column <= 4) ||
                (row >= 2 && row <= 4 && column >= 1 && column <= 5) ||
                (row === 5 && (column === 2 || column === 4))
              return (
                <i
                  key={index}
                  className={`rounded-[2px] ${active ? 'bg-[#35583f]' : 'bg-[#d9ded8]'}`}
                />
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            {EXAMPLES.slice(1).map((example) => (
              <button
                key={example.label}
                type="button"
                onClick={() => setPrompt(example.prompt)}
                className="rounded-full border border-[#c4cbc5] bg-[#f3f5f1] px-3 py-1.5 text-[11px] font-medium text-[#687069] hover:border-[#8fa092] hover:text-[#35583f]"
              >
                {example.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(event) => void submit(event)}
            className="grid gap-3 rounded-[1.4rem] border border-[#bdc7bf] bg-[#f7f8f4] p-4 shadow-[0_22px_60px_rgba(31,43,35,0.12)] sm:grid-cols-[1fr_auto]"
          >
            <label className="grid gap-2" htmlFor="quick-start-prompt">
              <span className="sr-only">创作指令</span>
              <textarea
                id="quick-start-prompt"
                aria-label="创作指令"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={2}
                placeholder="描述你想生成的角色、身份特征和视觉风格…"
                className="min-h-16 w-full resize-none border-0 bg-transparent px-2 py-1 text-[15px] leading-relaxed text-[#1d251f] outline-none placeholder:text-[#7a817b]"
              />
              <span className="flex flex-wrap items-center gap-2 px-2 text-[10px] text-[#747973]">
                <b className="rounded-full border border-[#c9d0ca] bg-[#e7ebe5] px-2.5 py-1 font-medium text-[#515a53]">
                  文字创建
                </b>
                角色图生成后仍需人工选择候选
              </span>
            </label>

            <button
              type="submit"
              disabled={!prompt.trim() || submitting || Boolean(unavailableReason)}
              className="min-h-20 min-w-32 rounded-[1rem] bg-[#35583f] px-5 text-sm font-bold text-[#f3f6f2] transition hover:bg-[#456c51] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? '正在创建…' : '开始生成'}
            </button>
          </form>

          {unavailableReason ? (
            <p className="mt-3 rounded-xl border border-[#c7a967] bg-[#f4eddc] px-4 py-3 text-sm text-[#67552e]">
              {unavailableReason}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-[#311b19] px-4 py-3 text-sm text-[#ffd3cc]"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function QuickStartRun({ service, runId }: { service: QuickStartService; runId: string }) {
  const navigate = useNavigate()
  const [run, setRun] = useState<WorkflowRun | null>(() => service.getWorkflow(runId))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const current = service.getWorkflow(runId)
    setRun(current)
    setError(current ? null : service.unavailableReason)
    if (!current) return

    const unsubscribe = service.subscribe(runId, (updated) => {
      setRun(updated)
      setError(null)
    })
    void service.resume(runId).catch((cause) => {
      if (active) setError(errorMessage(cause, '恢复生成任务失败'))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [runId, service])

  if (!run) {
    return (
      <section className="min-h-[520px] rounded-[2rem] border border-[#c9d0ca] bg-[#e8ebe7] p-8 text-[#26302a]">
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[#687069]">
          QUICK START / RECOVERY
        </p>
        <h1 className="mt-4 font-serif text-4xl">无法恢复这次创作</h1>
        <p role="alert" className="mt-4 max-w-xl text-sm leading-7 text-[#687069]">
          {error || `没有找到运行记录 ${runId}`}
        </p>
        <button
          type="button"
          onClick={() => navigate('/quick-start')}
          className="mt-8 rounded-xl bg-[#35583f] px-5 py-3 text-sm font-semibold text-white"
        >
          返回快速开始
        </button>
      </section>
    )
  }

  const revision = currentRevision(run)
  const status = describeRun(run, revision)
  const templateStep = revision.steps.find(
    (step): step is CharacterTemplateWorkflowStep => step.type === 'character-template',
  )
  const candidates = templateStep?.output?.images ?? []
  const passedCount = revision.steps.filter((step) => step.status === 'passed').length

  async function interrupt() {
    try {
      const interrupted = service.interrupt(runId)
      if (interrupted) setRun(interrupted)
    } catch (cause) {
      setError(errorMessage(cause, '中断自动制作失败'))
    }
  }

  return (
    <section className="relative min-h-[640px] overflow-hidden rounded-[2rem] border border-[#c9d0ca] bg-[#e3e7e2] text-[#171817] shadow-[0_26px_80px_rgba(31,43,35,0.10)]">
      <AmbientGrid />
      <div className="relative z-10 grid min-h-[640px] grid-rows-[auto_1fr_auto] gap-6 p-5 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[#687069]">
              QUICK START / RUN {run.id}
            </p>
            <h1 className="mt-2 font-serif text-3xl tracking-[-0.03em] sm:text-4xl">
              {run.prompt || '未命名角色创作'}
            </h1>
          </div>
          <div
            className="flex items-center gap-3 rounded-xl border border-[#c4cbc5] bg-[#f7f8f4]/90 px-4 py-3"
            aria-live="polite"
          >
            <i
              className={`h-2.5 w-2.5 rounded-full ${
                run.status === 'active' ? 'animate-pulse bg-[#4f7b5b]' : 'bg-[#8c938d]'
              } motion-reduce:animate-none`}
              aria-hidden="true"
            />
            <span>
              <small className="block font-mono text-[8px] tracking-[0.12em] text-[#747973]">
                CURRENT STATUS
              </small>
              <b className="text-sm text-[#35583f]">{status.title}</b>
            </span>
          </div>
        </header>

        <div className="grid min-h-0 gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="grid min-h-[340px] place-items-center overflow-hidden rounded-[1.4rem] border border-[#c4cbc5] bg-[#eef1ed]/90 p-5">
            {candidates.length ? (
              <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3">
                {candidates.map((candidate, index) => (
                  <figure
                    key={`${candidate.url}:${index}`}
                    className="overflow-hidden rounded-xl border border-[#c7cec8] bg-[#e7ebe6] p-3"
                  >
                    <img
                      src={candidate.url}
                      alt={`角色图候选 ${index + 1}`}
                      className="aspect-square w-full object-contain [image-rendering:pixelated]"
                    />
                    <figcaption className="mt-2 font-mono text-[9px] tracking-[0.1em] text-[#687069]">
                      CANDIDATE {String(index + 1).padStart(2, '0')}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="grid place-items-center gap-5 text-center">
                <div className="relative grid h-44 w-44 place-items-center rounded-[1.4rem] border border-dashed border-[#aeb9b0] bg-[#e5e9e4]">
                  <i className="h-12 w-12 animate-pulse rounded-full border border-[#819184] bg-[#d5ddd6] shadow-[0_0_0_16px_rgba(53,88,63,0.05)] motion-reduce:animate-none" />
                </div>
                <span>
                  <b className="block text-base text-[#354039]">{status.title}</b>
                  <small className="mt-2 block max-w-md leading-6 text-[#687069]">
                    {status.description}
                  </small>
                </span>
              </div>
            )}
          </section>

          <aside className="rounded-[1.4rem] border border-[#c4cbc5] bg-[#f7f8f4]/95 p-5">
            <p className="font-mono text-[9px] font-bold tracking-[0.13em] text-[#747973]">
              WORKFLOW RUN
            </p>
            <h2 className="mt-2 text-lg font-semibold">制作进度</h2>
            <p className="mt-2 text-xs leading-6 text-[#687069]">
              Quick Start 隐藏节点操作，但每一步仍写入同一条 WorkflowRun。
            </p>

            <ol className="mt-5 grid gap-2">
              {revision.steps.map((step, index) => (
                <li
                  key={step.id}
                  className={`grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2 ${
                    step.status === 'active'
                      ? 'border-[#91a394] bg-[#e4ebe2]'
                      : 'border-[#d5dad5] bg-[#f0f2ef]'
                  }`}
                >
                  <i
                    className={`grid h-7 w-7 place-items-center rounded-full text-[9px] not-italic ${
                      step.status === 'passed'
                        ? 'bg-[#35583f] text-white'
                        : step.status === 'active'
                          ? 'border border-[#6f8874] text-[#35583f]'
                          : 'border border-[#d0d6d1] text-[#8b918c]'
                    }`}
                  >
                    {step.status === 'passed' ? '✓' : String(index + 1).padStart(2, '0')}
                  </i>
                  <span className="text-xs font-semibold text-[#515a53]">
                    {STEP_LABELS[step.type]}
                  </span>
                  <small className="text-[9px] text-[#7a817b]">{stepStatusLabel(step)}</small>
                </li>
              ))}
            </ol>
          </aside>
        </div>

        <footer className="rounded-[1.3rem] border border-[#c4cbc5] bg-[#f7f8f4]/95 p-4 shadow-[0_18px_50px_rgba(31,43,35,0.10)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span>
              <small className="font-mono text-[8px] tracking-[0.12em] text-[#747973]">
                {passedCount} / {WORKFLOW_STEP_ORDER.length} STEPS PASSED
              </small>
              <b className="mt-1 block text-sm text-[#354039]">{status.title}</b>
            </span>
            <div className="flex flex-wrap gap-2">
              {run.status === 'active' ? (
                <button
                  type="button"
                  onClick={() => void interrupt()}
                  className="rounded-xl border border-[#aeb8b0] px-4 py-2 text-xs font-semibold text-[#515a53]"
                >
                  中断自动制作
                </button>
              ) : null}
              {candidates.length || run.status === 'failed' || run.status === 'interrupted' ? (
                <button
                  type="button"
                  onClick={() => navigate('/quick-start')}
                  className="rounded-xl bg-[#35583f] px-4 py-2 text-xs font-semibold text-white"
                >
                  新建一次创作
                </button>
              ) : null}
            </div>
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-[#8b332a]">
              {error}
            </p>
          ) : null}
          {status.error ? (
            <p role="alert" className="mt-3 text-sm text-[#8b332a]">
              {status.error}
            </p>
          ) : null}
        </footer>
      </div>
    </section>
  )
}

function AmbientGrid() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-50"
      aria-hidden="true"
      style={{
        backgroundImage:
          'linear-gradient(rgba(53, 88, 63, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(53, 88, 63, 0.045) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        maskImage: 'linear-gradient(to bottom, black, transparent 84%)',
      }}
    />
  )
}

function currentRevision(run: WorkflowRun): WorkflowRevision {
  const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
  if (!revision) throw new Error(`WorkflowRun ${run.id} 缺少当前版本`)
  return revision
}

function describeRun(run: WorkflowRun, revision: WorkflowRevision) {
  const failedStep = revision.steps.find((step) => step.status === 'failed')
  if (run.status === 'failed') {
    return {
      title: '生成失败',
      description: '这次失败已保存在当前运行记录中，不会自动创建第二次任务。',
      error: failedStep?.error || '角色图生成失败',
    }
  }
  if (run.status === 'interrupted') {
    return {
      title: '自动制作已中断',
      description: '运行记录与已经返回的结果仍然保留。',
      error: null,
    }
  }

  const templateStep = revision.steps.find(
    (step): step is CharacterTemplateWorkflowStep => step.type === 'character-template',
  )
  if (templateStep?.output?.images.length) {
    return {
      title: '角色图已生成',
      description: '候选结果已到达。下一步需要人工选择，不会自动写入正式资产。',
      error: null,
    }
  }
  if (templateStep?.status === 'active') {
    return {
      title: templateStep.taskId ? '正在生成角色图' : '正在创建生成任务',
      description: templateStep.taskId
        ? '任务 ID 已保存，刷新页面后仍可恢复同一次生成。'
        : '正在等待生成服务返回可追踪的任务 ID。',
      error: null,
    }
  }
  return {
    title: '正在理解角色设定',
    description: '正在把创作指令整理成角色资料。',
    error: null,
  }
}

function stepStatusLabel(step: WorkflowStep) {
  if (step.status === 'passed') return '完成'
  if (step.status === 'active') return '当前'
  if (step.status === 'failed') return '失败'
  return '等待'
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message.trim() : fallback
}
