import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import {
  ArrowBendDownLeft,
  ArrowClockwise,
  ArrowUp,
  CaretDown,
  CopySimple,
  Play,
  PlusCircle,
  Stack,
  Stop,
  X,
} from '@phosphor-icons/react'
import Markdown from 'markdown-to-jsx'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'

import {
  ART_STYLE,
  ART_STYLE_OPTIONS,
  DIRECTIONAL_MOVEMENT,
  isArtStyle,
  type ActionFirstFrameWorkflowNode,
  type ArtStyle,
  type CharacterTemplateWorkflowNode,
  type DirectionalMovement,
  type WorkflowRun,
  WorkflowRunConflictError,
} from '@/entities'
import { forgetActiveRun, isMissingActiveRunError, syncActiveRun } from '@/features/active-run'
import { useOptionalAuthSession } from '@/features/auth-session'
import { ExportButton, type ExportPackageModel } from '@/features/export-package'
import { useQuickStartAgent, useQuickStartWorkflowAgent } from '@/features/quick-start-agent/react'
import type {
  CharacterGenerationProposal,
  CreateQuickStartAgentOptions,
  PlannerMessage,
  QuickStartAgentResult,
  WorkflowAgentActions,
} from '@/features/quick-start-agent/runtime'
import {
  FrameAnimationPlayer,
  GenerationPreviewCard,
  GenerationProgressCopy,
  KineticCopyCycle,
  type KineticCopyMessage,
} from '@/shared/ui'
import {
  quickStartService,
  type QuickStartCandidate,
  type QuickStartDirectionSelections,
  type QuickStartEntryService,
  type QuickStartFailedDirection,
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

const QUICK_START_DIRECTIONAL_MOVEMENTS: readonly DirectionalMovement[] = [
  'single',
  'four-way',
  'eight-way',
]

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

const DIRECTION_LABELS = {
  east: '东',
  west: '西',
  north: '北',
  south: '南',
  north_east: '东北',
  north_west: '西北',
  south_east: '东南',
  south_west: '西南',
} as const

function groupCandidates(candidates: readonly (QuickStartCandidate | string)[]) {
  const groups = new Map<QuickStartCandidate['direction'], QuickStartCandidate[]>()
  for (const candidate of candidates) {
    const direction = typeof candidate === 'string' ? 'east' : (candidate.direction ?? 'east')
    const group = groups.get(direction) ?? []
    group.push(
      typeof candidate === 'string'
        ? { direction, index: group.length, imageUrl: candidate }
        : { ...candidate, direction },
    )
    groups.set(direction, group)
  }
  return [...groups].map(([direction, items]) => ({ direction, items }))
}

function allDirectionsSelected(
  candidates: readonly (QuickStartCandidate | string)[],
  selections: QuickStartDirectionSelections,
): boolean {
  const directions = new Set(
    candidates.map((candidate) =>
      typeof candidate === 'string' ? 'east' : (candidate.direction ?? 'east'),
    ),
  )
  return directions.size > 0 && [...directions].every((direction) => Boolean(selections[direction]))
}

const ROLE_DEFAULT_MESSAGE: readonly KineticCopyMessage[] = [
  { lines: ['用文字塑造你的角色……'], className: 'text-app-ink' },
]

const ENTRY_HANDOFF_MS = 460
const PROMPT_REWRITE_MS = 760
const AGENT_CONVERSATION_STORAGE_KEY = 'windup.quick-start.agent-chat.v2'
const LEGACY_AGENT_CONVERSATION_STORAGE_KEY = 'windup.quick-start.agent-chat.v1'
const AGENT_DRAFT_HISTORY_STATE_KEY = 'windupQuickStartAgentDraftId'

type AgentConversationTurn =
  | { role: 'user'; content: string; scope?: 'workflow' }
  | {
      role: 'assistant'
      content: string
      kind: 'reply' | 'clarification' | 'blocked'
      scope?: 'workflow'
    }
  | {
      role: 'assistant'
      content: string
      kind: 'proposal'
      proposalId: string
      optimizedPrompt: string
      actionPrompt?: string
      optimizationSummary: string
      proposalStatus: 'pending' | 'superseded' | 'adopted' | 'confirmed'
      scope?: 'workflow'
    }

type AgentConversationRecord = {
  turns: readonly AgentConversationTurn[]
  /** 入口处选的画风；不随草稿存住的话，刷新后画风选择器已隐藏而值悄悄回到不指定。 */
  gameStyle?: ArtStyle
}

type AgentConversationStorageName = 'localStorage' | 'sessionStorage'

function agentDraftConversationStorageKey(userId: string | null, draftId: string): string {
  return `${AGENT_CONVERSATION_STORAGE_KEY}:draft:${userId ?? 'local'}:${draftId}`
}

function agentRunConversationStorageKey(userId: string | null, runId: string): string {
  return `${AGENT_CONVERSATION_STORAGE_KEY}:run:${userId ?? 'local'}:${runId}`
}

function legacyAgentConversationStorageKey(userId: string | null): string {
  return `${LEGACY_AGENT_CONVERSATION_STORAGE_KEY}:${userId ?? 'local'}`
}

function readAgentDraftId(): string | null {
  try {
    const state: unknown = window.history.state
    if (typeof state !== 'object' || state === null || !(AGENT_DRAFT_HISTORY_STATE_KEY in state)) {
      return null
    }
    const draftId = (state as Record<string, unknown>)[AGENT_DRAFT_HISTORY_STATE_KEY]
    return typeof draftId === 'string' && draftId ? draftId : null
  } catch {
    return null
  }
}

function readAgentDraftGameStyle(key: string): ArtStyle {
  try {
    const stored = window.sessionStorage.getItem(key)
    if (!stored) return 'unspecified'
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || !('gameStyle' in parsed)) {
      return 'unspecified'
    }
    return isArtStyle(parsed.gameStyle) ? parsed.gameStyle : 'unspecified'
  } catch {
    return 'unspecified'
  }
}

function createAgentDraftId(): string {
  const draftId = window.crypto.randomUUID()
  try {
    const state: unknown = window.history.state
    const currentState = typeof state === 'object' && state !== null ? state : {}
    window.history.replaceState({ ...currentState, [AGENT_DRAFT_HISTORY_STATE_KEY]: draftId }, '')
  } catch {
    // history state 不可写时仍保留本次内存草稿，不阻断对话和生成。
  }
  return draftId
}

function readAgentConversation(
  storageName: AgentConversationStorageName,
  key: string,
): readonly AgentConversationTurn[] {
  try {
    const stored = window[storageName].getItem(key)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || !('turns' in parsed)) return []
    if (!Array.isArray(parsed.turns)) return []
    return parsed.turns.flatMap((turn): AgentConversationTurn[] => {
      if (
        typeof turn !== 'object' ||
        turn === null ||
        !('role' in turn) ||
        !('content' in turn) ||
        typeof turn.content !== 'string' ||
        !turn.content.trim()
      ) {
        return []
      }
      const scope = 'scope' in turn && turn.scope === 'workflow' ? 'workflow' : undefined
      if (turn.role === 'user') {
        return [{ role: 'user', content: turn.content, ...(scope ? { scope } : {}) }]
      }
      if (turn.role !== 'assistant') return []

      if (
        'kind' in turn &&
        turn.kind === 'proposal' &&
        'proposalId' in turn &&
        typeof turn.proposalId === 'string' &&
        'optimizedPrompt' in turn &&
        typeof turn.optimizedPrompt === 'string' &&
        'optimizationSummary' in turn &&
        typeof turn.optimizationSummary === 'string' &&
        'proposalStatus' in turn &&
        (turn.proposalStatus === 'pending' ||
          turn.proposalStatus === 'superseded' ||
          turn.proposalStatus === 'adopted' ||
          turn.proposalStatus === 'confirmed')
      ) {
        return [
          {
            role: 'assistant',
            content: turn.content,
            kind: 'proposal',
            proposalId: turn.proposalId,
            optimizedPrompt: turn.optimizedPrompt,
            ...('actionPrompt' in turn && typeof turn.actionPrompt === 'string'
              ? { actionPrompt: turn.actionPrompt }
              : {}),
            optimizationSummary: turn.optimizationSummary,
            proposalStatus: turn.proposalStatus,
            ...(scope ? { scope } : {}),
          },
        ]
      }

      const kind =
        'kind' in turn &&
        (turn.kind === 'reply' || turn.kind === 'clarification' || turn.kind === 'blocked')
          ? turn.kind
          : 'reply'
      return [{ role: 'assistant', content: turn.content, kind, ...(scope ? { scope } : {}) }]
    })
  } catch {
    return []
  }
}

function createAgentSeed(turns: readonly AgentConversationTurn[]): {
  messages: readonly PlannerMessage[]
  clarificationUsed: boolean
  pendingProposal: CharacterGenerationProposal | null
} {
  const pending = turns.findLast(
    (turn) =>
      turn.role === 'assistant' && turn.kind === 'proposal' && turn.proposalStatus === 'pending',
  )
  return {
    messages: turns.map(({ role, content }) => ({ role, content })),
    clarificationUsed: turns.some(
      (turn) => turn.role === 'assistant' && turn.kind === 'clarification',
    ),
    pendingProposal:
      pending?.role === 'assistant' && pending.kind === 'proposal'
        ? {
            proposalId: pending.proposalId,
            optimizedPrompt: pending.optimizedPrompt,
            ...(pending.actionPrompt ? { actionPrompt: pending.actionPrompt } : {}),
            optimizationSummary: pending.optimizationSummary,
          }
        : null,
  }
}

function writeAgentConversation(
  storageName: AgentConversationStorageName,
  key: string,
  record: AgentConversationRecord,
): boolean {
  try {
    window[storageName].setItem(key, JSON.stringify(record))
    return true
  } catch {
    // 对话持久化只增强刷新体验，存储不可用时不能阻断真实生成流程。
    return false
  }
}

function removeAgentConversation(storageName: AgentConversationStorageName, key: string): void {
  try {
    window[storageName].removeItem(key)
  } catch {
    // 清理失败只会留下当前标签页的孤立草稿，不影响真实生成流程。
  }
}

