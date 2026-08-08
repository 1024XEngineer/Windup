import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import {
  type CharacterTemplateWorkflowNode,
  type WorkflowRun,
  type WorkflowNode,
  type WorkflowNodeType,
} from '@/entities'
import { buildPlaytestPath, buildPublishedActionId } from '@/features/publish'
import { unavailableQuickStartService, type QuickStartService } from './service'

export type {
  CreateQuickStartServiceOptions,
  PrepareQuickStartProject,
  QuickStartService,
} from './service'

const STEP_LABELS: Record<WorkflowNodeType, string> = {
  'character-setup': '角色设定',
  'character-template': '角色图',
  'action-first-frame': '候选选择',
  'action-generation-method': '生成路线',
  'action-full-frame': '动作生成',
  review: '审核',
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
   * 默认实现明确不可用，直到真实 Project / Character / Generation 实现到位。
   */
  service?: QuickStartService
}

/** Quick Start 独立完成 AI 入口；它不跳转 Workflow Editor。 */
export function QuickStartPage({ service = unavailableQuickStartService }: QuickStartPageProps) {
  const { runId } = useParams()
  const [searchParams] = useSearchParams()
  const characterId = searchParams.get('characterId')
  const outfitId = searchParams.get('outfitId')

  return runId ? (
    <QuickStartRun service={service} runId={runId} />
  ) : characterId && outfitId ? (
    <QuickStartActionInput service={service} target={{ characterId, outfitId }} />
  ) : (
    <QuickStartInput service={service} />
  )
}

