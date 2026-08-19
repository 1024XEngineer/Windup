import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import { ArrowUp, ImageSquare, X } from '@phosphor-icons/react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'

import {
  type ActionFirstFrameWorkflowNode,
  type CharacterTemplateWorkflowNode,
  type WorkflowRun,
  WorkflowRunConflictError,
} from '@/entities'
import { ExportButton, type ExportPackageModel } from '@/features/export-package'
import { KineticCopyCycle, type KineticCopyMessage } from './kinetic-copy-cycle'
import {
  quickStartService,
  type QuickStartEntryService,
  type QuickStartFrame,
  type QuickStartSession,
} from './service'
import './quick-start-motion.css'

export type {
  CreateQuickStartServiceOptions,
  PrepareQuickStartProject,
  QuickStartEntryService,
  QuickStartSession,
} from './service'

const STYLE_PROMPTS = [
  {
    title: '16-bit 日式 RPG',
    detail: '清晰轮廓 · 明亮配色',
    prompt: '16-bit 日式 RPG 像素风，清晰轮廓，明亮配色',
  },
  {
    title: '暗黑哥特像素',
    detail: '低饱和 · 强烈明暗',
    prompt: '暗黑哥特像素风，低饱和配色，强烈明暗对比',
  },
  {
    title: '温暖手绘像素',
    detail: '柔和色彩 · 纸张质感',
    prompt: '温暖手绘像素风，柔和配色，细腻纸张质感',
  },
] as const

const ROLE_IDEAS = [
  '银色卷发、戴星形单片眼镜的裁缝',
  '长着鹿角、披苔藓斗篷的邮差',
  '戴透明水母帽、穿蓝色雨衣的药剂师',
  '蓬松白胡子、背黄铜工具箱的机械师',
  '紫色短发、戴猫耳耳机的情报员',
  '披白羽斗篷、戴月牙面具的占星师',
  '红色双辫、穿宽大飞行夹克的小飞行员',
  '黑色卷发、戴珊瑚项链的海洋祭司',
] as const

const ROLE_IDEA_MESSAGES: readonly KineticCopyMessage[] = [
  { lines: ['想做一个什么角色？'], className: 'text-app-ink' },
  ...ROLE_IDEAS.map((idea) => ({
    prefix: '试试',
    prefixClassName:
      'mr-3 font-mono text-[10px] font-bold tracking-[0.14em] text-app-faint sm:text-[11px]',
    lines: [idea],
    className: 'text-app-accent',
  })),
]

const ROLE_DEFAULT_MESSAGE: readonly KineticCopyMessage[] = [
  { lines: ['用文字塑造你的角色……'], className: 'text-app-ink' },
]

const TEMPLATE_GENERATION_MESSAGES: readonly KineticCopyMessage[] = [
  { lines: ['勾勒角色轮廓'] },
  { lines: ['给衣服配颜色'] },
  { lines: ['把发型画清楚'] },
  { lines: ['添上表情'] },
  { lines: ['处理一下光影'] },
  { lines: ['补齐画面细节'] },
]

const FIRST_FRAME_GENERATION_MESSAGES: readonly KineticCopyMessage[] = [
  { lines: ['摆好动作姿态'] },
  { lines: ['调整手脚位置'] },
  { lines: ['让重心自然一点'] },
  { lines: ['拉开姿态的区别'] },
  { lines: ['保持角色样子'] },
  { lines: ['补上动作细节'] },
]

const ACTION_GENERATION_MESSAGES: readonly KineticCopyMessage[] = [
  { lines: ['把动作连起来'] },
  { lines: ['补上中间的变化'] },
  { lines: ['理顺每一帧的节奏'] },
  { lines: ['检查手脚的衔接'] },
  { lines: ['让起落自然一点'] },
  { lines: ['调整动作幅度'] },
]

const ENTRY_HANDOFF_MS = 460

function playtestPath(characterId: string, outfitId: string, actionId?: string): string {
  const path = `/playtest/${encodeURIComponent(characterId)}/${encodeURIComponent(outfitId)}`
  return actionId ? `${path}?${new URLSearchParams({ actionId })}` : path
}

export interface QuickStartPageProps {
  /**
   * 页面测试与外层组合可以注入同一份服务实例。
   * 未注入时，Quick Start 自己装配真实实体接口，避免 app 层承担流程细节。
   */
  service?: QuickStartEntryService
}

/** Quick Start 独立完成 AI 入口；它不跳转 Workflow Editor。 */
export function QuickStartPage({ service }: QuickStartPageProps) {
  const { runId } = useParams()
  const [searchParams] = useSearchParams()
  const activeService = useMemo(() => {
    return service ?? quickStartService
  }, [service])
  const [createdSession, setCreatedSession] = useState<QuickStartSession | null>(null)
  const consumeCreatedSession = useCallback((consumed: QuickStartSession) => {
    setCreatedSession((current) => (current === consumed ? null : current))
  }, [])
  const characterId = searchParams.get('characterId')
  const outfitId = searchParams.get('outfitId')
  return runId ? (
    <QuickStartRun
      key={runId}
      service={activeService}
      runId={runId}
      initialSession={createdSession?.runId === runId ? createdSession : null}
      onSessionCreated={setCreatedSession}
      onInitialSessionConsumed={consumeCreatedSession}
    />
  ) : characterId && outfitId ? (
    <QuickStartActionInput
      service={activeService}
      target={{ characterId, outfitId }}
      onSessionCreated={setCreatedSession}
    />
  ) : (
    <QuickStartInput service={activeService} onSessionCreated={setCreatedSession} />
  )
}