function readAgentRunConversation(
  userId: string | null,
  runId: string,
): readonly AgentConversationTurn[] {
  const runKey = agentRunConversationStorageKey(userId, runId)
  const currentTurns = readAgentConversation('localStorage', runKey)
  if (currentTurns.length > 0) return currentTurns

  const legacyKey = legacyAgentConversationStorageKey(userId)
  try {
    const stored = window.localStorage.getItem(legacyKey)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('runId' in parsed) ||
      parsed.runId !== runId
    ) {
      return []
    }

    // v1 只有用户级 key；仅迁移已绑定当前运行的记录，避免复活未绑定的全局草稿。
    const legacyTurns = readAgentConversation('localStorage', legacyKey)
    if (legacyTurns.length === 0) return []
    if (writeAgentConversation('localStorage', runKey, { turns: legacyTurns })) {
      removeAgentConversation('localStorage', legacyKey)
    }
    return legacyTurns
  } catch {
    return []
  }
}

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
  /** 直渲染页面测试可显式提供；生产中取当前认证用户。 */
  activeRunUserId?: string
  /** app 组合层注入 Planner 与绑定到现有 WorkflowController 的唯一写 action。 */
  agent: CreateQuickStartAgentOptions
}

/** Quick Start 独立完成 AI 入口；它不跳转 Workflow Editor。 */
export function QuickStartPage({
  service,
  activeRunUserId: providedActiveRunUserId,
  agent,
}: QuickStartPageProps) {
  const { runId } = useParams()
  const location = useLocation()
  const authSession = useOptionalAuthSession()
  const activeRunUserId =
    providedActiveRunUserId ??
    (authSession?.state.status === 'authenticated' ? authSession.state.user.id : null)
  const activeService = useMemo(() => {
    return service ?? quickStartService
  }, [service])
  const [createdSession, setCreatedSession] = useState<QuickStartSession | null>(null)
  const consumeCreatedSession = useCallback((consumed: QuickStartSession) => {
    setCreatedSession((current) => (current === consumed ? null : current))
  }, [])

  return runId ? (
    <QuickStartRun
      key={runId}
      service={activeService}
      runId={runId}
      initialSession={createdSession?.runId === runId ? createdSession : null}
      onSessionCreated={setCreatedSession}
      onInitialSessionConsumed={consumeCreatedSession}
      activeRunUserId={activeRunUserId}
      agent={agent}
    />
  ) : (
    <QuickStartInput
      key={`${location.key}:${activeRunUserId ?? 'local'}`}
      service={activeService}
      agent={agent}
      activeRunUserId={activeRunUserId}
      onSessionCreated={setCreatedSession}
    />
  )
}

function IconActionButton({
  label,
  accent = false,
  disabled = false,
  onClick,
  type = 'button',
  className = '',
  expanded,
  children,
}: {
  label: string
  accent?: boolean
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
  className?: string
  expanded?: boolean
  children: ReactNode
}) {
  const tooltipId = useId()

  return (
    <button
      type={type}
      aria-label={label}
      aria-describedby={tooltipId}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
      data-icon-action
      className={`group/action relative grid size-10 shrink-0 place-items-center rounded-lg transition focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-45 ${
        accent
          ? 'bg-app-accent text-app-on-accent hover:bg-app-accent-hover'
          : 'text-app-muted hover:bg-app-surface-muted hover:text-app-accent'
      } ${className}`}
    >
      {children}
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-app-ink px-2 py-1 text-[11px] font-medium text-app-canvas opacity-0 shadow-app-card transition group-hover/action:visible group-hover/action:opacity-100 group-focus-within/action:visible group-focus-within/action:opacity-100 invisible"
      >
        {label}
      </span>
    </button>
  )
}