function QuickStartActionInput({
  service,
  target,
}: {
  service: QuickStartService
  target: { characterId: string; outfitId: string }
}) {
  const navigate = useNavigate()
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = description.trim()
    if (!prompt || submitting || service.unavailableReason) return
    setSubmitting(true)
    setError(null)
    try {
      const run = await service.startAction(target, prompt)
      navigate(`/quick-start/${encodeURIComponent(run.id)}`)
    } catch (cause) {
      setError(errorMessage(cause, '创建动作失败，请稍后重试'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="min-h-[560px] border border-[#c9d0ca] bg-[#dfe3df] p-6 text-[#171817] sm:p-10">
      <Link
        to={buildPlaytestPath(target)}
        className="text-xs font-semibold text-[#59635b] hover:text-[#2f4e38]"
      >
        ← 返回当前 Playtest
      </Link>
      <div className="mx-auto mt-14 max-w-2xl">
        <p className="font-mono text-[10px] font-bold text-[#687069]">ADD ACTION</p>
        <h1 className="mt-3 font-serif text-4xl">给当前角色增加动作</h1>
        <p className="mt-3 text-sm text-[#687069]">
          新动作会追加到角色 {target.characterId} 的当前造型，不会新建角色或覆盖已有动作。
        </p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block text-xs font-semibold text-[#4f5b52]">
            动作描述
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例如：挥手打招呼、蹲下查看地面、举起画笔作画"
              className="mt-2 min-h-32 w-full resize-y rounded-lg border border-[#aeb8b0] bg-white p-4 text-base outline-none focus:border-[#35583f]"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-[#983c32]">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!description.trim() || submitting || Boolean(service.unavailableReason)}
            className="min-h-11 rounded-lg bg-[#35583f] px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? '正在开始生成…' : '开始生成新动作'}
          </button>
        </form>
      </div>
    </section>
  )
}

function QuickStartInput({ service }: { service: QuickStartService }) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const submitAbortController = useRef<AbortController | null>(null)
  const unavailableReason = service.unavailableReason

  useEffect(
    () => () => {
      submitAbortController.current?.abort()
    },
    [],
  )

  function selectTemplateFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    setTemplateFile(selected)
    setError(null)
  }

  function removeTemplateFile() {
    setTemplateFile(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedPrompt = prompt.trim()
    if ((!normalizedPrompt && !templateFile) || submitting || unavailableReason) return

    const abortController = new AbortController()
    submitAbortController.current = abortController
    setSubmitting(true)
    setError(null)
    try {
      const run = templateFile
        ? await service.startWithUploadedTemplate(
            templateFile,
            normalizedPrompt,
            abortController.signal,
          )
        : await service.start(normalizedPrompt)
      navigate(`/quick-start/${encodeURIComponent(run.id)}`)
    } catch (cause) {
      if (!abortController.signal.aborted) {
        setError(errorMessage(cause, '创建失败，请稍后重试'))
      }
    } finally {
      if (submitAbortController.current === abortController) {
        submitAbortController.current = null
        if (!abortController.signal.aborted) setSubmitting(false)
      }
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
                placeholder={
                  templateFile
                    ? '例如：挥手打招呼、提灯前行（可留空生成待机动作）'
                    : '描述你想生成的角色、身份特征和视觉风格…'
                }
                className="min-h-16 w-full resize-none border-0 bg-transparent px-2 py-1 text-[15px] leading-relaxed text-[#1d251f] outline-none placeholder:text-[#7a817b]"
              />
              <span className="flex flex-wrap items-center gap-2 px-2 text-[10px] text-[#747973]">
                <b className="rounded-full border border-[#c9d0ca] bg-[#e7ebe5] px-2.5 py-1 font-medium text-[#515a53]">
                  文字创建
                </b>
                {templateFile
                  ? '动作描述（可选）：留空生成待机动作'
                  : '角色图生成后仍需人工选择候选'}
              </span>
              {templateFile ? (
                <span className="flex flex-wrap items-center gap-2 px-2 text-[11px] text-[#515a53]">
                  <b className="max-w-full truncate font-medium">{templateFile.name}</b>
                  <button
                    type="button"
                    onClick={removeTemplateFile}
                    className="rounded-full border border-[#b9c3bb] px-2 py-0.5 text-[10px] hover:border-[#8fa092] hover:text-[#35583f]"
                  >
                    移除图片
                  </button>
                </span>
              ) : null}
            </label>

            <div className="flex min-w-32 flex-col gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                aria-label="上传角色母版"
                className="sr-only"
                onChange={selectTemplateFile}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="min-h-9 rounded-xl border border-[#aeb8b0] bg-[#eef1ed] px-4 text-xs font-semibold text-[#515a53] transition hover:border-[#8fa092] hover:text-[#35583f]"
              >
                {templateFile ? '更换图片' : '上传角色母版'}
              </button>
              <button
                type="submit"
                disabled={
                  (!prompt.trim() && !templateFile) || submitting || Boolean(unavailableReason)
                }
                className="min-h-14 rounded-[1rem] bg-[#35583f] px-5 text-sm font-bold text-[#f3f6f2] transition hover:bg-[#456c51] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {submitting ? '正在创建…' : '开始生成'}
              </button>
            </div>
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
  const [run, setRun] = useState<WorkflowRun | null>(() => service.peekWorkflow(runId))
  const [error, setError] = useState<string | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [actionDescription, setActionDescription] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [confirmingCandidate, setConfirmingCandidate] = useState(false)
  const automaticPublishAttempt = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    const unsubscribe = service.subscribe(runId, (updated) => {
      if (active) {
        setRun(updated)
        setError(null)
      }
    })
    void service
      .resume(runId)
      .then((restored) => {
        if (!active) return
        setRun(restored)
        setError(restored ? null : service.unavailableReason)
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause, '恢复生成任务失败'))
      })

    // 兜底轮询：异步动作生成完成后 store subscription 可能漏掉，每 3s 刷新一次
    const pollTimer = setInterval(() => {
      if (!active) return
      const latest = service.peekWorkflow(runId)
      if (latest) setRun(latest)
    }, 3000)

    return () => {
      active = false
      unsubscribe()
      clearInterval(pollTimer)
    }
  }, [runId, service])

  const publishToPlaytest = useCallback(async () => {
    if (publishing) return
    setPublishing(true)
    setError(null)
    try {
      const approved = await service.approveReview(runId)
      setRun(approved)
      // 内存 Map / 持久化引用缺失时（旧运行记录），从后端按项目反查。
      const info = service.getCharacterInfo(runId) ?? (await service.resolveCharacterInfo(runId))
      if (!info) throw new Error('动作已生成，但没有找到对应的角色资产')
      const approvedAction = latestActionStep(approved)
      const actionId =
        approvedAction?.type === 'action-full-frame' && approvedAction.output
          ? buildPublishedActionId(info.characterId, approved.id, approvedAction.id)
          : undefined
      navigate(buildPlaytestPath({ ...info, actionId }))
    } catch (cause) {
      setError(errorMessage(cause, '导入 Playtest 失败'))
    } finally {
      setPublishing(false)
    }
  }, [navigate, publishing, runId, service])

  useEffect(() => {
    const publishKey = run ? automaticPublishKey(run) : null
    if (publishKey === null || publishing || automaticPublishAttempt.current === publishKey) return

    // 每个版本只自动尝试一次；失败后由页面保留的重试按钮交给用户明确触发。
    automaticPublishAttempt.current = publishKey
    void publishToPlaytest()
  }, [publishToPlaytest, publishing, run])

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

  const revision = run
  const status = describeRun(run, revision)
  const templateNode = revision.nodes.find(
    (n): n is CharacterTemplateWorkflowNode => n.type === 'character-template',
  )
  const candidates = templateNode?.output?.imageUrls ?? []
  const passedCount = revision.nodes.filter((node) => node.status === 'passed').length

  const actionStep = latestActionStep(revision)
  const actionFrames =
    actionStep?.type === 'action-full-frame' && actionStep.status === 'passed'
      ? (actionStep.output?.frames ?? [])
      : []
  const reviewStep = actionStep ? pairedReviewStep(revision, actionStep.id) : null
  const canPublish =
    actionFrames.length > 0 && (reviewStep?.status === 'active' || reviewStep?.status === 'passed')
  const isActionActive = actionStep?.status === 'active'
  const isActionFailed = actionStep?.status === 'failed'

  async function interrupt() {
    try {
      const interrupted = await service.interrupt(runId)
      if (interrupted) setRun(interrupted)
    } catch (cause) {
      setError(errorMessage(cause, '中断自动制作失败'))
    }
  }

  async function confirmSelection() {
    if (!selectedCandidate || confirmingCandidate) return
    setConfirmingCandidate(true)
    setError(null)
    try {
      const updated = await service.confirmCandidate(runId, selectedCandidate, actionDescription)
      setRun(updated)
      setSelectedCandidate(null)
      setActionDescription('')
    } catch (cause) {
      setError(errorMessage(cause, '确认选择失败'))
    } finally {
      setConfirmingCandidate(false)
    }
  }

  async function regenerate() {
    if (!run?.prompt) return
    try {
      const newRun = await service.start(run.prompt)
      navigate(`/quick-start/${encodeURIComponent(newRun.id)}`)
    } catch (cause) {
      setError(errorMessage(cause, '重新生成失败'))
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
            {actionFrames.length > 0 ? (
              <div className="grid w-full grid-cols-4 gap-2 sm:grid-cols-8">
                {actionFrames.map((frame, index) => (
                  <img
                    key={`${frame.imageUrl}:${index}`}
                    src={frame.imageUrl}
                    alt={`动作第 ${index + 1} 帧`}
                    className="aspect-square w-full border border-[#c7cec8] bg-[#e7ebe6] object-contain [image-rendering:pixelated]"
                  />
                ))}
              </div>
            ) : isActionActive ? (
              <div className="grid place-items-center gap-5 text-center">
                <div className="relative grid h-44 w-44 place-items-center rounded-[1.4rem] border border-dashed border-[#aeb9b0] bg-[#e5e9e4]">
                  <i className="h-12 w-12 animate-pulse rounded-full border border-[#819184] bg-[#d5ddd6] shadow-[0_0_0_16px_rgba(53,88,63,0.05)] motion-reduce:animate-none" />
                </div>
                <span>
                  <b className="block text-base text-[#354039]">正在生成动作</b>
                  <small className="mt-2 block max-w-md leading-6 text-[#687069]">
                    正在生成动作帧，请稍候…
                  </small>
                </span>
              </div>
            ) : isActionFailed ? (
              <div className="grid place-items-center gap-5 text-center">
                <b className="text-base text-[#8b332a]">动作生成失败</b>
                <small className="max-w-md leading-6 text-[#687069]">
                  {typeof actionStep?.error === 'string' ? actionStep.error : '动作生成失败'}
                </small>
              </div>
            ) : candidates.length ? (
              <div className="grid w-full gap-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {candidates.map((candidateUrl, index) => (
                    <button
                      key={`${candidateUrl}:${index}`}
                      type="button"
                      onClick={() => setSelectedCandidate(candidateUrl)}
                      className={`overflow-hidden rounded-xl border-2 p-2 text-left transition ${
                        selectedCandidate === candidateUrl
                          ? 'border-[#35583f] bg-[#d5e5d8]'
                          : 'border-[#c7cec8] bg-[#e7ebe6] hover:border-[#8fa092]'
                      }`}
                    >
                      <img
                        src={candidateUrl}
                        alt={`角色图候选 ${index + 1}`}
                        className="aspect-square w-full object-contain [image-rendering:pixelated]"
                      />
                      <p className="mt-2 font-mono text-[9px] tracking-[0.1em] text-[#687069]">
                        CANDIDATE {String(index + 1).padStart(2, '0')}
                      </p>
                    </button>
                  ))}
                </div>
                <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
                  <label className="grid gap-1.5" htmlFor="quick-start-action-description">
                    <span className="text-[11px] font-semibold text-[#515a53]">
                      动作描述（可选，留空生成待机动作）
                    </span>
                    <input
                      id="quick-start-action-description"
                      value={actionDescription}
                      onChange={(event) => setActionDescription(event.target.value)}
                      placeholder="例如：在画板上画画、挥舞灯笼、扫地…"
                      className="rounded-xl border border-[#c7cec8] bg-white px-4 py-2.5 text-sm text-[#1d251f] outline-none placeholder:text-[#7a817b] focus:border-[#8fa092]"
                    />
                  </label>
                  <div className="flex justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => void regenerate()}
                      className="rounded-xl border border-[#aeb8b0] px-5 py-3 text-sm font-semibold text-[#515a53] transition hover:border-[#8fa092]"
                    >
                      重新生成
                    </button>
                    {selectedCandidate ? (
                      <button
                        type="button"
                        onClick={() => void confirmSelection()}
                        disabled={confirmingCandidate}
                        className="rounded-xl bg-[#35583f] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#456c51]"
                      >
                        {confirmingCandidate ? '正在提交…' : '确认选择，继续下一步'}
                      </button>
                    ) : null}
                  </div>
                </div>
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
              {revision.nodes.map((node, index) => (
                <li
                  key={node.id}
                  className={`grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2 ${
                    node.status === 'active'
                      ? 'border-[#91a394] bg-[#e4ebe2]'
                      : 'border-[#d5dad5] bg-[#f0f2ef]'
                  }`}
                >
                  <i
                    className={`grid h-7 w-7 place-items-center rounded-full text-[9px] not-italic ${
                      node.status === 'passed'
                        ? 'bg-[#35583f] text-white'
                        : node.status === 'active'
                          ? 'border border-[#6f8874] text-[#35583f]'
                          : 'border border-[#d0d6d1] text-[#8b918c]'
                    }`}
                  >
                    {node.status === 'passed' ? '✓' : String(index + 1).padStart(2, '0')}
                  </i>
                  <span className="text-xs font-semibold text-[#515a53]">
                    {STEP_LABELS[node.type]}
                  </span>
                  <small className="text-[9px] text-[#7a817b]">{nodeStatusLabel(node)}</small>
                </li>
              ))}
            </ol>
          </aside>
        </div>

        <footer className="rounded-[1.3rem] border border-[#c4cbc5] bg-[#f7f8f4]/95 p-4 shadow-[0_18px_50px_rgba(31,43,35,0.10)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span>
              <small className="font-mono text-[8px] tracking-[0.12em] text-[#747973]">
                {passedCount} / {revision.nodes.length} STEPS PASSED
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
              {canPublish && (publishing || error) ? (
                <button
                  type="button"
                  onClick={() => void publishToPlaytest()}
                  disabled={publishing}
                  className="rounded-lg bg-[#2a5284] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#3668a0] disabled:cursor-wait disabled:opacity-60"
                >
                  {publishing ? '正在自动导入…' : '重新导入 Playtest'}
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

function describeRun(run: WorkflowRun, workflow: WorkflowRun) {
  const failedStep = workflow.nodes.find((node) => node.status === 'failed' && !node.deletedAt)
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

  const actionStep = latestActionStep(workflow)
  if (actionStep?.status === 'active') {
    return {
      title: '正在生成动作',
      description: '角色图已确认，正在生成动作帧…',
      error: null,
    }
  }
  if (actionStep?.status === 'passed') {
    return {
      title: '动作生成完成',
      description: '动作帧已回传，正在自动写入并载入 Playtest 工作台。',
      error: null,
    }
  }
  if (actionStep?.status === 'failed') {
    return {
      title: '动作生成失败',
      description: typeof actionStep.error === 'string' ? actionStep.error : '动作生成失败',
      error: typeof actionStep.error === 'string' ? actionStep.error : '动作生成失败',
    }
  }

  const templateNode = workflow.nodes.find(
    (n): n is CharacterTemplateWorkflowNode => n.type === 'character-template',
  )
  if (templateNode?.output?.imageUrls.length) {
    return {
      title: '角色图已生成',
      description: '候选结果已到达。下一步需要人工选择，不会自动写入正式资产。',
      error: null,
    }
  }
  if (templateNode?.status === 'active') {
    return {
      title: templateNode.taskId ? '正在生成角色图' : '正在创建生成任务',
      description: templateNode.taskId
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

/** 只有完整动作和可审核状态同时具备时，才允许自动发布当前版本。 */
function automaticPublishKey(run: WorkflowRun): string | null {
  const revision = run
  const actionStep = latestActionStep(revision)
  const reviewStep = actionStep ? pairedReviewStep(revision, actionStep.id) : null
  const hasFrames =
    actionStep?.type === 'action-full-frame' &&
    actionStep.status === 'passed' &&
    Boolean(actionStep.output?.frames.length)
  const reviewReady = reviewStep?.status === 'active' || reviewStep?.status === 'passed'

  return hasFrames && reviewReady && revision && actionStep
    ? `${run.id}:${revision.id}:${actionStep.id}`
    : null
}

/** 返回当前 Run 最后追加且未删除的动作；旧动作只保留作历史结果。 */
function latestActionStep(workflow: WorkflowRun) {
  return (
    workflow.nodes.findLast((node) => node.type === 'action-full-frame' && !node.deletedAt) ?? null
  )
}

/** 动作与依赖它的审核组成一对；数组顺序不属于工作流图契约。 */
function pairedReviewStep(workflow: WorkflowRun, actionStepId: string) {
  return (
    workflow.nodes.find(
      (node) =>
        node.type === 'review' && !node.deletedAt && node.dependsOnNodeIds.includes(actionStepId),
    ) ?? null
  )
}

function nodeStatusLabel(node: WorkflowNode) {
  if (node.deletedAt) return '已删除'
  if (node.status === 'passed') return '完成'
  if (node.status === 'active') return '当前'
  if (node.status === 'failed') return '失败'
  return '等待'
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message.trim() : fallback
}