function QuickStartActionInput({
  service,
  target,
  onSessionCreated,
}: {
  service: QuickStartEntryService
  target: { characterId: string; outfitId: string }
  onSessionCreated: (session: QuickStartSession) => void
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
      const session = await service.startAction(target, prompt)
      onSessionCreated(session)
      navigate(`/quick-start/${encodeURIComponent(session.runId)}`)
    } catch (cause) {
      setError(errorMessage(cause, '创建动作失败，请稍后重试'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="min-h-[560px] border border-app-line bg-app-canvas p-6 text-app-ink sm:p-10">
      <Link
        to={playtestPath(target.characterId, target.outfitId)}
        className="text-xs font-semibold text-app-muted hover:text-app-accent"
      >
        ← 返回当前预览台
      </Link>
      <div className="mx-auto mt-14 max-w-2xl">
        <p className="font-mono text-[10px] font-bold text-app-muted">ADD ACTION</p>
        <h1 className="mt-3 font-serif text-4xl">给当前角色增加动作</h1>
        <p className="mt-3 text-sm text-app-muted">
          新动作会追加到角色 {target.characterId} 的当前造型，不会新建角色或覆盖已有动作。
        </p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block text-xs font-semibold text-app-ink-soft">
            动作描述
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例如：挥手打招呼、蹲下查看地面、举起画笔作画"
              className="mt-2 min-h-32 w-full resize-y rounded-lg border border-app-line-strong bg-app-surface-raised p-4 text-base outline-none focus:border-app-accent"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-app-danger">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!description.trim() || submitting || Boolean(service.unavailableReason)}
            className="min-h-11 rounded-lg bg-app-accent px-5 text-sm font-semibold text-app-on-accent disabled:opacity-50"
          >
            {submitting ? '正在开始生成…' : '开始生成新动作'}
          </button>
        </form>
      </div>
    </section>
  )
}

function QuickStartInput({
  service,
  onSessionCreated,
}: {
  service: QuickStartEntryService
  onSessionCreated: (session: QuickStartSession) => void
}) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [entryTransition, setEntryTransition] = useState<'idle' | 'leaving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const submitAbortController = useRef<AbortController | null>(null)
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unavailableReason = service.unavailableReason
  const hasPrompt = Boolean(prompt.trim())
  const showStylePrompts = !hasPrompt && !templateFile

  useEffect(
    () => () => {
      submitAbortController.current?.abort()
      if (handoffTimer.current) clearTimeout(handoffTimer.current)
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
    setEntryTransition('leaving')
    setError(null)
    try {
      const sessionPromise = templateFile
        ? service.startWithUploadedTemplate(templateFile, normalizedPrompt, abortController.signal)
        : service.start(normalizedPrompt)
      const handoffPromise = new Promise<void>((resolve) => {
        handoffTimer.current = setTimeout(() => {
          handoffTimer.current = null
          resolve()
        }, ENTRY_HANDOFF_MS)
      })
      const [session] = await Promise.all([sessionPromise, handoffPromise])
      onSessionCreated(session)
      navigate(`/quick-start/${encodeURIComponent(session.runId)}`)
    } catch (cause) {
      if (!abortController.signal.aborted) {
        if (handoffTimer.current) clearTimeout(handoffTimer.current)
        handoffTimer.current = null
        setEntryTransition('idle')
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
    <section className="relative min-h-[100dvh] overflow-hidden border border-app-line bg-app-canvas pt-14 text-app-ink shadow-app-page">
      <AmbientGrid />

      <div
        data-layout="quick-start-entry"
        data-transition={entryTransition}
        className="relative z-10 grid min-h-[calc(100dvh-3.5rem)] grid-rows-[1fr_auto] gap-6 px-5 py-6 sm:px-8 sm:pb-8 sm:pt-10"
      >
        <div
          data-layout="quick-start-entry-stage"
          className={`mx-auto grid w-full max-w-3xl content-center gap-5 pb-8 transition-[opacity,transform,filter] duration-[460ms] ease-[cubic-bezier(0.55,0,1,0.45)] motion-reduce:transition-none sm:gap-6 ${
            entryTransition === 'leaving'
              ? 'pointer-events-none -translate-y-3 scale-[0.985] opacity-0 blur-[7px]'
              : 'translate-y-0 scale-100 opacity-100 blur-0'
          }`}
        >
          <KineticCopyCycle
            active={!templateFile && !submitting}
            as="h1"
            ariaLabel="想做一个什么角色？"
            motionMode="characters"
            firstCycleMs={2_400}
            loopStartIndex={1}
            messages={hasPrompt ? ROLE_DEFAULT_MESSAGE : ROLE_IDEA_MESSAGES}
            className="min-h-12 text-center font-serif text-[clamp(1.75rem,4vw,2.65rem)] leading-none font-medium tracking-[-0.045em]"
          />

          <div
            data-layout="quick-start-starters"
            data-presence={showStylePrompts ? 'visible' : 'hidden'}
            aria-hidden={!showStylePrompts}
            className={`grid gap-2 transition-[opacity,transform,filter] duration-[460ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none sm:grid-cols-3 ${
              showStylePrompts
                ? 'translate-y-0 scale-100 opacity-100 blur-0'
                : 'pointer-events-none -translate-y-2 scale-[0.985] opacity-0 blur-[6px]'
            }`}
          >
            {STYLE_PROMPTS.map((stylePrompt) => (
              <button
                key={stylePrompt.title}
                type="button"
                disabled={!showStylePrompts}
                aria-label={`${stylePrompt.title}：${stylePrompt.detail}`}
                onClick={() => setPrompt(stylePrompt.prompt)}
                className="group grid min-h-16 content-center gap-1 rounded-xl border border-app-line bg-app-surface/70 px-4 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-app-line-strong hover:bg-app-surface-raised hover:shadow-app-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent motion-reduce:transform-none"
              >
                <strong className="text-sm font-semibold text-app-ink">{stylePrompt.title}</strong>
                <span className="text-[11px] text-app-muted">{stylePrompt.detail}</span>
              </button>
            ))}
          </div>
        </div>

        <div data-layout="quick-start-composer" className="mx-auto w-full max-w-3xl self-end">
          <form
            onSubmit={(event) => void submit(event)}
            className="grid items-center gap-1.5 rounded-xl border border-app-line-strong bg-app-surface-raised p-1.5 shadow-app-panel transition-shadow focus-within:border-app-accent focus-within:shadow-[var(--shadow-app-composer-focus)] sm:grid-cols-[1fr_auto_auto]"
          >
            <label className="min-w-0" htmlFor="quick-start-prompt">
              <span className="sr-only">创作指令</span>
              <input
                id="quick-start-prompt"
                type="text"
                aria-label="创作指令"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  templateFile ? '描述动作，可留空生成待机动作…' : '描述角色的外形、身份和气质…'
                }
                className="h-10 w-full min-w-0 border-0 bg-transparent px-3 text-[15px] text-app-ink outline-none placeholder:text-app-faint"
              />
            </label>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              aria-label="上传角色母版"
              className="sr-only"
              onChange={selectTemplateFile}
            />
            {templateFile ? (
              <span className="flex h-10 min-w-0 max-w-56 items-center rounded-lg bg-app-surface-muted text-xs text-app-ink-soft">
                <button
                  type="button"
                  aria-label={`更换母版 ${templateFile.name}`}
                  onClick={() => fileInput.current?.click()}
                  className="inline-flex h-full min-w-0 items-center gap-2 rounded-l-lg px-2.5 font-semibold transition hover:bg-app-surface hover:text-app-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
                >
                  <ImageSquare aria-hidden="true" size={16} weight="duotone" />
                  <span className="max-w-32 truncate">{templateFile.name}</span>
                </button>
                <button
                  type="button"
                  aria-label="移除图片"
                  onClick={removeTemplateFile}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-app-muted transition hover:bg-app-surface hover:text-app-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
                >
                  <X aria-hidden="true" size={14} weight="bold" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-semibold whitespace-nowrap text-app-muted transition hover:bg-app-surface-muted hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
              >
                <ImageSquare aria-hidden="true" size={17} weight="duotone" />
                添加母版
              </button>
            )}
            <button
              type="submit"
              disabled={
                (!prompt.trim() && !templateFile) || submitting || Boolean(unavailableReason)
              }
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-app-accent px-4 text-sm font-bold whitespace-nowrap text-app-on-accent transition hover:bg-app-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? '正在创建…' : '生成角色'}
              {!submitting ? <ArrowUp aria-hidden="true" size={16} weight="bold" /> : null}
            </button>
          </form>

          {unavailableReason ? (
            <p className="mt-3 rounded-xl border border-app-warning-line bg-app-warning-soft px-4 py-3 text-sm text-app-warning">
              {unavailableReason}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-app-danger px-4 py-3 text-sm text-app-danger-soft"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function AgentCopy({
  lines,
  tone = 'default',
}: {
  lines: readonly string[]
  tone?: 'default' | 'danger'
}) {
  return (
    <div
      data-agent-copy
      aria-label={lines.join(' ')}
      className={`quick-start-agent-copy font-sans ${
        tone === 'danger' ? 'text-app-danger' : 'text-app-ink-soft'
      }`}
    >
      <p className="text-sm leading-6 font-medium">{lines[0]}</p>
      {lines.slice(1).map((line) => (
        <p key={line} className="mt-0.5 max-w-2xl text-[13px] leading-5 text-app-muted">
          {line}
        </p>
      ))}
    </div>
  )
}

function GenerationProgress({
  label,
  messages,
}: {
  label: string
  messages: readonly KineticCopyMessage[]
}) {
  return (
    <div data-generation-progress className="min-h-8 overflow-hidden">
      <KineticCopyCycle
        active
        ariaLabel={label}
        messages={messages}
        motionMode="characters"
        firstCycleMs={7_540}
        cycleMs={8_000}
        loopStartIndex={0}
        className="quick-start-agent-copy quick-start-generation-shimmer justify-items-start text-left font-serif text-[17px] leading-7 font-medium tracking-[-0.025em] text-app-ink"
      />
    </div>
  )
}

function UserTurn({ children }: { children: ReactNode }) {
  return (
    <div
      data-user-turn
      className="ml-auto max-w-[78%] rounded-[1.15rem] rounded-br-md bg-app-surface-muted px-4 py-2.5 text-left text-sm leading-6 text-app-ink-soft"
    >
      <span>{children}</span>
    </div>
  )
}

function AgentTurn({
  step,
  current,
  children,
}: {
  step: 'character-template' | 'action-first-frame' | 'action-full-frame'
  current: boolean
  children: ReactNode
}) {
  return (
    <section
      data-agent-turn={step}
      data-current-turn={String(current)}
      className={`quick-start-agent-turn min-w-0 transition-opacity duration-200 ${
        current ? 'opacity-100' : 'opacity-55'
      }`}
    >
      <div className="grid min-w-0 gap-4">{children}</div>
    </section>
  )
}

function AssetVisual({
  src,
  alt,
  className,
  priority = false,
}: {
  src: string
  alt: string
  className: string
  priority?: boolean
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      className={className}
    />
  )
}

const GENERATION_DOTS = Array.from({ length: 432 }, (_, index) => {
  const column = index % 24
  const row = Math.floor(index / 24)
  const noise = ((column * 37 + row * 61 + index * 17) % 101) / 100
  const wave = (Math.sin(column * 0.72 + row * 0.41) + 1) / 2
  const level = 0.3 + (noise * 0.55 + wave * 0.45) * 0.7
  const delay = Math.round(((column / 23) * 0.48 + (row / 17) * 0.3 + noise * 0.22) * 900)
  return { delay, level: level.toFixed(2) }
})

function GenerationCanvas({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      data-generation-state="generating"
      data-generation-motion="continuous"
      data-reveal="generation-canvas"
      className="quick-start-generation-canvas"
    >
      <div className="quick-start-generation-dots" aria-hidden="true">
        {GENERATION_DOTS.map(({ delay, level }, index) => (
          <i
            key={index}
            data-generation-dot
            className="quick-start-generation-dot"
            style={
              {
                '--generation-delay': `${delay}ms`,
                '--generation-level': level,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  )
}

function QuickStartRun({
  service,
  runId,
  initialSession,
  onSessionCreated,
  onInitialSessionConsumed,
}: {
  service: QuickStartEntryService
  runId: string
  initialSession: QuickStartSession | null
  onSessionCreated: (session: QuickStartSession) => void
  onInitialSessionConsumed: (session: QuickStartSession) => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [session, setSession] = useState<QuickStartSession | null>(null)
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workflowConflict, setWorkflowConflict] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [selectedFirstFrame, setSelectedFirstFrame] = useState<string | null>(null)
  const [actionDescription, setActionDescription] = useState('')
  const [candidates, setCandidates] = useState<readonly string[]>([])
  const [firstFrameCandidates, setFirstFrameCandidates] = useState<readonly QuickStartFrame[]>([])
  const [actionFrames, setActionFrames] = useState<readonly QuickStartFrame[]>([])
  const [exportModel, setExportModel] = useState<ExportPackageModel | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [confirmingCandidate, setConfirmingCandidate] = useState(false)
  const [confirmingFirstFrame, setConfirmingFirstFrame] = useState(false)
  const automaticPublishAttempt = useRef<string | null>(null)
  const transcriptScrollRegion = useRef<HTMLElement>(null)
  const workflowConflictRef = useRef(false)
  const initialSessionRef = useRef(initialSession)
  const activeSessionRef = useRef<QuickStartSession | null>(null)
  const pendingDisposeRef = useRef<{
    session: QuickStartSession
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const mountedRef = useRef(true)
  const reportWorkflowError = useCallback((cause: unknown, fallback: string) => {
    const presented = presentWorkflowError(cause, fallback)
    if (workflowConflictRef.current && !presented.conflict) return
    workflowConflictRef.current ||= presented.conflict
    setError(presented.message)
    setWorkflowConflict(workflowConflictRef.current)
  }, [])
  const clearWorkflowError = useCallback(() => {
    if (workflowConflictRef.current) return
    setError(null)
    setWorkflowConflict(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      activeSessionRef.current = null
    }
  }, [])

  useEffect(() => {
    let active = true
    let currentSession: QuickStartSession | null = null
    let unsubscribe: () => void = () => undefined
    let unsubscribeErrors: () => void = () => undefined
    setRestoring(true)
    setSession(null)
    setRun(null)
    workflowConflictRef.current = false
    setError(null)
    setWorkflowConflict(false)

    void (async () => {
      const providedSession = initialSessionRef.current
      const nextSession = providedSession ?? (await service.open(runId))
      if (!active) {
        nextSession.dispose()
        return
      }
      if (pendingDisposeRef.current?.session === nextSession) {
        clearTimeout(pendingDisposeRef.current.timer)
        pendingDisposeRef.current = null
      }
      currentSession = nextSession
      activeSessionRef.current = nextSession
      if (providedSession) onInitialSessionConsumed(providedSession)
      setSession(nextSession)
      setRun(nextSession.getWorkflow())
      unsubscribeErrors = nextSession.subscribeErrors((nextError) => {
        if (active) reportWorkflowError(nextError, '自动生成流程失败')
      })
      unsubscribe = nextSession.subscribe((updated) => {
        if (active) {
          setRun(updated)
          clearWorkflowError()
        }
      })
      const resumed = await nextSession.resume()
      if (active) {
        setRun(resumed)
        clearWorkflowError()
        setRestoring(false)
      }
    })().catch((cause) => {
      if (active) {
        reportWorkflowError(cause, '恢复生成任务失败')
        setRestoring(false)
      }
    })

    return () => {
      active = false
      unsubscribe()
      unsubscribeErrors()
      if (activeSessionRef.current === currentSession) activeSessionRef.current = null
      if (currentSession) {
        const sessionToDispose = currentSession
        const timer = setTimeout(() => {
          if (pendingDisposeRef.current?.session !== sessionToDispose) return
          pendingDisposeRef.current = null
          sessionToDispose.dispose()
        }, 0)
        pendingDisposeRef.current = { session: sessionToDispose, timer }
      }
    }
  }, [clearWorkflowError, onInitialSessionConsumed, reportWorkflowError, runId, service])

  useEffect(() => {
    if (!run || !session) {
      setCandidates([])
      setFirstFrameCandidates([])
      setActionFrames([])
      setExportModel(null)
      return
    }
    let active = true
    void Promise.all([
      session.getTemplateCandidates(),
      session.getFirstFrameCandidates(),
      session.getActionFrames(),
      session.getExportModel(),
    ])
      .then(([nextCandidates, nextFirstFrameCandidates, nextFrames, nextExportModel]) => {
        if (!active) return
        const templateIsSelecting = run.nodes.some(
          (node) =>
            node.type === 'character-template' &&
            node.status === 'active' &&
            node.phase === 'selecting',
        )
        const firstFrameIsSelecting = run.nodes.some(
          (node) =>
            node.type === 'action-first-frame' &&
            node.status === 'active' &&
            node.phase === 'selecting',
        )
        if (templateIsSelecting && nextCandidates.length > 0) setCandidates(nextCandidates)
        if (firstFrameIsSelecting && nextFirstFrameCandidates.length > 0) {
          setFirstFrameCandidates(nextFirstFrameCandidates)
        }
        if (nextFrames.length > 0) setActionFrames(nextFrames)
        setExportModel(nextExportModel)
      })
      .catch((cause) => {
        if (active) reportWorkflowError(cause, '读取生成结果失败')
      })
    return () => {
      active = false
    }
  }, [reportWorkflowError, run, session])

  const saveCompletedAction = useCallback(async () => {
    const targetSession = session
    if (
      workflowConflictRef.current ||
      publishing ||
      !targetSession ||
      activeSessionRef.current !== targetSession
    )
      return
    setPublishing(true)
    clearWorkflowError()
    try {
      const approved = await targetSession.approveReview()
      if (!mountedRef.current || activeSessionRef.current !== targetSession) return
      setRun(approved)
    } catch (cause) {
      if (!mountedRef.current || activeSessionRef.current !== targetSession) return
      reportWorkflowError(cause, '保存角色失败，请稍后重试')
    } finally {
      if (mountedRef.current && activeSessionRef.current === targetSession) setPublishing(false)
    }
  }, [clearWorkflowError, publishing, reportWorkflowError, session])

  useEffect(() => {
    const publishKey = run ? automaticPublishKey(run) : null
    if (publishKey === null || publishing || automaticPublishAttempt.current === publishKey) return

    automaticPublishAttempt.current = publishKey
    void saveCompletedAction()
  }, [publishing, run, saveCompletedAction])

  useEffect(() => {
    const region = transcriptScrollRegion.current
    region?.scrollTo?.({ top: region.scrollHeight, behavior: 'smooth' })
  }, [actionFrames, candidates, firstFrameCandidates, run])

  if (!run) {
    return (
      <section className="min-h-[520px] rounded-[2rem] border border-app-line bg-app-canvas p-8 text-app-ink">
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-app-muted">
          QUICK START / RECOVERY
        </p>
        <h1 className="mt-4 font-serif text-4xl">
          {restoring ? '正在恢复这次创作' : '无法恢复这次创作'}
        </h1>
        {restoring ? (
          <p className="mt-4 max-w-xl text-sm leading-7 text-app-muted">正在读取工作流状态…</p>
        ) : (
          <>
            <p role="alert" className="mt-4 max-w-xl text-sm leading-7 text-app-muted">
              {error || `没有找到运行记录 ${runId}`}
            </p>
            <button
              type="button"
              onClick={() => navigate('/quick-start')}
              className="mt-8 rounded-xl bg-app-accent px-5 py-3 text-sm font-semibold text-app-on-accent"
            >
              返回快速开始
            </button>
          </>
        )}
      </section>
    )
  }

  const revision = run
  const status = describeRun(run, revision)
  const actionStep = latestActionStep(revision)
  const firstFrameStep = latestActionFirstFrame(revision)
  const templateStep = revision.nodes.find(
    (node): node is CharacterTemplateWorkflowNode => node.type === 'character-template',
  )
  const reviewStep = actionStep ? pairedReviewStep(revision, actionStep.id) : null
  const canPublish =
    actionFrames.length > 0 && (reviewStep?.status === 'active' || reviewStep?.status === 'passed')
  const workflowIsActive =
    revision.nodes.some((node) => !node.deletedAt && node.status === 'active') &&
    !workflowHasFailure(revision)
  const isActionFailed = actionStep?.status === 'failed'
  const isTemplateSelecting =
    templateStep?.status === 'active' && templateStep.phase === 'selecting'
  const isFirstFrameSelecting =
    firstFrameStep?.status === 'active' && firstFrameStep.phase === 'selecting'
  const isFirstFrameFailed = firstFrameStep?.status === 'failed'

  async function interrupt() {
    try {
      if (workflowConflictRef.current || !session) return
      setRun(await session.interrupt())
    } catch (cause) {
      reportWorkflowError(cause, '中断自动制作失败')
    }
  }

  async function openPlaytest() {
    const targetSession = session
    if (workflowConflictRef.current || !targetSession || activeSessionRef.current !== targetSession)
      return
    clearWorkflowError()
    try {
      let info = targetSession.getCharacterInfo()
      if (!info) {
        info = await targetSession.resolveCharacterInfo()
        if (!mountedRef.current || activeSessionRef.current !== targetSession) return
      }
      if (!info) throw new Error('没有找到对应的角色资产')
      navigate(playtestPath(info.characterId, info.outfitId, actionStep?.id))
    } catch (cause) {
      if (!mountedRef.current || activeSessionRef.current !== targetSession) return
      reportWorkflowError(cause, '打开 Play Test 失败')
    }
  }

  async function confirmSelection() {
    if (workflowConflictRef.current || !selectedCandidate || confirmingCandidate) return
    setConfirmingCandidate(true)
    clearWorkflowError()
    try {
      if (!session) return
      const updated = await session.confirmCandidate(selectedCandidate, actionDescription)
      setRun(updated)
      setSelectedCandidate(null)
      setActionDescription('')
    } catch (cause) {
      reportWorkflowError(cause, '确认选择失败')
    } finally {
      setConfirmingCandidate(false)
    }
  }

  async function confirmFirstFrame() {
    if (workflowConflictRef.current || !selectedFirstFrame || confirmingFirstFrame) return
    setConfirmingFirstFrame(true)
    clearWorkflowError()
    try {
      if (!session) return
      const updated = await session.confirmFirstFrame(selectedFirstFrame)
      setRun(updated)
      setSelectedFirstFrame(null)
    } catch (cause) {
      reportWorkflowError(cause, '确认动作首帧失败')
    } finally {
      setConfirmingFirstFrame(false)
    }
  }

  async function regenerate() {
    const targetSession = session
    if (
      workflowConflictRef.current ||
      !run ||
      !targetSession ||
      activeSessionRef.current !== targetSession
    )
      return
    const prompt = workflowPrompt(run)
    if (!prompt) return
    try {
      const newSession = await service.start(prompt)
      if (!mountedRef.current || activeSessionRef.current !== targetSession) {
        newSession.dispose()
        return
      }
      onSessionCreated(newSession)
      navigate(`/quick-start/${encodeURIComponent(newSession.runId)}`)
    } catch (cause) {
      if (!mountedRef.current || activeSessionRef.current !== targetSession) return
      reportWorkflowError(cause, '重新生成失败')
    }
  }

  function continueConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (workflowConflictRef.current) return
    if (isTemplateSelecting) {
      void confirmSelection()
      return
    }
    if (isFirstFrameSelecting) {
      void confirmFirstFrame()
      return
    }
  }

  const composerPlaceholder = isTemplateSelecting
    ? selectedCandidate
      ? '描述这个角色接下来要做的动作…'
      : '先从上面选择一个角色…'
    : isFirstFrameSelecting
      ? selectedFirstFrame
        ? '按发送确认这张首帧…'
        : '先从上面选择一个动作首帧…'
      : workflowHasFailure(run)
        ? '这次未完成，可以新建一次创作…'
        : canPublish
          ? '确认保存后，还可以继续描述修改…'
          : '制作中，完成后可以继续修改…'

  const composerCanSubmit =
    (isTemplateSelecting && Boolean(selectedCandidate)) ||
    (isFirstFrameSelecting && Boolean(selectedFirstFrame))
  const selectedTemplateUrl = templateStep?.selectedImageUrl
  const selectedFirstFrameUrl = firstFrameStep?.selectedFirstFrameUrl
  const requestedAction = firstFrameStep?.input.prompt || firstFrameStep?.input.name
  const chosenTemplateUrl = selectedTemplateUrl ?? selectedCandidate
  const chosenFirstFrameUrl = selectedFirstFrameUrl ?? selectedFirstFrame
  const characterTurnIsCurrent = !firstFrameStep
  const firstFrameTurnIsCurrent = Boolean(firstFrameStep) && actionStep?.status === 'locked'
  const actionTurnIsCurrent = Boolean(actionStep && actionStep.status !== 'locked')

  return (
    <section className="relative min-h-screen overflow-hidden bg-app-canvas pt-14 text-app-ink">
      <div
        data-testid="quick-start-run"
        data-layout="agent-shell"
        className="relative h-[calc(100dvh-3.5rem)] overflow-hidden"
      >
        <span aria-live="polite" className="sr-only">
          {status.title}
        </span>

        <main
          ref={transcriptScrollRegion}
          data-layout="quick-start-scroll-region"
          className="absolute inset-0 overflow-y-auto px-5 pt-14 pb-32 sm:px-8 sm:pt-10 sm:pb-36"
        >
          <div
            data-testid="quick-start-transcript"
            className="mx-auto grid min-h-full w-full max-w-3xl content-end gap-7 pb-8 sm:gap-9"
          >
            <UserTurn>{workflowPrompt(run) || '未命名角色创作'}</UserTurn>

            <AgentTurn step="character-template" current={characterTurnIsCurrent}>
              {candidates.length ? (
                <>
                  <AgentCopy
                    lines={[
                      '已生成 3 个角色方向。',
                      isTemplateSelecting
                        ? '选择一个方案，再描述它接下来的动作。'
                        : '角色方案已确认。',
                    ]}
                  />
                  <div
                    data-layout="agent-result-set"
                    className="grid w-full max-w-2xl grid-cols-3 gap-3"
                  >
                    {candidates.map((candidateUrl, index) => (
                      <button
                        key={`${candidateUrl}:${index}`}
                        type="button"
                        aria-label={`选择角色方案 ${index + 1}`}
                        aria-pressed={chosenTemplateUrl === candidateUrl}
                        disabled={!isTemplateSelecting || confirmingCandidate || workflowConflict}
                        onClick={() => setSelectedCandidate(candidateUrl)}
                        data-asset-choice="true"
                        data-reveal="card"
                        style={{ '--reveal-index': index } as CSSProperties}
                        className={`quick-start-reveal-card group/asset relative aspect-square overflow-hidden rounded-2xl border bg-app-surface-raised text-left transition duration-200 ${
                          chosenTemplateUrl === candidateUrl
                            ? 'border-app-accent ring-1 ring-app-accent'
                            : 'border-app-line hover:border-app-line-strong'
                        } disabled:cursor-default disabled:hover:border-app-line`}
                      >
                        <span
                          data-asset-frame
                          className="block h-full min-h-0 bg-app-surface-muted"
                        >
                          <AssetVisual
                            src={candidateUrl}
                            alt={`角色图候选 ${index + 1}`}
                            priority={index === 0}
                            className="quick-start-generated-image aspect-square h-full w-full object-contain [image-rendering:pixelated]"
                          />
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void regenerate()}
                    disabled={workflowConflict}
                    className="w-fit rounded-xl border border-app-line-strong px-4 py-2 text-xs font-semibold text-app-ink-soft transition hover:border-app-accent hover:text-app-accent"
                  >
                    重新生成
                  </button>
                </>
              ) : templateStep?.status === 'passed' && selectedTemplateUrl ? (
                <>
                  <AgentCopy lines={['角色方案已确认。']} />
                  <div
                    data-layout="agent-result-set"
                    className="grid w-full max-w-2xl grid-cols-3 gap-3"
                  >
                    <AssetVisual
                      src={selectedTemplateUrl}
                      alt="已选择的角色"
                      className="aspect-square w-full rounded-2xl border border-app-line bg-app-surface-muted object-contain [image-rendering:pixelated]"
                    />
                  </div>
                </>
              ) : workflowHasFailure(revision) ? (
                <>
                  <AgentCopy
                    tone="danger"
                    lines={[
                      '这次没有生成完成',
                      '你的描述还在。换一种说法，或者补充新的要求后再试一次。',
                    ]}
                  />
                </>
              ) : (
                <>
                  <GenerationProgress
                    label="角色生成进度"
                    messages={TEMPLATE_GENERATION_MESSAGES}
                  />
                  <div
                    data-layout="agent-result-set"
                    className="grid w-full max-w-2xl grid-cols-3 gap-3"
                  >
                    <GenerationCanvas label="角色图生成画布" />
                  </div>
                </>
              )}
            </AgentTurn>

            {firstFrameStep ? (
              <>
                <UserTurn>{requestedAction || '待机'}</UserTurn>
                <AgentTurn step="action-first-frame" current={firstFrameTurnIsCurrent}>
                  {firstFrameCandidates.length ? (
                    <>
                      <AgentCopy
                        lines={[
                          isFirstFrameSelecting ? '已生成 3 个动作起始姿态。' : '动作首帧',
                          isFirstFrameSelecting
                            ? '选择一个起始姿态，随后生成完整动作。'
                            : '动作起始姿态已确认。',
                        ]}
                      />
                      <div
                        data-layout="agent-result-set"
                        className="grid w-full max-w-2xl grid-cols-3 gap-3"
                      >
                        {firstFrameCandidates.map((frame, index) => (
                          <button
                            key={`${frame.imageUrl}:${index}`}
                            type="button"
                            aria-label={`选择动作首帧 ${index + 1}`}
                            aria-pressed={chosenFirstFrameUrl === frame.imageUrl}
                            disabled={
                              !isFirstFrameSelecting || confirmingFirstFrame || workflowConflict
                            }
                            onClick={() => setSelectedFirstFrame(frame.imageUrl)}
                            data-asset-choice="true"
                            data-result-priority={index === 0 ? 'primary' : 'alternative'}
                            data-reveal="card"
                            style={{ '--reveal-index': index } as CSSProperties}
                            className={`quick-start-reveal-card relative overflow-hidden rounded-2xl border bg-app-surface-raised text-left transition ${
                              chosenFirstFrameUrl === frame.imageUrl
                                ? 'border-app-accent ring-1 ring-app-accent'
                                : 'border-app-line hover:border-app-line-strong'
                            } disabled:cursor-default disabled:hover:border-app-line`}
                          >
                            <span
                              data-asset-frame
                              className="block aspect-square bg-app-surface-muted"
                            >
                              <AssetVisual
                                src={frame.imageUrl}
                                alt={`动作首帧候选 ${index + 1}`}
                                priority={index === 0}
                                className="quick-start-generated-image h-full w-full object-contain [image-rendering:pixelated]"
                              />
                            </span>
                          </button>
                        ))}
                      </div>
                      {selectedFirstFrame ? (
                        <button
                          type="button"
                          onClick={() => void confirmFirstFrame()}
                          disabled={confirmingFirstFrame || workflowConflict}
                          className="w-fit rounded-xl bg-app-accent px-5 py-2.5 text-sm font-bold text-app-on-accent disabled:opacity-50"
                        >
                          {confirmingFirstFrame ? '正在确认…' : '确认首帧，生成完整动作'}
                        </button>
                      ) : null}
                    </>
                  ) : firstFrameStep.status === 'passed' && selectedFirstFrameUrl ? (
                    <>
                      <AgentCopy lines={['动作起始姿态已确认。']} />
                      <div
                        data-layout="agent-result-set"
                        className="grid w-full max-w-2xl grid-cols-3 gap-3"
                      >
                        <AssetVisual
                          src={selectedFirstFrameUrl}
                          alt="已选择的动作首帧"
                          className="aspect-square w-full rounded-2xl border border-app-line bg-app-surface-muted object-contain [image-rendering:pixelated]"
                        />
                      </div>
                    </>
                  ) : isFirstFrameFailed ? (
                    <>
                      <AgentCopy
                        tone="danger"
                        lines={['动作首帧生成失败', '内容还在，可以在下面修改要求后重试。']}
                      />
                    </>
                  ) : (
                    <>
                      <GenerationProgress
                        label="动作首帧生成进度"
                        messages={FIRST_FRAME_GENERATION_MESSAGES}
                      />
                      <div
                        data-layout="agent-result-set"
                        className="grid w-full max-w-2xl grid-cols-3 gap-3"
                      >
                        <GenerationCanvas label="动作首帧生成画布" />
                      </div>
                    </>
                  )}
                </AgentTurn>
              </>
            ) : null}

            {actionStep && actionStep.status !== 'locked' ? (
              <>
                <AgentTurn step="action-full-frame" current={actionTurnIsCurrent}>
                  {actionFrames.length > 0 ? (
                    <>
                      <AgentCopy lines={[`动作已完成，共 ${actionFrames.length} 帧。`]} />
                      <div
                        data-layout="agent-result-set"
                        className="grid w-full max-w-2xl grid-cols-3 gap-3"
                      >
                        <AssetVisual
                          src={actionFrames[0]!.imageUrl}
                          alt="完整动作预览"
                          priority
                          className="quick-start-generated-image aspect-square w-full rounded-2xl border border-app-line bg-app-surface-muted object-contain [image-rendering:pixelated]"
                        />
                      </div>
                      {reviewStep?.status === 'passed' ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/projects/${encodeURIComponent(revision.projectId)}/assets`)
                            }
                            className="rounded-lg border border-app-line-strong px-3 py-1.5 text-xs font-semibold text-app-ink-soft transition hover:border-app-accent hover:text-app-accent"
                          >
                            跳转到资产工作台
                          </button>
                          <button
                            type="button"
                            onClick={() => void openPlaytest()}
                            disabled={workflowConflict}
                            className="rounded-lg border border-app-line-strong px-3 py-1.5 text-xs font-semibold text-app-ink-soft transition hover:border-app-accent hover:text-app-accent"
                          >
                            跳转到 Play Test
                          </button>
                        </div>
                      ) : null}
                      <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1">
                        {actionFrames.map((frame, index) => (
                          <AssetVisual
                            key={`${frame.imageUrl}:${index}`}
                            src={frame.imageUrl}
                            alt={`动作第 ${index + 1} 帧`}
                            className="quick-start-generated-frame size-12 shrink-0 rounded-lg border border-app-line bg-app-surface-muted object-contain [image-rendering:pixelated]"
                          />
                        ))}
                      </div>
                      {reviewStep?.status === 'active' && canPublish && error ? (
                        <button
                          type="button"
                          onClick={() => void saveCompletedAction()}
                          disabled={publishing || workflowConflict}
                          className="w-fit rounded-xl bg-app-accent px-5 py-2.5 text-sm font-bold text-app-on-accent disabled:opacity-50"
                        >
                          {publishing ? '正在保存…' : '重新保存'}
                        </button>
                      ) : reviewStep?.status === 'passed' ? (
                        <p className="text-sm font-medium text-app-accent">角色已经保存到资产库</p>
                      ) : canPublish ? (
                        <p className="text-sm text-app-muted">正在保存角色…</p>
                      ) : null}
                    </>
                  ) : isActionFailed ? (
                    <>
                      <AgentCopy
                        tone="danger"
                        lines={['动作生成失败', '内容还在，可以在下面修改要求后重试。']}
                      />
                    </>
                  ) : (
                    <>
                      <GenerationProgress
                        label="完整动作生成进度"
                        messages={ACTION_GENERATION_MESSAGES}
                      />
                      <div
                        data-layout="agent-result-set"
                        className="grid w-full max-w-2xl grid-cols-3 gap-3"
                      >
                        <GenerationCanvas label="完整动作生成画布" />
                      </div>
                    </>
                  )}
                </AgentTurn>
              </>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="ml-10 flex flex-wrap items-center gap-3 rounded-xl bg-app-danger/8 px-4 py-3 text-sm text-app-danger"
              >
                <span>{error}</span>
                {workflowConflict ? (
                  <Link
                    reloadDocument
                    to={`${location.pathname}${location.search}${location.hash}`}
                    className="rounded-lg border border-current px-3 py-1.5 text-xs font-bold text-inherit"
                  >
                    加载最新版本
                  </Link>
                ) : null}
              </div>
            ) : null}
            <div data-testid="quick-start-transcript-end" />
          </div>
        </main>

        <footer
          data-testid="quick-start-composer"
          data-position="floating"
          className="absolute right-5 bottom-4 left-5 z-10 mx-auto w-auto max-w-3xl sm:right-8 sm:bottom-6 sm:left-8"
        >
          <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
            {exportModel ? (
              <ExportButton
                model={exportModel}
                className="border-app-accent bg-app-accent text-app-on-accent hover:bg-app-accent-hover"
              />
            ) : null}
            {workflowIsActive ? (
              <button
                type="button"
                onClick={() => void interrupt()}
                disabled={workflowConflict}
                className="rounded-lg border border-app-line-strong bg-app-surface-raised/96 px-3 py-2 text-xs font-semibold text-app-ink-soft backdrop-blur-xl transition hover:border-app-accent hover:text-app-accent"
              >
                中断自动制作
              </button>
            ) : null}
            {candidates.length || workflowHasFailure(revision) ? (
              <button
                type="button"
                onClick={() => navigate('/quick-start')}
                className="rounded-lg border border-app-line-strong bg-app-surface-raised/96 px-3 py-2 text-xs font-semibold text-app-ink-soft backdrop-blur-xl transition hover:border-app-accent hover:text-app-accent"
              >
                新建一次创作
              </button>
            ) : null}
          </div>
          <form
            onSubmit={continueConversation}
            className="grid grid-cols-[1fr_auto] items-center gap-1.5 rounded-2xl border border-app-line-strong bg-app-surface-raised/96 p-1.5 shadow-app-panel backdrop-blur-xl transition focus-within:border-app-accent"
          >
            <label htmlFor="quick-start-continuation" className="min-w-0">
              <span className="sr-only">继续描述你的想法</span>
              <input
                id="quick-start-continuation"
                aria-label="继续描述你的想法"
                value={actionDescription}
                onChange={(event) => setActionDescription(event.target.value)}
                placeholder={composerPlaceholder}
                className="h-10 w-full min-w-0 border-0 bg-transparent px-3 text-[15px] text-app-ink outline-none placeholder:text-app-faint"
              />
            </label>
            <button
              type="submit"
              aria-label={isTemplateSelecting ? '确认选择，继续下一步' : '发送'}
              disabled={!composerCanSubmit || workflowConflict}
              className="grid h-10 w-10 place-items-center rounded-lg bg-app-accent text-app-on-accent transition hover:bg-app-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ArrowUp aria-hidden="true" size={16} weight="bold" />
            </button>
          </form>
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
          'linear-gradient(color-mix(in srgb, var(--color-app-accent) 4.5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-app-accent) 4.5%, transparent) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        maskImage: 'linear-gradient(to bottom, black, transparent 84%)',
      }}
    />
  )
}

function describeRun(_run: WorkflowRun, workflow: WorkflowRun) {
  const failedStep = workflow.nodes.find((node) => node.status === 'failed' && !node.deletedAt)
  if (failedStep) {
    return {
      title: '生成失败',
      description: '你的描述仍然保留在这里，可以修改后重新尝试。',
      error: failedStep?.error || '角色图生成失败',
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
      description: '动作帧已回传，正在自动写入并载入预览台。',
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

  const firstFrameStep = latestActionFirstFrame(workflow)
  if (firstFrameStep?.status === 'active' && firstFrameStep.phase === 'generating') {
    return {
      title: '正在生成动作首帧',
      description: '首帧生成完成后，请确认一张帧图，再自动生成完整动作。',
      error: null,
    }
  }
  if (firstFrameStep?.status === 'active' && firstFrameStep.phase === 'selecting') {
    return {
      title: '请选择动作首帧',
      description: '确认首帧后，将自动提交视频裁剪路线的 32 帧完整动作生成。',
      error: null,
    }
  }

  const templateNode = workflow.nodes.find(
    (n): n is CharacterTemplateWorkflowNode => n.type === 'character-template',
  )
  if (templateNode?.status === 'active') {
    if (templateNode.phase === 'selecting') {
      return {
        title: '选择一个喜欢的角色',
        description: '选择后可以继续描述这个角色接下来要做的动作。',
        error: null,
      }
    }
    return {
      title: templateNode.generations.length > 0 ? '正在生成角色图' : '正在创建生成任务',
      description:
        templateNode.generations.length > 0
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

function workflowPrompt(run: WorkflowRun): string {
  const setup = run.nodes.find((node) => node.type === 'character-setup')
  return setup?.type === 'character-setup' ? setup.input.prompt : ''
}

/** 完整动作进入可审核状态后沿用原有自动保存时机，只取消离开 Quick Start 的跳转。 */
function automaticPublishKey(run: WorkflowRun): string | null {
  const actionStep = latestActionStep(run)
  const reviewStep = actionStep ? pairedReviewStep(run, actionStep.id) : null
  const hasFrames = actionStep?.type === 'action-full-frame' && actionStep.status === 'passed'
  const reviewReady = reviewStep?.status === 'active' || reviewStep?.status === 'passed'

  return hasFrames && reviewReady && actionStep ? `${run.id}:${actionStep.id}` : null
}

function workflowHasFailure(run: WorkflowRun): boolean {
  return run.nodes.some((node) => !node.deletedAt && node.status === 'failed')
}

/** 返回当前 Run 最后追加且未删除的动作；旧动作只保留作历史结果。 */
function latestActionStep(workflow: WorkflowRun) {
  return (
    workflow.nodes.findLast((node) => node.type === 'action-full-frame' && !node.deletedAt) ?? null
  )
}

/** 每条 Action 分支都有一张首帧节点；页面只操作最新且未归档的一条。 */
function latestActionFirstFrame(workflow: WorkflowRun): ActionFirstFrameWorkflowNode | null {
  return (
    workflow.nodes.findLast(
      (node): node is ActionFirstFrameWorkflowNode =>
        node.type === 'action-first-frame' && !node.deletedAt,
    ) ?? null
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

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message.trim() : fallback
}

function presentWorkflowError(cause: unknown, fallback: string) {
  if (cause instanceof WorkflowRunConflictError) {
    return {
      message: '工作流已在其他位置更新，请加载最新版本后继续。',
      conflict: true,
    }
  }
  return { message: errorMessage(cause, fallback), conflict: false }
}