function MasterFrameIcon() {
  return (
    <svg
      data-icon="master-frame"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.25 5.5h10.5a1.75 1.75 0 0 1 1.75 1.75v9.5a1.75 1.75 0 0 1-1.75 1.75H7.25a1.75 1.75 0 0 1-1.75-1.75v-9.5A1.75 1.75 0 0 1 7.25 5.5Z" />
      <path
        d="M5.5 8H4.75A1.75 1.75 0 0 0 3 9.75v8.5A1.75 1.75 0 0 0 4.75 20h10.5A1.75 1.75 0 0 0 17 18.5"
        opacity="0.58"
      />
      <path d="m8.25 15.5 2.45-2.65a.75.75 0 0 1 1.1-.02l1.45 1.45 1.2-1.2a.75.75 0 0 1 1.08.02l1.97 2.4" />
      <circle cx="15.75" cy="9.25" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function StyleTileIcon() {
  return (
    <svg
      data-icon="style-tile"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.25" y="4.25" width="15.5" height="15.5" rx="3.25" />
      <path d="M12 7.75c.38 2.42 1.83 3.87 4.25 4.25-2.42.38-3.87 1.83-4.25 4.25-.38-2.42-1.83-3.87-4.25-4.25 2.42-.38 3.87-1.83 4.25-4.25Z" />
      <circle cx="17.25" cy="6.75" r=".75" fill="currentColor" stroke="none" />
    </svg>
  )
}

function AgentActions({
  copyLabel,
  onCopy,
  exportModel,
  onOpenAssetWorkspace,
  onOpenPlaytest,
  playtestDisabled = false,
  onNewCreation,
  onRegenerate,
  regenerateDisabled = false,
  showNewCreation = true,
}: {
  copyLabel?: string
  onCopy?: () => void
  exportModel?: ExportPackageModel | null
  onOpenAssetWorkspace?: () => void
  onOpenPlaytest?: () => void
  playtestDisabled?: boolean
  onNewCreation: () => void
  onRegenerate?: () => void
  regenerateDisabled?: boolean
  showNewCreation?: boolean
}) {
  return (
    <div
      data-agent-actions
      role="group"
      aria-label="相关操作"
      className="flex w-fit max-w-full flex-wrap items-center gap-1"
    >
      {copyLabel && onCopy ? (
        <IconActionButton label={copyLabel} onClick={onCopy}>
          <CopySimple aria-hidden="true" size={18} weight="bold" />
        </IconActionButton>
      ) : null}
      {onRegenerate ? (
        <IconActionButton label="重新生成" onClick={onRegenerate} disabled={regenerateDisabled}>
          <ArrowClockwise aria-hidden="true" size={18} weight="bold" />
        </IconActionButton>
      ) : null}
      {exportModel ? (
        <ExportButton
          model={exportModel}
          iconOnly
          className="text-app-muted hover:bg-app-surface-muted hover:text-app-accent"
        />
      ) : null}
      {onOpenAssetWorkspace ? (
        <IconActionButton label="跳转到资产工作台" onClick={onOpenAssetWorkspace}>
          <Stack data-icon="asset-stack" aria-hidden="true" size={18} weight="bold" />
        </IconActionButton>
      ) : null}
      {onOpenPlaytest ? (
        <IconActionButton
          label="跳转到 Play Test"
          onClick={onOpenPlaytest}
          disabled={playtestDisabled}
        >
          <Play data-icon="playtest-play" aria-hidden="true" size={18} weight="fill" />
        </IconActionButton>
      ) : null}
      {showNewCreation ? (
        <IconActionButton label="新建一次创作" onClick={onNewCreation}>
          <PlusCircle aria-hidden="true" size={18} weight="bold" />
        </IconActionButton>
      ) : null}
    </div>
  )
}

function QuickStartInput({
  service,
  agent,
  activeRunUserId,
  onSessionCreated,
}: {
  service: QuickStartEntryService
  agent: CreateQuickStartAgentOptions
  activeRunUserId: string | null
  onSessionCreated: (session: QuickStartSession) => void
}) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [directionalMovement, setDirectionalMovement] = useState<DirectionalMovement>('single')
  const [confirmedPrompt, setConfirmedPrompt] = useState<string | null>(null)
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [gameStyle, setGameStyle] = useState<ArtStyle>(() => {
    const draftId = readAgentDraftId()
    return draftId
      ? readAgentDraftGameStyle(agentDraftConversationStorageKey(activeRunUserId, draftId))
      : 'unspecified'
  })
  const gameStyleRef = useRef(gameStyle)
  gameStyleRef.current = gameStyle
  const [submitting, setSubmitting] = useState(false)
  const [revealingFirstAgentTurn, setRevealingFirstAgentTurn] = useState(false)
  const [entryTransition, setEntryTransition] = useState<'idle' | 'leaving'>('idle')
  const [promptState, setPromptState] = useState<
    'collecting' | 'rewriting' | 'ready' | 'direction' | 'confirmed'
  >('collecting')
  const [error, setError] = useState<string | null>(null)
  const draftIdRef = useRef(readAgentDraftId())
  const [conversationTurns, setConversationTurns] = useState<readonly AgentConversationTurn[]>(
    () => {
      const draftId = draftIdRef.current
      return draftId
        ? readAgentConversation(
            'sessionStorage',
            agentDraftConversationStorageKey(activeRunUserId, draftId),
          )
        : []
    },
  )
  const fileInput = useRef<HTMLInputElement>(null)
  const promptInput = useRef<HTMLTextAreaElement>(null)
  const submitAbortController = useRef<AbortController | null>(null)
  const pendingPrompt = useRef<string | null>(null)
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rewriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conversationTurnsRef = useRef(conversationTurns)
  const initialConversationLength = useRef(conversationTurns.length)
  const initialAgentSeed = useRef(createAgentSeed(conversationTurns)).current
  const agentSession = useQuickStartAgent({
    ...agent,
    initialMessages: initialAgentSeed.messages,
    initialClarificationUsed: initialAgentSeed.clarificationUsed,
    initialProposal: initialAgentSeed.pendingProposal,
  })
  const unavailableReason = service.unavailableReason
  const agentPlanning = agentSession.state.status === 'planning'
  const agentThinking = agentPlanning || revealingFirstAgentTurn
  const generationStarting = promptState === 'confirmed'
  const entryBusy =
    submitting ||
    agentThinking ||
    promptState === 'rewriting' ||
    promptState === 'direction' ||
    generationStarting
  const entryCanInterrupt = submitting || agentPlanning
  const hasPrompt = Boolean(prompt.trim())
  const hasConversation = conversationTurns.length > 0
  const showConversation = hasConversation || agentThinking || agentSession.state.status === 'error'
  const promptMessage = useMemo<readonly KineticCopyMessage[]>(
    () => [{ lines: [prompt] }],
    [prompt],
  )

  const ensureDraftId = useCallback(() => {
    const current = draftIdRef.current
    if (current) return current
    const draftId = createAgentDraftId()
    draftIdRef.current = draftId
    return draftId
  }, [])

  const persistDraftConversation = useCallback(
    (turns: readonly AgentConversationTurn[]) => {
      conversationTurnsRef.current = turns
      const draftId = ensureDraftId()
      writeAgentConversation(
        'sessionStorage',
        agentDraftConversationStorageKey(activeRunUserId, draftId),
        { turns, gameStyle: gameStyleRef.current },
      )
    },
    [activeRunUserId, ensureDraftId],
  )

  const persistRunConversation = useCallback(
    (turns: readonly AgentConversationTurn[], runId: string) => {
      conversationTurnsRef.current = turns
      const stored = writeAgentConversation(
        'localStorage',
        agentRunConversationStorageKey(activeRunUserId, runId),
        { turns },
      )
      if (stored) {
        const draftId = draftIdRef.current
        if (draftId) {
          removeAgentConversation(
            'sessionStorage',
            agentDraftConversationStorageKey(activeRunUserId, draftId),
          )
        }
      }
    },
    [activeRunUserId],
  )

  const appendConversationTurn = useCallback(
    (turn: AgentConversationTurn) => {
      const next = [...conversationTurnsRef.current, turn]
      conversationTurnsRef.current = next
      setConversationTurns(next)
      persistDraftConversation(next)
    },
    [persistDraftConversation],
  )

  async function revealFirstAgentTurn(turn: AgentConversationTurn) {
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => { ready: Promise<void> }
    }
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const titleBot = document.querySelector('[data-quick-start-agent-bot][data-placement="title"]')
    const update = () => {
      appendConversationTurn(turn)
      setRevealingFirstAgentTurn(true)
    }

    if (!titleBot || reducedMotion || !transitionDocument.startViewTransition) {
      update()
      return
    }

    let updated = false
    try {
      const transition = transitionDocument.startViewTransition(() => {
        updated = true
        flushSync(update)
      })
      await transition.ready
    } catch {
      if (!updated) update()
    }
  }

  useEffect(
    () => () => {
      submitAbortController.current?.abort()
      if (handoffTimer.current) clearTimeout(handoffTimer.current)
      if (rewriteTimer.current) clearTimeout(rewriteTimer.current)
    },
    [],
  )

  function updateProposalStatus(
    proposalId: string,
    proposalStatus: Extract<AgentConversationTurn, { kind: 'proposal' }>['proposalStatus'],
    confirmedPrompt?: string,
  ): readonly AgentConversationTurn[] {
    const next = conversationTurnsRef.current.map((turn) =>
      turn.role === 'assistant' && turn.kind === 'proposal' && turn.proposalId === proposalId
        ? {
            ...turn,
            content: confirmedPrompt
              ? `${turn.optimizationSummary}\n\n角色：${confirmedPrompt}${turn.actionPrompt ? `\n动作：${turn.actionPrompt}` : ''}`
              : turn.content,
            optimizedPrompt: confirmedPrompt ?? turn.optimizedPrompt,
            proposalStatus,
          }
        : turn,
    )
    conversationTurnsRef.current = next
    setConversationTurns(next)
    persistDraftConversation(next)
    return next
  }

  function fillOptimizedPrompt(proposalId: string) {
    const state = agentSession.state
    if (
      state.status !== 'proposal' ||
      state.proposalId !== proposalId ||
      promptState === 'rewriting' ||
      generationStarting
    ) {
      return
    }

    updateProposalStatus(proposalId, 'adopted')
    setPrompt(state.optimizedPrompt)
    setPromptState('rewriting')
    if (rewriteTimer.current) clearTimeout(rewriteTimer.current)
    rewriteTimer.current = setTimeout(() => {
      rewriteTimer.current = null
      setPromptState('ready')
      promptInput.current?.focus()
    }, PROMPT_REWRITE_MS)
  }

  async function confirmAutomaticProposal(proposalId: string) {
    const state = agentSession.state
    if (state.status !== 'proposal' || state.proposalId !== proposalId || generationStarting) {
      return
    }
    setPromptState('confirmed')
    try {
      const result = await agentSession.confirmProposal(
        state.optimizedPrompt,
        directionalMovement,
        { gameStyle, automaticDelivery: true },
      )
      if (result.kind === 'generated') await handoffGenerated(result)
    } catch {
      setPromptState('collecting')
    }
  }

  function selectTemplateFile(event: ChangeEvent<HTMLInputElement>) {
    if (entryBusy) return
    const selected = event.target.files?.[0] ?? null
    setTemplateFile(selected)
    setError(null)
  }

  function removeTemplateFile() {
    setTemplateFile(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  function chooseGameStyle(next: ArtStyle) {
    setGameStyle(next)
    setStyleMenuOpen(false)
    const draftId = draftIdRef.current
    if (draftId) {
      writeAgentConversation(
        'sessionStorage',
        agentDraftConversationStorageKey(activeRunUserId, draftId),
        { turns: conversationTurnsRef.current, gameStyle: next },
      )
    }
  }

  function stopEntryWork() {
    agentSession.cancel()
    submitAbortController.current?.abort()
    submitAbortController.current = null
    if (handoffTimer.current) clearTimeout(handoffTimer.current)
    handoffTimer.current = null
    if (pendingPrompt.current) {
      const restoredPrompt = pendingPrompt.current
      setPrompt(restoredPrompt)
      const turns = conversationTurnsRef.current
      const lastTurn = turns.at(-1)
      if (lastTurn?.role === 'user' && lastTurn.content === restoredPrompt) {
        const nextTurns = turns.slice(0, -1)
        conversationTurnsRef.current = nextTurns
        setConversationTurns(nextTurns)
        persistDraftConversation(nextTurns)
      }
    }
    pendingPrompt.current = null
    setSubmitting(false)
    setRevealingFirstAgentTurn(false)
    setEntryTransition('idle')
  }

  async function handoffGenerated(
    result: Extract<QuickStartAgentResult, { kind: 'generated' }>,
  ): Promise<void> {
    const confirmedTurns = updateProposalStatus(
      result.proposalId,
      'confirmed',
      result.optimizedPrompt,
    )
    persistRunConversation(confirmedTurns, result.runId)
    setEntryTransition('leaving')
    await new Promise<void>((resolve) => {
      handoffTimer.current = setTimeout(() => {
        handoffTimer.current = null
        resolve()
      }, ENTRY_HANDOFF_MS)
    })
    navigate(`/quick-start/${encodeURIComponent(result.runId)}`)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedPrompt = prompt.trim()

    if (agentSession.state.status === 'proposal' && promptState === 'ready') {
      if (!normalizedPrompt) return
      setConfirmedPrompt(normalizedPrompt)
      setPrompt('')
      setPromptState('direction')
      appendConversationTurn({
        role: 'assistant',
        content: '最后确认一下：需要单向、四向还是八向？',
        kind: 'clarification',
      })
      return
    }

    if ((!normalizedPrompt && !templateFile) || entryBusy || unavailableReason) return

    if (!templateFile) {
      setError(null)
      if (agentSession.state.status === 'proposal') {
        updateProposalStatus(agentSession.state.proposalId, 'superseded')
      }
      const userTurn: AgentConversationTurn = { role: 'user', content: normalizedPrompt }
      if (hasConversation) appendConversationTurn(userTurn)
      else await revealFirstAgentTurn(userTurn)
      pendingPrompt.current = normalizedPrompt
      setPrompt('')
      try {
        const result = await agentSession.submit(normalizedPrompt)
        pendingPrompt.current = null
        setRevealingFirstAgentTurn(false)
        if (result.kind === 'message') {
          appendConversationTurn({
            role: 'assistant',
            content: result.message,
            kind: result.messageKind,
          })
          return
        }
        if (result.kind === 'proposal') {
          appendConversationTurn({
            role: 'assistant',
            content: `${result.optimizationSummary}\n\n角色：${result.optimizedPrompt}${result.actionPrompt ? `\n动作：${result.actionPrompt}` : ''}`,
            kind: 'proposal',
            proposalId: result.proposalId,
            optimizedPrompt: result.optimizedPrompt,
            ...(result.actionPrompt ? { actionPrompt: result.actionPrompt } : {}),
            optimizationSummary: result.optimizationSummary,
            proposalStatus: 'pending',
          })
        }
      } catch (cause) {
        setRevealingFirstAgentTurn(false)
        if (!(cause instanceof Error && cause.name === 'AbortError')) {
          setEntryTransition('idle')
          setPromptState('collecting')
        }
      }
      return
    }

    const abortController = new AbortController()
    submitAbortController.current = abortController
    setSubmitting(true)
    setEntryTransition('leaving')
    setError(null)
    try {
      const sessionPromise = service.startWithUploadedTemplate(
        templateFile,
        normalizedPrompt,
        abortController.signal,
        directionalMovement,
        { gameStyle },
      )
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

  async function chooseDirectionalMovement(movement: DirectionalMovement) {
    if (!confirmedPrompt || promptState !== 'direction') return
    setDirectionalMovement(movement)
    appendConversationTurn({ role: 'user', content: DIRECTIONAL_MOVEMENT[movement] })
    setPromptState('confirmed')
    try {
      const result = await agentSession.confirmProposal(confirmedPrompt, movement, { gameStyle })
      if (result.kind === 'generated') await handoffGenerated(result)
    } catch {
      setPromptState('direction')
    }
  }

  const inputLocked =
    submitting ||
    agentThinking ||
    promptState === 'rewriting' ||
    promptState === 'direction' ||
    generationStarting
  const awaitingGenerationConfirmation =
    agentSession.state.status === 'proposal' && promptState === 'ready'
  const buttonLabel = submitting
    ? '正在创建…'
    : agentPlanning
      ? '正在判断…'
      : promptState === 'rewriting'
        ? '优化中'
        : awaitingGenerationConfirmation
          ? '发送生成'
          : generationStarting
            ? '正在开始生成…'
            : hasConversation
              ? '继续'
              : '生成角色'
  const canSubmit = awaitingGenerationConfirmation
    ? Boolean(prompt.trim())
    : Boolean(prompt.trim()) || Boolean(templateFile)
  const [styleMenuOpen, setStyleMenuOpen] = useState(false)
  const [directionMenuOpen, setDirectionMenuOpen] = useState(false)
  const [directionDragging, setDirectionDragging] = useState(false)
  const [directionSliderValue, setDirectionSliderValue] = useState(() =>
    QUICK_START_DIRECTIONAL_MOVEMENTS.indexOf(directionalMovement),
  )
  const directionalMovementIndex = QUICK_START_DIRECTIONAL_MOVEMENTS.indexOf(directionalMovement)

  return (
    <section
      aria-label="创作入口"
      className="relative min-h-[100dvh] overflow-hidden bg-app-canvas pt-14 text-app-ink"
    >
      <AmbientGrid />

      <div
        data-layout="quick-start-entry"
        data-transition={entryTransition}
        className="relative z-10 grid h-[calc(100dvh-3.5rem)] grid-rows-[1fr_auto] gap-6 px-5 py-6 sm:px-8 sm:pb-4 sm:pt-10"
      >
        <div
          data-layout="quick-start-entry-stage"
          className={`mx-auto grid min-h-0 w-full max-w-3xl gap-5 overflow-y-auto pb-8 transition-[opacity,transform,filter] duration-[460ms] ease-[cubic-bezier(0.55,0,1,0.45)] motion-reduce:transition-none sm:gap-6 ${
            showConversation ? 'content-end' : 'content-center'
          } ${
            entryTransition === 'leaving'
              ? 'pointer-events-none -translate-y-3 scale-[0.985] opacity-0 blur-[7px]'
              : 'translate-y-0 scale-100 opacity-100 blur-0'
          }`}
        >
          {showConversation ? (
            <div
              data-testid="quick-start-transcript"
              className="grid min-h-full w-full content-end gap-5 py-4"
            >
              {conversationTurns.map((turn, index) => (
                <div
                  key={`${turn.role}:${index}:${turn.content}`}
                  data-conversation-kind="agent"
                  className="min-w-0"
                >
                  {turn.role === 'user' ? (
                    <UserTurn>{turn.content}</UserTurn>
                  ) : turn.kind === 'proposal' ? (
                    <PromptProposal
                      summary={turn.optimizationSummary}
                      prompt={turn.optimizedPrompt}
                      actionPrompt={turn.actionPrompt}
                      status={turn.proposalStatus}
                      disabled={
                        turn.proposalStatus !== 'pending' ||
                        agentSession.state.status !== 'proposal' ||
                        agentSession.state.proposalId !== turn.proposalId ||
                        promptState === 'rewriting' ||
                        generationStarting
                      }
                      onConfirm={() => void confirmAutomaticProposal(turn.proposalId)}
                      onFill={() => fillOptimizedPrompt(turn.proposalId)}
                    />
                  ) : (
                    <AgentCopy
                      lines={turn.content.split('\n')}
                      animate={index >= initialConversationLength.current}
                    />
                  )}
                </div>
              ))}
              {agentThinking ? (
                <div
                  data-conversation-kind="agent"
                  data-agent-loading
                  role="status"
                  aria-label="Agent 正在思考"
                  className="quick-start-agent-loading grid min-w-0 grid-cols-[2rem_auto] gap-3"
                >
                  <QuickStartAgentBot placement="thinking" />
                  <span aria-hidden="true" className="quick-start-agent-loading-dots">
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="quick-start-agent-loading-dot"
                        style={{ '--agent-loading-index': dot } as CSSProperties}
                      />
                    ))}
                  </span>
                </div>
              ) : null}
              {agentSession.state.status === 'error' ? (
                <div role="alert" data-conversation-kind="agent" className="min-w-0">
                  <AgentCopy lines={[agentSession.state.message]} tone="danger" />
                </div>
              ) : null}
              {promptState === 'direction' ? (
                <div className="flex flex-wrap gap-2" aria-label="选择生成方向">
                  {QUICK_START_DIRECTIONAL_MOVEMENTS.map((movement) => (
                    <button
                      key={movement}
                      type="button"
                      onClick={() => void chooseDirectionalMovement(movement)}
                      className="rounded-full border border-app-line bg-app-surface-raised px-4 py-2 text-sm font-semibold text-app-ink transition hover:border-app-accent hover:text-app-accent"
                    >
                      {DIRECTIONAL_MOVEMENT[movement]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="grid justify-items-center gap-5">
                <QuickStartAgentBot placement="title" />
                <KineticCopyCycle
                  active={!templateFile && !entryBusy}
                  as="h1"
                  ariaLabel="想做一个什么角色？"
                  motionMode="characters"
                  firstCycleMs={2_400}
                  loopStartIndex={1}
                  messages={hasPrompt ? ROLE_DEFAULT_MESSAGE : ROLE_IDEA_MESSAGES}
                  className="min-h-12 text-center font-serif text-[clamp(1.75rem,4vw,2.65rem)] leading-none font-medium tracking-[-0.045em]"
                />
              </div>
            </>
          )}
        </div>

        <div
          data-testid="quick-start-composer"
          data-layout="quick-start-composer"
          data-position="bottom"
          data-prompt-state={promptState}
          className={`mx-auto w-full max-w-3xl self-end transition-[opacity,transform,filter] duration-[460ms] ease-[cubic-bezier(0.55,0,1,0.45)] motion-reduce:transition-none ${
            entryTransition === 'leaving'
              ? 'pointer-events-none translate-y-2 opacity-0 blur-[5px]'
              : 'translate-y-0 opacity-100 blur-0'
          }`}
        >
          <form
            onSubmit={(event) => void submit(event)}
            autoComplete="off"
            data-prompt-state={promptState}
            className="quick-start-agent-composer relative flex flex-col"
          >
            <label
              className="relative block min-h-[52px] min-w-0 overflow-hidden rounded-[18px] border border-app-line-strong bg-app-surface-raised shadow-app-panel transition-[border-color,box-shadow] focus-within:border-app-accent focus-within:shadow-[var(--shadow-app-composer-focus)]"
              htmlFor="quick-start-prompt"
            >
              <span className="sr-only">创作指令</span>
              <textarea
                ref={promptInput}
                id="quick-start-prompt"
                rows={1}
                autoComplete="off"
                aria-label="创作指令"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.metaKey || event.nativeEvent.isComposing) {
                    return
                  }
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }}
                disabled={inputLocked}
                placeholder={
                  agentPlanning
                    ? 'Agent 正在整理…'
                    : generationStarting
                      ? '正在创建素材流程…'
                      : templateFile
                        ? '描述动作，可留空生成待机动作…'
                        : '描述角色的外形、身份和气质…'
                }
                className={`block min-h-[52px] max-h-40 w-full min-w-0 resize-none overflow-y-auto border-0 bg-transparent py-[14px] pr-14 pl-4 text-[15px] leading-6 text-app-ink outline-none [field-sizing:content] placeholder:text-app-faint ${
                  promptState === 'rewriting' ? 'text-transparent caret-transparent' : ''
                }`}
              />
              {promptState === 'rewriting' ? (
                <span
                  data-prompt-rewrite
                  aria-hidden="true"
                  className="quick-start-prompt-rewrite absolute inset-0 flex min-h-[52px] max-h-40 items-start overflow-y-auto py-[14px] pr-14 pl-4 text-[15px] leading-6 text-app-ink"
                >
                  <KineticCopyCycle
                    active
                    as="span"
                    messages={promptMessage}
                    motionMode="characters"
                    className="quick-start-prompt-kinetic w-full"
                  />
                </span>
              ) : null}
            </label>
            <button
              type={entryCanInterrupt ? 'button' : 'submit'}
              aria-label={entryCanInterrupt ? '停止生成' : buttonLabel}
              title={entryCanInterrupt ? '停止生成' : buttonLabel}
              onClick={entryCanInterrupt ? stopEntryWork : undefined}
              disabled={
                entryCanInterrupt ? false : !canSubmit || entryBusy || Boolean(unavailableReason)
              }
              className={`absolute right-[6px] bottom-[6px] z-10 grid size-10 place-items-center rounded-full border-0 text-app-canvas transition-[opacity,transform,background] duration-150 hover:-translate-y-px active:scale-95 disabled:cursor-default disabled:opacity-25 ${
                entryCanInterrupt ? 'bg-app-ink' : 'bg-app-accent hover:bg-app-accent-hover'
              }`}
            >
              {entryCanInterrupt ? (
                <Stop aria-hidden="true" size={16} weight="fill" />
              ) : (
                <ArrowUp aria-hidden="true" size={19} weight="bold" />
              )}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              aria-label="上传角色母版"
              disabled={entryBusy || hasConversation}
              className="sr-only"
              onChange={selectTemplateFile}
            />
            <div
              data-layout="quick-start-composer-controls"
              className="order-first mb-2 flex min-h-10 items-center justify-between gap-3 px-1"
            >
              {!hasConversation ? (
                <div className="flex items-center gap-1">
                  <IconActionButton
                    label={templateFile ? `更换母版 ${templateFile.name}` : '添加母版'}
                    disabled={entryBusy}
                    onClick={() => fileInput.current?.click()}
                    className={templateFile ? 'text-app-accent' : ''}
                  >
                    <MasterFrameIcon />
                  </IconActionButton>
                  <div className="relative">
                    <IconActionButton
                      label={`选择画风，当前${ART_STYLE[gameStyle]}`}
                      disabled={entryBusy}
                      onClick={() => {
                        setDirectionMenuOpen(false)
                        setStyleMenuOpen((open) => !open)
                      }}
                      expanded={styleMenuOpen}
                    >
                      <StyleTileIcon />
                    </IconActionButton>
                    {styleMenuOpen ? (
                      <div
                        role="menu"
                        aria-label="选择画风"
                        className="quick-start-control-popover absolute bottom-full left-0 z-30 mb-3 grid min-w-32 gap-1 rounded-[14px] border border-app-line bg-[var(--color-app-surface-raised)] p-1.5 opacity-100 shadow-app-panel"
                      >
                        {ART_STYLE_OPTIONS.map((value) => (
                          <button
                            key={value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={gameStyle === value}
                            onClick={() => chooseGameStyle(value)}
                            className={`rounded-lg px-3 py-2 text-left text-xs transition ${
                              gameStyle === value
                                ? 'bg-app-accent-soft text-app-accent'
                                : 'text-app-ink-soft hover:bg-app-surface-muted'
                            }`}
                          >
                            {ART_STYLE[value]}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {templateFile && !hasConversation ? (
                <span className="absolute bottom-full left-3 mb-2 inline-flex max-w-56 items-center gap-1 rounded-lg bg-app-surface-raised px-2 py-1 text-xs text-app-ink-soft shadow-app-card">
                  <span className="truncate">{templateFile.name}</span>
                  <button
                    type="button"
                    aria-label="移除图片"
                    disabled={entryBusy}
                    onClick={removeTemplateFile}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-app-muted hover:text-app-accent"
                  >
                    <X aria-hidden="true" size={13} weight="bold" />
                  </button>
                </span>
              ) : null}
              <div className="flex items-center gap-1">
                {!hasConversation ? (
                  <>
                    <span
                      data-testid="quick-start-selected-style"
                      className="max-w-28 truncate px-2 text-sm font-medium text-app-muted"
                    >
                      {ART_STYLE[gameStyle]}
                    </span>
                    <div className="relative">
                      <button
                        type="button"
                        aria-label={`生成方向，当前${DIRECTIONAL_MOVEMENT[directionalMovement]}`}
                        aria-expanded={directionMenuOpen}
                        disabled={entryBusy}
                        onClick={() => {
                          setStyleMenuOpen(false)
                          setDirectionSliderValue(directionalMovementIndex)
                          setDirectionMenuOpen((open) => !open)
                        }}
                        className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium text-app-ink-soft transition hover:bg-app-surface-muted hover:text-app-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-45"
                      >
                        {DIRECTIONAL_MOVEMENT[directionalMovement]}
                        <CaretDown
                          aria-hidden="true"
                          size={14}
                          weight="bold"
                          className={`transition-transform duration-200 motion-reduce:transition-none ${directionMenuOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {directionMenuOpen ? (
                        <div
                          role="group"
                          aria-label="生成方向设置"
                          className="quick-start-control-popover absolute right-0 bottom-full z-30 mb-3 w-72 rounded-[18px] border border-app-line-strong bg-[var(--color-app-surface-raised)] p-5 opacity-100 shadow-app-panel"
                        >
                          <div className="mb-4 flex items-center justify-between">
                            <span className="text-sm text-app-muted">生成方向</span>
                            <strong
                              key={directionalMovement}
                              className="quick-start-direction-value text-sm font-semibold text-app-ink"
                            >
                              {DIRECTIONAL_MOVEMENT[directionalMovement]}
                            </strong>
                          </div>
                          <div className="mb-2 flex justify-between text-xs text-app-muted">
                            <span>单向</span>
                            <span>八向</span>
                          </div>
                          <div
                            data-dragging={directionDragging ? 'true' : 'false'}
                            className="quick-start-direction-slider-wrap"
                            style={
                              {
                                '--quick-start-direction-progress': `${directionSliderValue * 50}%`,
                              } as CSSProperties
                            }
                          >
                            <input
                              type="range"
                              min="0"
                              max="2"
                              step="0.01"
                              value={directionSliderValue}
                              aria-label="生成方向"
                              aria-valuetext={DIRECTIONAL_MOVEMENT[directionalMovement]}
                              onPointerDown={() => setDirectionDragging(true)}
                              onPointerUp={(event) => {
                                const index = Math.round(Number(event.currentTarget.value))
                                setDirectionDragging(false)
                                setDirectionSliderValue(index)
                                setDirectionalMovement(
                                  QUICK_START_DIRECTIONAL_MOVEMENTS[index] ?? 'single',
                                )
                              }}
                              onPointerCancel={() => setDirectionDragging(false)}
                              onBlur={(event) => {
                                const index = Math.round(Number(event.currentTarget.value))
                                setDirectionDragging(false)
                                setDirectionSliderValue(index)
                              }}
                              onChange={(event) => {
                                const value = Number(event.target.value)
                                setDirectionSliderValue(value)
                                setDirectionalMovement(
                                  QUICK_START_DIRECTIONAL_MOVEMENTS[Math.round(value)] ?? 'single',
                                )
                              }}
                              className="quick-start-direction-slider"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
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

function PromptProposal({
  summary,
  prompt,
  actionPrompt,
  status,
  disabled,
  onConfirm,
  onFill,
}: {
  summary: string
  prompt: string
  actionPrompt?: string
  status: Extract<AgentConversationTurn, { kind: 'proposal' }>['proposalStatus']
  disabled: boolean
  onConfirm: () => void
  onFill: () => void
}) {
  return (
    <div data-prompt-proposal data-conversation-kind="agent" className="min-w-0 space-y-3">
      <AgentCopy lines={[summary]} />
      <blockquote className="max-w-2xl font-serif text-base leading-7 text-app-ink">
        {prompt}
      </blockquote>
      {actionPrompt ? <p className="text-sm text-app-muted">动作：{actionPrompt}</p> : null}
      {status === 'pending' ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-label="确认并生成"
            disabled={disabled}
            onClick={onConfirm}
            className="min-h-9 rounded-full bg-app-accent px-4 text-xs font-semibold text-app-canvas transition hover:bg-app-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            确认并生成
          </button>
          <button
            type="button"
            aria-label="填入输入框"
            disabled={disabled}
            onClick={onFill}
            className="group inline-flex min-h-8 items-center gap-2 rounded-full pr-2 text-xs text-app-muted transition hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full transition group-hover:bg-app-surface-muted">
              <ArrowBendDownLeft aria-hidden="true" size={17} weight="bold" />
            </span>
            <span>编辑后逐步确认</span>
          </button>
        </div>
      ) : status === 'superseded' ? (
        <p className="text-xs text-app-faint">已继续讨论</p>
      ) : status === 'adopted' ? (
        <p className="text-xs text-app-muted">已填入输入框</p>
      ) : null}
    </div>
  )
}

function AgentCopy({
  lines,
  tone = 'default',
  animate = true,
}: {
  lines: readonly string[]
  tone?: 'default' | 'danger'
  animate?: boolean
}) {
  const copy = lines.join('\n')

  return (
    <div
      data-agent-copy
      aria-label={lines.join(' ')}
      className={`quick-start-agent-copy grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 font-serif ${
        tone === 'danger' ? 'text-app-danger' : 'text-app-ink-soft'
      } ${animate ? 'quick-start-agent-copy--entering' : ''}`}
    >
      <QuickStartAgentBot placement="answer" />
      <div
        aria-label="Agent 回答"
        data-agent-markdown
        className="quick-start-agent-markdown min-w-0"
      >
        <Markdown>{copy}</Markdown>
      </div>
    </div>
  )
}

function QuickStartAgentBot({ placement }: { placement: 'title' | 'thinking' | 'answer' }) {
  const transitionMode =
    typeof document !== 'undefined' && 'startViewTransition' in document ? 'shared' : 'fallback'
  return (
    <span
      aria-hidden="true"
      data-quick-start-agent-bot
      data-placement={placement}
      data-transition-mode={transitionMode}
      className="quick-start-agent-bot"
    >
      <svg fill="none" viewBox="0 0 24 24">
        <g className="quick-start-agent-bot__face">
          <rect
            className="quick-start-agent-bot__frame"
            height="14"
            stroke="currentColor"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            width="16"
            x="4"
            y="5"
          />
          <g className="quick-start-agent-bot__gaze">
            <g className="quick-start-agent-bot__blink" fill="currentColor">
              <rect className="quick-start-agent-bot__eye" height="3" width="3" x="8" y="10" />
              <rect className="quick-start-agent-bot__eye" height="3" width="3" x="13" y="10" />
            </g>
          </g>
        </g>
      </svg>
    </span>
  )
}

function UserTurn({ children }: { children: ReactNode }) {
  return (
    <div
      data-user-turn
      className="ml-auto w-fit max-w-[78%] rounded-[1.15rem] rounded-br-md bg-app-surface-muted px-4 py-2.5 text-left text-sm leading-6 text-app-ink-soft"
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

function DirectionCandidatePicker({
  candidates,
  selections,
  disabled,
  kind,
  onSelect,
}: {
  candidates: readonly QuickStartCandidate[]
  selections: QuickStartDirectionSelections
  disabled: boolean
  kind: '角色方案' | '动作首帧'
  onSelect: (direction: QuickStartCandidate['direction'], imageUrl: string) => void
}) {
  const groups = groupCandidates(candidates)
  const multipleDirections = groups.length > 1
  const imageName = kind === '角色方案' ? '角色图候选' : '动作首帧候选'

  return (
    <div
      data-layout="agent-result-set"
      className={`grid w-full max-w-2xl ${multipleDirections ? 'gap-5' : 'grid-cols-2 gap-3'}`}
    >
      {groups.map((group) => (
        <section
          key={group.direction}
          aria-label={`${DIRECTION_LABELS[group.direction]}方向${kind}候选`}
          className={multipleDirections ? 'grid gap-2' : 'col-span-2 grid'}
        >
          {multipleDirections ? (
            <p className="text-xs font-bold text-app-muted">
              {DIRECTION_LABELS[group.direction]}方向
            </p>
          ) : null}
          <div data-layout="agent-result-set" className="grid w-full max-w-2xl grid-cols-3 gap-3">
            {group.items.map((candidate, displayIndex) => {
              const chosen = selections[group.direction] === candidate.imageUrl
              const directionLabel = multipleDirections
                ? `${DIRECTION_LABELS[group.direction]}方向`
                : ''
              return (
                <button
                  key={`${candidate.imageUrl}:${candidate.index}`}
                  type="button"
                  aria-label={`选择${directionLabel}${kind} ${displayIndex + 1}`}
                  aria-pressed={chosen}
                  disabled={disabled}
                  onClick={() => onSelect(group.direction, candidate.imageUrl)}
                  data-asset-choice="true"
                  data-result-priority={
                    kind === '动作首帧'
                      ? displayIndex === 0
                        ? 'primary'
                        : 'alternative'
                      : undefined
                  }
                  data-reveal="card"
                  style={{ '--reveal-index': displayIndex } as CSSProperties}
                  className={`quick-start-reveal-card relative aspect-square overflow-hidden rounded-2xl border bg-app-surface-raised text-left transition duration-200 ${
                    chosen
                      ? 'border-app-accent ring-1 ring-app-accent'
                      : 'border-app-line hover:border-app-line-strong'
                  } disabled:cursor-default disabled:hover:border-app-line`}
                >
                  <span data-asset-frame className="block h-full min-h-0 bg-app-surface-muted">
                    <AssetVisual
                      src={candidate.imageUrl}
                      alt={`${directionLabel}${imageName} ${displayIndex + 1}`}
                      priority={displayIndex === 0}
                      className="quick-start-generated-image aspect-square h-full w-full object-contain [image-rendering:pixelated]"
                    />
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function DirectionFirstFrameStack({
  directions,
  selections,
}: {
  directions: readonly QuickStartCandidate['direction'][]
  selections: QuickStartDirectionSelections
}) {
  const directionCountLabel =
    directions.length === 8 ? '八向' : directions.length === 4 ? '四向' : '单向'
  return (
    <div
      role="group"
      aria-label={`${directionCountLabel}首帧集合`}
      data-layout="direction-first-frame-stack"
      className="grid aspect-square w-full max-w-xl grid-cols-2 gap-3 overflow-hidden rounded-[2rem] border border-app-line-strong bg-app-surface-muted p-4 shadow-app-card sm:p-5"
    >
      {directions.map((direction) => {
        const imageUrl = selections[direction]
        return imageUrl ? (
          <figure
            key={direction}
            className="relative min-h-0 overflow-hidden rounded-2xl border border-app-line bg-app-surface-raised"
          >
            <AssetVisual
              src={imageUrl}
              alt={`${DIRECTION_LABELS[direction]}方向首帧`}
              className="h-full w-full object-contain [image-rendering:pixelated]"
            />
            <figcaption className="absolute bottom-2 left-2 rounded-full bg-app-canvas/85 px-2 py-1 text-[10px] font-bold text-app-ink backdrop-blur-sm">
              {DIRECTION_LABELS[direction]}
            </figcaption>
          </figure>
        ) : (
          <div
            key={direction}
            role="status"
            aria-label={`${DIRECTION_LABELS[direction]}方向首帧生成中`}
            className="grid min-h-0 place-items-center rounded-2xl border border-dashed border-app-line bg-app-surface-raised text-xs font-semibold text-app-muted"
          >
            {DIRECTION_LABELS[direction]}方向生成中
          </div>
        )
      })}
    </div>
  )
}

function GenerationCanvas({ label }: { label: string }) {
  return <GenerationPreviewCard label={label} />
}

function RestoringConversation({ turns }: { turns: readonly AgentConversationTurn[] }) {
  return (
    <section className="relative min-h-screen overflow-hidden bg-app-canvas pt-14 text-app-ink">
      <div
        aria-busy="true"
        data-testid="quick-start-run"
        data-layout="agent-shell"
        className="relative h-[calc(100dvh-3.5rem)] overflow-hidden"
      >
        <main
          data-layout="quick-start-scroll-region"
          className="absolute inset-0 overflow-y-auto px-5 pt-14 pb-32 sm:px-8 sm:pt-10 sm:pb-36"
        >
          <div
            data-testid="quick-start-restoring-transcript"
            className="mx-auto grid min-h-full w-full max-w-3xl content-end gap-7 pb-8 sm:gap-9"
          >
            {turns.map((turn, index) => (
              <div
                key={`${turn.role}:${index}:${turn.content}`}
                data-conversation-kind="agent"
                className="min-w-0"
              >
                {turn.role === 'user' ? (
                  <UserTurn>{turn.content}</UserTurn>
                ) : (
                  <AgentCopy lines={turn.content.split('\n')} animate={false} />
                )}
              </div>
            ))}
            <div data-testid="quick-start-transcript-end" />
          </div>
        </main>
      </div>
    </section>
  )
}

function QuickStartRun({
  service,
  runId,
  initialSession,
  onSessionCreated,
  onInitialSessionConsumed,
  activeRunUserId,
  agent,
}: {
  service: QuickStartEntryService
  runId: string
  initialSession: QuickStartSession | null
  onSessionCreated: (session: QuickStartSession) => void
  onInitialSessionConsumed: (session: QuickStartSession) => void
  activeRunUserId: string | null
  agent: CreateQuickStartAgentOptions
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const addActionIntent = searchParams.get('intent') === 'add-action'
  const [session, setSession] = useState<QuickStartSession | null>(null)
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workflowConflict, setWorkflowConflict] = useState(false)
  const [selectedCandidates, setSelectedCandidates] = useState<QuickStartDirectionSelections>({})
  const [selectedFirstFrames, setSelectedFirstFrames] = useState<QuickStartDirectionSelections>({})
  const [actionDescription, setActionDescription] = useState('')
  const [candidates, setCandidates] = useState<readonly QuickStartCandidate[]>([])
  const [firstFrameCandidates, setFirstFrameCandidates] = useState<readonly QuickStartCandidate[]>(
    [],
  )
  const [actionFrames, setActionFrames] = useState<readonly QuickStartFrame[]>([])
  const [failedDirections, setFailedDirections] = useState<readonly QuickStartFailedDirection[]>([])
  const [retryingDirection, setRetryingDirection] = useState<string | null>(null)
  const [exportModel, setExportModel] = useState<ExportPackageModel | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [confirmingCandidate, setConfirmingCandidate] = useState(false)
  const [confirmingFirstFrame, setConfirmingFirstFrame] = useState(false)
  const [addingAction, setAddingAction] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const initialAgentConversation = useRef(readAgentRunConversation(activeRunUserId, runId)).current
  const [agentConversationTurns, setAgentConversationTurns] = useState(initialAgentConversation)
  const agentConversationTurnsRef = useRef(agentConversationTurns)
  const initialWorkflowAgentSeed = useRef(createAgentSeed(initialAgentConversation)).current
  const automaticPublishAttempt = useRef<string | null>(null)
  const transcriptScrollRegion = useRef<HTMLElement>(null)
  const promptCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const workflowConflictRef = useRef(false)
  const initialSessionRef = useRef(initialSession)
  const activeSessionRef = useRef<QuickStartSession | null>(null)
  const pendingDisposeRef = useRef<{
    session: QuickStartSession
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const mountedRef = useRef(true)
  const workflowAgentActions = useMemo<WorkflowAgentActions>(
    () => ({
      getContext: () =>
        activeSessionRef.current?.getWorkflowAgentContext() ?? { availableTools: [] },
      async regenerateCharacterTemplate() {
        const target = activeSessionRef.current
        if (!target) throw new Error('当前生成会话尚未恢复')
        const updated = await target.regenerateCharacterTemplate('regenerate')
        if (mountedRef.current && activeSessionRef.current === target) setRun(updated)
      },
      async refineCharacterTemplate(adjustmentPrompt) {
        const target = activeSessionRef.current
        if (!target) throw new Error('当前生成会话尚未恢复')
        const updated = await target.regenerateCharacterTemplate('refine', adjustmentPrompt)
        if (mountedRef.current && activeSessionRef.current === target) setRun(updated)
      },
      async regenerateFirstFrame() {
        const target = activeSessionRef.current
        if (!target) throw new Error('当前生成会话尚未恢复')
        const updated = await target.regenerateFirstFrame('regenerate')
        if (mountedRef.current && activeSessionRef.current === target) setRun(updated)
      },
      async refineFirstFrame(adjustmentPrompt) {
        const target = activeSessionRef.current
        if (!target) throw new Error('当前生成会话尚未恢复')
        const updated = await target.regenerateFirstFrame('refine', adjustmentPrompt)
        if (mountedRef.current && activeSessionRef.current === target) setRun(updated)
      },
    }),
    [],
  )
  const workflowAgentSession = useQuickStartWorkflowAgent({
    planner: agent.planner,
    actions: workflowAgentActions,
    initialMessages: initialWorkflowAgentSeed.messages,
  })
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

  const appendRunConversationTurn = useCallback(
    (turn: AgentConversationTurn) => {
      const next = [...agentConversationTurnsRef.current, turn]
      agentConversationTurnsRef.current = next
      setAgentConversationTurns(next)
      writeAgentConversation(
        'localStorage',
        agentRunConversationStorageKey(activeRunUserId, runId),
        { turns: next },
      )
    },
    [activeRunUserId, runId],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      activeSessionRef.current = null
      if (promptCopyTimer.current) clearTimeout(promptCopyTimer.current)
    }
  }, [])

  // 用户会在生成的几分钟里离开这个页面，Header 靠这个指针提供返回入口。
  useEffect(() => {
    if (activeRunUserId) syncActiveRun(activeRunUserId, run)
  }, [activeRunUserId, run])

  useEffect(() => {
    let active = true
    let currentSession: QuickStartSession | null = null
    let unsubscribe: () => void = () => undefined
    let unsubscribeErrors: () => void = () => undefined
    setRestoring(true)
    setSession(null)
    setRun(null)
    setSelectedCandidates({})
    setSelectedFirstFrames({})
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
      const resumed = addActionIntent
        ? await nextSession.resume({ automaticActionAdvance: false })
        : await nextSession.resume()
      if (active) {
        setRun(resumed)
        clearWorkflowError()
        setRestoring(false)
      }
    })().catch((cause) => {
      if (active) {
        if (activeRunUserId && isMissingActiveRunError(cause)) {
          forgetActiveRun(activeRunUserId, runId)
        }
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
  }, [
    addActionIntent,
    activeRunUserId,
    clearWorkflowError,
    onInitialSessionConsumed,
    reportWorkflowError,
    runId,
    service,
  ])

  useEffect(() => {
    if (!run || !session) {
      setCandidates([])
      setFirstFrameCandidates([])
      setActionFrames([])
      setFailedDirections([])
      setExportModel(null)
      return
    }
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
    if (!templateIsSelecting) setCandidates([])
    if (!firstFrameIsSelecting) setFirstFrameCandidates([])
    let active = true
    void Promise.all([
      session.getTemplateCandidates(),
      session.getFirstFrameCandidates(),
      session.getActionFrames(),
      session.getExportModel(),
      session.getFailedGenerationDirections(),
    ])
      .then(
        ([nextCandidates, nextFirstFrameCandidates, nextFrames, nextExportModel, nextFailed]) => {
          if (!active) return
          if (templateIsSelecting && nextCandidates.length > 0) setCandidates(nextCandidates)
          if (firstFrameIsSelecting && nextFirstFrameCandidates.length > 0) {
            setFirstFrameCandidates(nextFirstFrameCandidates)
          }
          if (nextFrames.length > 0) setActionFrames(nextFrames)
          setExportModel(nextExportModel)
          setFailedDirections(nextFailed)
        },
      )
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
  }, [actionFrames, agentConversationTurns, candidates, firstFrameCandidates, run])

  if (!run) {
    if (restoring) return <RestoringConversation turns={agentConversationTurns} />

    return (
      <section className="min-h-[520px] rounded-[2rem] border border-app-line bg-app-canvas p-8 text-app-ink">
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-app-muted">
          QUICK START / RECOVERY
        </p>
        <h1 className="mt-4 font-serif text-4xl">无法恢复这次创作</h1>
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
  const workflowHasActiveNode = revision.nodes.some(
    (node) => !node.deletedAt && node.status === 'active',
  )
  const workflowIsActive = workflowHasActiveNode && !workflowHasFailure(revision)
  const isActionFailed = actionStep?.status === 'failed'
  const isTemplateFailed = templateStep?.status === 'failed'
  const isTemplateSelecting =
    templateStep?.status === 'active' && templateStep.phase === 'selecting'
  const isDirectionSetSelecting = isTemplateSelecting && Boolean(templateStep?.selectedImageUrl)
  const isFirstFrameSelecting =
    firstFrameStep?.status === 'active' && firstFrameStep.phase === 'selecting'
  const isFirstFrameFailed = firstFrameStep?.status === 'failed'
  const composerCanInterrupt = workflowIsActive && !isTemplateSelecting && !isFirstFrameSelecting
  const candidateGroups = groupCandidates(candidates)
  const firstFrameCandidateGroups = groupCandidates(firstFrameCandidates)
  const templateDirections = Array.from(
    new Set(
      templateStep?.generations
        .filter((reference) => reference.role === 'character_template')
        .map((reference) => reference.direction ?? 'east') ?? [],
    ),
  )
  const singletonDirectionSelections = templateStep?.selectedImageUrl
    ? Object.fromEntries(
        candidateGroups
          .filter((group) => group.items.length === 1)
          .map((group) => [group.direction, group.items[0]!.imageUrl]),
      )
    : {}
  const templateSelections: QuickStartDirectionSelections = {
    ...(templateStep?.selectedImageUrl ? { east: templateStep.selectedImageUrl } : {}),
    ...(templateStep?.selectedImages ?? {}),
    ...singletonDirectionSelections,
    ...selectedCandidates,
  }
  const firstFrameSelections: QuickStartDirectionSelections = {
    ...(firstFrameStep?.selectedFirstFrameUrl
      ? { east: firstFrameStep.selectedFirstFrameUrl }
      : {}),
    ...(firstFrameStep?.selectedFirstFrameUrls ?? {}),
    ...selectedFirstFrames,
  }
  const templateSelectionComplete =
    templateDirections.length > 0 &&
    templateDirections.every((direction) => Boolean(templateSelections[direction]))
  const firstFrameSelectionComplete = allDirectionsSelected(
    firstFrameCandidates,
    firstFrameSelections,
  )
  const requestedOutfitId = searchParams.get('outfitId')
  const canAddAction =
    addActionIntent &&
    !workflowHasActiveNode &&
    !isTemplateSelecting &&
    !isFirstFrameSelecting &&
    !publishing

  async function interrupt() {
    try {
      if (workflowConflictRef.current || !session) return
      setRun(await session.interrupt())
    } catch (cause) {
      reportWorkflowError(cause, '中断自动制作失败')
    }
  }

  async function copyWorkflowPrompt() {
    const prompt = workflowPrompt(revision)
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      if (!mountedRef.current) return
      setPromptCopied(true)
      if (promptCopyTimer.current) clearTimeout(promptCopyTimer.current)
      promptCopyTimer.current = setTimeout(() => {
        promptCopyTimer.current = null
        if (mountedRef.current) setPromptCopied(false)
      }, 1_600)
    } catch (cause) {
      reportWorkflowError(cause, '复制提示词失败，请稍后重试')
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
    if (workflowConflictRef.current || !templateSelectionComplete || confirmingCandidate) return
    setConfirmingCandidate(true)
    clearWorkflowError()
    try {
      if (!session) return
      const updated = await session.confirmCandidate(templateSelections, actionDescription)
      setRun(updated)
      setSelectedCandidates({})
      setActionDescription('')
    } catch (cause) {
      reportWorkflowError(cause, '确认选择失败')
    } finally {
      setConfirmingCandidate(false)
    }
  }

  async function confirmFirstFrame() {
    if (workflowConflictRef.current || !firstFrameSelectionComplete || confirmingFirstFrame) return
    setConfirmingFirstFrame(true)
    clearWorkflowError()
    try {
      if (!session) return
      const updated = await session.confirmFirstFrame(firstFrameSelections)
      setRun(updated)
      setSelectedFirstFrames({})
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

  async function retryFailedDirection(item: QuickStartFailedDirection) {
    const targetSession = session
    if (!targetSession || workflowConflictRef.current) return
    const key = `${item.nodeId}:${item.direction}`
    setRetryingDirection(key)
    clearWorkflowError()
    try {
      const updated = await targetSession.retryGenerationDirection(item.nodeId, item.direction)
      if (!mountedRef.current || activeSessionRef.current !== targetSession) return
      setRun(updated)
    } catch (cause) {
      if (!mountedRef.current || activeSessionRef.current !== targetSession) return
      reportWorkflowError(cause, `重试${DIRECTION_LABELS[item.direction]}方向失败`)
    } finally {
      if (mountedRef.current && activeSessionRef.current === targetSession) {
        setRetryingDirection(null)
      }
    }
  }

  function DirectionRetryButtons({ nodeId }: { nodeId: string }) {
    const items = failedDirections.filter((item) => item.nodeId === nodeId)
    if (items.length === 0) return null
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const key = `${item.nodeId}:${item.direction}`
          return (
            <button
              key={key}
              type="button"
              onClick={() => void retryFailedDirection(item)}
              disabled={retryingDirection !== null || workflowConflict}
              className="rounded-lg border border-current px-3 py-1.5 text-xs font-bold text-app-danger disabled:opacity-50"
            >
              {retryingDirection === key
                ? `正在重试${DIRECTION_LABELS[item.direction]}方向…`
                : `重试${DIRECTION_LABELS[item.direction]}方向`}
            </button>
          )
        })}
      </div>
    )
  }

  async function continueConversation(event: FormEvent<HTMLFormElement>) {
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
    const message = actionDescription.trim()
    if (addActionIntent) {
      if (!canAddAction || !message || !session || addingAction) return
      setAddingAction(true)
      clearWorkflowError()
      try {
        let outfitId = requestedOutfitId
        if (!outfitId) {
          const info = session.getCharacterInfo() ?? (await session.resolveCharacterInfo())
          outfitId = info?.outfitId ?? null
        }
        if (!outfitId) throw new Error('没有找到要追加动作的角色造型')
        const updated = await session.addAction(outfitId, message)
        if (!mountedRef.current || activeSessionRef.current !== session) return
        setRun(updated)
        setActionDescription('')
      } catch (cause) {
        if (!mountedRef.current || activeSessionRef.current !== session) return
        reportWorkflowError(cause, '新增动作失败，请稍后重试')
      } finally {
        if (mountedRef.current && activeSessionRef.current === session) setAddingAction(false)
      }
      return
    }
    if (!message || workflowIsActive || workflowAgentSession.busy) return
    clearWorkflowError()
    appendRunConversationTurn({ role: 'user', content: message, scope: 'workflow' })
    setActionDescription('')
    try {
      const result = await workflowAgentSession.submit(message)
      appendRunConversationTurn({
        role: 'assistant',
        content: result.message,
        kind: 'reply',
        scope: 'workflow',
      })
    } catch (cause) {
      reportWorkflowError(cause, 'Agent 修改失败，请稍后重试')
    }
  }

  const composerPlaceholder = isTemplateSelecting
    ? templateSelectionComplete
      ? '描述这个角色接下来要做的动作…'
      : '请先为每个方向选择一个角色方案…'
    : isFirstFrameSelecting
      ? firstFrameSelectionComplete
        ? '按发送确认这张首帧…'
        : '请先为每个方向选择一个动作首帧…'
      : addActionIntent
        ? addingAction || workflowHasActiveNode
          ? '正在生成新动作…'
          : '描述要新增的动作…'
        : workflowHasFailure(run)
          ? '这次未完成，可以新建一次创作…'
          : canPublish
            ? '确认保存后，还可以继续描述修改…'
            : '制作中，完成后可以继续修改…'

  const workflowAgentAvailable =
    !workflowIsActive &&
    session !== null &&
    session.getWorkflowAgentContext().availableTools.length > 0
  const workflowAgentMode = !isTemplateSelecting && !isFirstFrameSelecting && !addActionIntent
  const composerCanSubmit =
    (isTemplateSelecting &&
      templateSelectionComplete &&
      (!isDirectionSetSelecting || Boolean(actionDescription.trim()))) ||
    (isFirstFrameSelecting && firstFrameSelectionComplete) ||
    (canAddAction && Boolean(actionDescription.trim()) && !addingAction) ||
    (workflowAgentMode && workflowAgentAvailable && Boolean(actionDescription.trim()))
  const workflowComposerDisabled = addActionIntent
    ? !canAddAction || addingAction || workflowConflict
    : workflowAgentMode &&
      (workflowIsActive || !workflowAgentAvailable || workflowAgentSession.busy || workflowConflict)
  const selectedTemplateUrl = templateStep?.selectedImageUrl
  const selectedFirstFrameUrl = firstFrameStep?.selectedFirstFrameUrl
  const requestedAction = firstFrameStep?.input.prompt || firstFrameStep?.input.name
  const characterTurnIsCurrent = !firstFrameStep
  const firstFrameTurnIsCurrent = Boolean(firstFrameStep) && actionStep?.status === 'locked'
  const actionTurnIsCurrent = Boolean(actionStep && actionStep.status !== 'locked')
  const characterExportModel = exportModel?.stage === 'character' ? exportModel : null
  const firstFrameExportModel = exportModel?.stage === 'first-frame' ? exportModel : null
  const actionExportModel =
    exportModel?.stage === 'action-assets' || exportModel?.stage === 'playtest' ? exportModel : null
  const entryAgentConversationTurns = agentConversationTurns.filter(
    (turn) => turn.scope !== 'workflow',
  )
  const workflowAgentConversationTurns = agentConversationTurns.filter(
    (turn) => turn.scope === 'workflow',
  )

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
            {entryAgentConversationTurns.map((turn, index) => (
              <div
                key={`${turn.role}:${index}:${turn.content}`}
                data-conversation-kind="agent"
                className="min-w-0"
              >
                {turn.role === 'user' ? (
                  <UserTurn>{turn.content}</UserTurn>
                ) : (
                  <AgentCopy lines={turn.content.split('\n')} animate={false} />
                )}
              </div>
            ))}

            <div data-conversation-kind="workflow" className="min-w-0">
              <UserTurn>{workflowPrompt(run) || '未命名角色创作'}</UserTurn>
            </div>

            <AgentTurn step="character-template" current={characterTurnIsCurrent}>
              {isTemplateSelecting && templateStep?.selectedImageUrl ? (
                <>
                  <AgentCopy
                    lines={[
                      templateSelectionComplete
                        ? `已生成 ${templateDirections.length} 个方向的首帧集合。`
                        : '正在根据已确认母版生成方向首帧集合。',
                      templateSelectionComplete
                        ? '描述角色接下来的动作，发送后开始动作生成。'
                        : '全部方向会保持同一个角色造型。',
                    ]}
                  />
                  <DirectionFirstFrameStack
                    directions={templateDirections}
                    selections={templateSelections}
                  />
                </>
              ) : isTemplateSelecting && candidates.length ? (
                <>
                  <AgentCopy
                    lines={[
                      candidateGroups.length > 1
                        ? `已生成 ${candidateGroups.length} 个方向的角色方案。`
                        : `已生成 ${candidates.length} 个角色方案。`,
                      isTemplateSelecting
                        ? candidateGroups.length > 1
                          ? '为每个方向选择一个方案，再描述它接下来的动作。'
                          : '选择一个方案，再描述它接下来的动作。'
                        : '角色方案已确认。',
                    ]}
                  />
                  <DirectionCandidatePicker
                    candidates={candidates}
                    selections={templateSelections}
                    disabled={!isTemplateSelecting || confirmingCandidate || workflowConflict}
                    kind="角色方案"
                    onSelect={(direction, imageUrl) =>
                      setSelectedCandidates((current) => ({ ...current, [direction]: imageUrl }))
                    }
                  />
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
                  {templateStep ? <DirectionRetryButtons nodeId={templateStep.id} /> : null}
                </>
              ) : (
                <>
                  <GenerationProgressCopy label="角色生成进度" kind="character-template" />
                  <div
                    data-layout="agent-result-set"
                    className="grid w-full max-w-2xl grid-cols-3 gap-3"
                  >
                    <GenerationCanvas label="角色图生成画布" />
                  </div>
                </>
              )}
              {workflowPrompt(revision) ? (
                <AgentActions
                  copyLabel={promptCopied ? '已复制提示词' : '复制提示词'}
                  onCopy={() => void copyWorkflowPrompt()}
                  exportModel={characterExportModel}
                  onNewCreation={() => navigate('/quick-start')}
                  onRegenerate={
                    candidates.length || isTemplateFailed ? () => void regenerate() : undefined
                  }
                  regenerateDisabled={workflowConflict}
                  showNewCreation={characterTurnIsCurrent}
                />
              ) : null}
            </AgentTurn>

            {firstFrameStep ? (
              <>
                <UserTurn>{requestedAction || '待机'}</UserTurn>
                <AgentTurn step="action-first-frame" current={firstFrameTurnIsCurrent}>
                  {isFirstFrameSelecting && firstFrameCandidates.length ? (
                    <>
                      <AgentCopy
                        lines={[
                          isFirstFrameSelecting
                            ? firstFrameCandidateGroups.length > 1
                              ? `已生成 ${firstFrameCandidateGroups.length} 个方向的动作起始姿态。`
                              : `已生成 ${firstFrameCandidates.length} 个动作起始姿态。`
                            : '动作首帧',
                          isFirstFrameSelecting
                            ? firstFrameCandidateGroups.length > 1
                              ? '为每个方向选择一个起始姿态，随后生成完整动作。'
                              : '选择一个起始姿态，随后生成完整动作。'
                            : '动作起始姿态已确认。',
                        ]}
                      />
                      <DirectionCandidatePicker
                        candidates={firstFrameCandidates}
                        selections={firstFrameSelections}
                        disabled={
                          !isFirstFrameSelecting || confirmingFirstFrame || workflowConflict
                        }
                        kind="动作首帧"
                        onSelect={(direction, imageUrl) =>
                          setSelectedFirstFrames((current) => ({
                            ...current,
                            [direction]: imageUrl,
                          }))
                        }
                      />
                      {firstFrameSelectionComplete ? (
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
                      <DirectionRetryButtons nodeId={firstFrameStep.id} />
                    </>
                  ) : (
                    <>
                      <GenerationProgressCopy label="动作首帧生成进度" kind="action-first-frame" />
                      <div
                        data-layout="agent-result-set"
                        className="grid w-full max-w-2xl grid-cols-3 gap-3"
                      >
                        <GenerationCanvas label="动作首帧生成画布" />
                      </div>
                    </>
                  )}
                  {isFirstFrameFailed || firstFrameExportModel ? (
                    <AgentActions
                      exportModel={firstFrameExportModel}
                      onNewCreation={() => navigate('/quick-start')}
                      showNewCreation={firstFrameTurnIsCurrent}
                    />
                  ) : null}
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
                        <FrameAnimationPlayer
                          frames={actionFrames}
                          alt="完整动作预览"
                          fps={firstFrameStep?.input.fps}
                          loop
                          loading="eager"
                          decoding="async"
                          fetchPriority="high"
                          className="quick-start-generated-image aspect-square w-full rounded-2xl border border-app-line bg-app-surface-muted object-contain [image-rendering:pixelated]"
                        />
                      </div>
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
                      <DirectionRetryButtons nodeId={actionStep.id} />
                    </>
                  ) : (
                    <>
                      <GenerationProgressCopy label="完整动作生成进度" kind="action-full-frame" />
                      <div
                        data-layout="agent-result-set"
                        className="grid w-full max-w-2xl grid-cols-3 gap-3"
                      >
                        <GenerationCanvas label="完整动作生成画布" />
                      </div>
                    </>
                  )}
                  {isActionFailed || actionExportModel || reviewStep?.status === 'passed' ? (
                    <AgentActions
                      exportModel={actionExportModel}
                      onOpenAssetWorkspace={
                        reviewStep?.status === 'passed'
                          ? () =>
                              navigate(`/projects/${encodeURIComponent(revision.projectId)}/assets`)
                          : undefined
                      }
                      onOpenPlaytest={
                        reviewStep?.status === 'passed' ? () => void openPlaytest() : undefined
                      }
                      playtestDisabled={workflowConflict}
                      onNewCreation={() => navigate('/quick-start')}
                      showNewCreation={actionTurnIsCurrent}
                    />
                  ) : null}
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
            {workflowAgentConversationTurns.map((turn, index) => (
              <div
                key={`${turn.role}:workflow:${index}:${turn.content}`}
                data-conversation-kind="agent"
                className="min-w-0"
              >
                {turn.role === 'user' ? (
                  <UserTurn>{turn.content}</UserTurn>
                ) : (
                  <AgentCopy lines={turn.content.split('\n')} />
                )}
              </div>
            ))}
            {workflowAgentSession.state.status === 'planning' ? (
              <div
                data-conversation-kind="agent"
                role="status"
                aria-label="Agent 正在思考"
                className="quick-start-agent-loading min-w-0"
              >
                <span aria-hidden="true" className="quick-start-agent-loading-dots">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="quick-start-agent-loading-dot"
                      style={{ '--agent-loading-index': dot } as CSSProperties}
                    />
                  ))}
                </span>
              </div>
            ) : null}
            <div data-testid="quick-start-transcript-end" />
          </div>
        </main>

        <footer
          data-testid="quick-start-composer"
          data-position="floating"
          className="absolute right-5 bottom-4 left-5 z-10 mx-auto w-auto max-w-3xl sm:right-8 sm:bottom-4 sm:left-8"
        >
          <form
            onSubmit={continueConversation}
            className="grid grid-cols-[1fr_auto] items-center gap-1.5 rounded-[18px] border border-app-line-strong bg-app-surface-raised/96 p-1.5 shadow-app-panel backdrop-blur-xl transition focus-within:border-app-accent"
          >
            <label htmlFor="quick-start-continuation" className="min-w-0">
              <span className="sr-only">继续描述你的想法</span>
              <input
                id="quick-start-continuation"
                aria-label="继续描述你的想法"
                value={actionDescription}
                onChange={(event) => setActionDescription(event.target.value)}
                disabled={workflowComposerDisabled}
                placeholder={composerPlaceholder}
                className="h-10 w-full min-w-0 border-0 bg-transparent px-3 text-[15px] text-app-ink outline-none placeholder:text-app-faint"
              />
            </label>
            <IconActionButton
              type={composerCanInterrupt ? 'button' : 'submit'}
              label={
                composerCanInterrupt
                  ? '中断自动制作'
                  : isTemplateSelecting
                    ? isDirectionSetSelecting
                      ? '生成动作'
                      : '确认母版'
                    : '发送'
              }
              onClick={composerCanInterrupt ? () => void interrupt() : undefined}
              disabled={
                composerCanInterrupt
                  ? workflowConflict
                  : !composerCanSubmit ||
                    workflowConflict ||
                    (workflowAgentMode && workflowAgentSession.busy)
              }
              accent
              className="!rounded-full active:scale-[0.98] disabled:opacity-35"
            >
              {composerCanInterrupt ? (
                <Stop aria-hidden="true" size={18} weight="bold" />
              ) : (
                <ArrowUp aria-hidden="true" size={18} weight="bold" />
              )}
            </IconActionButton>
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
