import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams } from 'react-router'

import type { ActionType, PublishActionResult, WorkflowRun } from '@/entities'
import type { WorkflowController, WorkflowControllerSnapshot } from '@/features/workflow-controller'
import './workflow-editor.css'

export interface WorkflowEditorPageProps {
  /**
   * 页面唯一的业务入口。App 装配尚未完成时可以省略，页面会明确显示不可用，
   * 而不是创建假 Controller 或伪造生成结果。
   */
  controller?: WorkflowController
  /** 创建角色 Run 或动作 Run 后通知路由层；默认更新到该 Run 的恢复地址。 */
  onRunCreated?(runId: WorkflowRun['id']): void
  /** 审核通过后交付稳定资产 ID；默认打开对应 Playtest 动作。 */
  onOpenPlaytest?(result: PublishActionResult): void
}

interface ActionDraft {
  type: ActionType
  name: string
  prompt: string
  fps: number
}

const ACTION_OPTIONS: readonly { type: ActionType; label: string; name: string }[] = [
  { type: 'idle', label: '待机动作', name: '待机' },
  { type: 'walk', label: '行走动作', name: '行走' },
  { type: 'jump', label: '跳跃动作', name: '跳跃' },
  { type: 'attack', label: '攻击动作', name: '攻击' },
  { type: 'custom', label: '自定义动作', name: '' },
]

/**
 * 手动工作流编辑器。
 *
 * 组件只保留输入框、当前选中候选和临时图片 URL。WorkflowRun、步骤状态、
 * Generation ID 与正式资产 ID 均由 Controller/Entity 维护，刷新时统一 resume。
 */
export function WorkflowEditorPage({
  controller,
  onRunCreated,
  onOpenPlaytest,
}: WorkflowEditorPageProps) {
  const { runId } = useParams()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<WorkflowControllerSnapshot | null>(null)
  const [loading, setLoading] = useState(Boolean(controller && runId))
  const [resumeAttempt, setResumeAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projectId, setProjectId] = useState('')
  const [characterPrompt, setCharacterPrompt] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionDraft, setActionDraft] = useState<ActionDraft | null>(null)

  const openRun = useMemo(
    () => onRunCreated ?? ((id: string) => navigate(`/workflow-editor/${encodeURIComponent(id)}`)),
    [navigate, onRunCreated],
  )
  const openPlaytest = useMemo(
    () =>
      onOpenPlaytest ??
      ((result: PublishActionResult) => {
        const path = `/playtest/${encodeURIComponent(result.characterId)}/${encodeURIComponent(result.outfitId)}`
        navigate(`${path}?actionId=${encodeURIComponent(result.actionId)}`)
      }),
    [navigate, onOpenPlaytest],
  )

  useEffect(() => {
    if (!controller || !runId) {
      setLoading(false)
      if (!runId) setSnapshot(null)
      return
    }

    let active = true
    setLoading(true)
    setError(null)
    setSelectedCandidate(null)
    setActionDraft(null)

    // 页面不读取 Store，也不根据步骤名自行恢复。Controller 返回可直接渲染的 phase。
    void controller.resume(runId).then(
      (restored) => {
        if (!active) return
        setSnapshot(restored)
        setLoading(false)
        if (!restored) setError('没有找到这条工作流任务')
      },
      (cause: unknown) => {
        if (!active) return
        setError(errorMessage(cause, '工作流恢复失败'))
        setLoading(false)
      },
    )

    const unsubscribe = controller.subscribe(runId, (run) => {
      if (active) setSnapshot((current) => replaceSnapshotRun(current, run))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [controller, resumeAttempt, runId])

  if (!controller) {
    return (
      <EditorShell>
        <EmptyState title="工作流服务尚未装配">
          当前页面不会使用假数据。请由应用装配 WorkflowController 后再开始任务。
        </EmptyState>
      </EditorShell>
    )
  }
  const activeController = controller

  async function perform(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(errorMessage(cause, '操作失败，请重试'))
    } finally {
      setBusy(false)
    }
  }

  function startCharacter(event: FormEvent) {
    event.preventDefault()
    const normalizedProjectId = projectId.trim()
    const prompt = characterPrompt.trim()
    if (!normalizedProjectId || !prompt) {
      setError('请填写项目 ID 和角色描述')
      return
    }
    void perform(async () => {
      const batch = await activeController.startCharacter({
        projectId: normalizedProjectId,
        prompt,
        driver: 'manual',
      })
      setSnapshot({ phase: 'character-candidates', ...batch })
      setSelectedCandidate(null)
      openRun(batch.run.id)
    })
  }

  function confirmCharacter() {
    if (!selectedCandidate || snapshot?.phase !== 'character-candidates') return
    void perform(async () => {
      const run = await activeController.confirmCharacter({
        runId: snapshot.run.id,
        selectedImageUrl: selectedCandidate,
      })
      setSnapshot({ phase: 'terminal', run })
      setSelectedCandidate(null)
    })
  }

  function chooseAction(type: ActionType) {
    const option = ACTION_OPTIONS.find((item) => item.type === type)
    if (!option) return
    setActionDraft({ type, name: option.name, prompt: '', fps: 8 })
    setMenuOpen(false)
  }

  function startAction(event: FormEvent) {
    event.preventDefault()
    if (!actionDraft || snapshot?.phase !== 'terminal') return
    const source = snapshot.run
    if (
      source.purpose !== 'create_character' ||
      source.status !== 'completed' ||
      !source.characterId ||
      !source.outfitId
    ) {
      setError('角色尚未保存，不能创建动作')
      return
    }
    const actionName = actionDraft.name.trim()
    if (!actionName) {
      setError('请填写动作名称')
      return
    }
    void perform(async () => {
      const batch = await activeController.startAction({
        projectId: source.projectId,
        characterId: source.characterId,
        outfitId: source.outfitId,
        actionName,
        actionType: actionDraft.type,
        prompt: actionDraft.prompt.trim() || null,
        fps: actionDraft.fps,
        driver: 'manual',
      })
      setSnapshot({ phase: 'action-first-frame-candidates', ...batch })
      setSelectedCandidate(null)
      setActionDraft(null)
      openRun(batch.run.id)
    })
  }

  function confirmFirstFrame() {
    if (!selectedCandidate || snapshot?.phase !== 'action-first-frame-candidates') return
    void perform(async () => {
      const review = await activeController.confirmActionFirstFrame({
        runId: snapshot.run.id,
        selectedImageUrl: selectedCandidate,
      })
      setSnapshot({ phase: 'action-review', ...review })
      setSelectedCandidate(null)
    })
  }

  function approveAction() {
    if (snapshot?.phase !== 'action-review') return
    void perform(async () => {
      const result = await activeController.approveAction(snapshot.run.id)
      setSnapshot({ phase: 'terminal', run: result.run })
      openPlaytest(result)
    })
  }

  return (
    <EditorShell run={snapshot?.run ?? null}>
      {error ? (
        <div className="workflow-editor__error" role="alert">
          <span>{error}</span>
          {runId && !loading ? (
            <button type="button" onClick={() => setResumeAttempt((current) => current + 1)}>
              重新恢复
            </button>
          ) : null}
        </div>
      ) : null}
      {loading ? <EmptyState title="正在恢复任务">读取当前候选与审核阶段。</EmptyState> : null}
      {!loading && !runId && !snapshot ? (
        <CharacterSetupCard
          projectId={projectId}
          prompt={characterPrompt}
          busy={busy}
          onProjectIdChange={setProjectId}
          onPromptChange={setCharacterPrompt}
          onSubmit={startCharacter}
        />
      ) : null}
      {!loading && snapshot ? (
        <WorkflowLane>
          {renderSnapshot(snapshot, {
            busy,
            selectedCandidate,
            menuOpen,
            actionDraft,
            onSelectCandidate: setSelectedCandidate,
            onConfirmCharacter: confirmCharacter,
            onToggleMenu: () => setMenuOpen((current) => !current),
            onChooseAction: chooseAction,
            onActionDraftChange: setActionDraft,
            onStartAction: startAction,
            onConfirmFirstFrame: confirmFirstFrame,
            onApproveAction: approveAction,
          })}
        </WorkflowLane>
      ) : null}
    </EditorShell>
  )
}

interface RenderSnapshotOptions {
  busy: boolean
  selectedCandidate: string | null
  menuOpen: boolean
  actionDraft: ActionDraft | null
  onSelectCandidate(url: string): void
  onConfirmCharacter(): void
  onToggleMenu(): void
  onChooseAction(type: ActionType): void
  onActionDraftChange(draft: ActionDraft): void
  onStartAction(event: FormEvent): void
  onConfirmFirstFrame(): void
  onApproveAction(): void
}

/** phase 到卡片的映射只决定显示内容，不推进 WorkflowRun。 */
function renderSnapshot(snapshot: WorkflowControllerSnapshot, options: RenderSnapshotOptions) {
  if (snapshot.phase === 'character-setup') {
    return <NoticeCard title="角色设定待提交">请从新任务入口补充角色描述。</NoticeCard>
  }
  if (snapshot.phase === 'character-candidates') {
    return (
      <>
        <CompletedCard title="角色起点" detail={snapshot.run.prompt ?? '角色描述'} />
        <CandidateCard
          title="角色候选"
          candidates={snapshot.candidates}
          selected={options.selectedCandidate}
          labelPrefix="角色候选"
          confirmLabel="确认角色形象"
          busy={options.busy}
          onSelect={options.onSelectCandidate}
          onConfirm={options.onConfirmCharacter}
        />
      </>
    )
  }
  if (snapshot.phase === 'action-setup') {
    return <NoticeCard title="动作设定待提交">请从角色母版的加号重新选择动作。</NoticeCard>
  }
  if (snapshot.phase === 'action-first-frame-candidates') {
    return (
      <>
        <CompletedCard title="角色母版" detail={`角色 ${snapshot.run.characterId}`} />
        <CompletedCard
          title="动作设定"
          detail={snapshot.run.purpose === 'add_action' ? snapshot.run.actionName : '动作'}
        />
        <CandidateCard
          title="动作首帧"
          candidates={snapshot.candidates}
          selected={options.selectedCandidate}
          labelPrefix="动作首帧"
          confirmLabel="确认首帧并生成完整动画"
          busy={options.busy}
          onSelect={options.onSelectCandidate}
          onConfirm={options.onConfirmFirstFrame}
        />
      </>
    )
  }
  if (snapshot.phase === 'action-review') {
    return (
      <>
        <CompletedCard title="角色母版" detail={`角色 ${snapshot.run.characterId}`} />
        <CompletedCard title="动作首帧" detail={snapshot.run.actionName} />
        <ReviewCard
          frames={snapshot.frames}
          busy={options.busy}
          onApprove={options.onApproveAction}
        />
      </>
    )
  }

  const run = snapshot.run
  if (isCompletedCharacter(run)) {
    return (
      <>
        <CompletedCard title="角色起点" detail={run.prompt ?? '角色描述'} />
        <WorkflowCard id="character-master" eyebrow="已保存" title="角色母版">
          <p>角色 {run.characterId}</p>
          <p className="workflow-card__muted">造型 {run.outfitId}</p>
          <button
            type="button"
            className="workflow-card__plus"
            aria-label="添加后续节点"
            title="添加后续节点"
            onClick={options.onToggleMenu}
          >
            +
          </button>
          {options.menuOpen ? (
            <div className="workflow-card__menu" role="menu" aria-label="合法下游">
              {ACTION_OPTIONS.map((action) => (
                <button
                  type="button"
                  role="menuitem"
                  key={action.type}
                  onClick={() => options.onChooseAction(action.type)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </WorkflowCard>
        {options.actionDraft ? (
          <ActionSetupCard
            draft={options.actionDraft}
            busy={options.busy}
            onChange={options.onActionDraftChange}
            onSubmit={options.onStartAction}
          />
        ) : null}
      </>
    )
  }
  if (run.purpose === 'add_action' && run.status === 'completed') {
    return <CompletedCard title="动作已发布" detail={`${run.actionName} · ${run.actionId}`} />
  }
  return (
    <NoticeCard title={run.status === 'failed' ? '任务执行失败' : '任务已暂停'}>
      任务快照仍由 WorkflowRun 保存，可从历史记录或当前地址继续。
    </NoticeCard>
  )
}

function CharacterSetupCard({
  projectId,
  prompt,
  busy,
  onProjectIdChange,
  onPromptChange,
  onSubmit,
}: {
  projectId: string
  prompt: string
  busy: boolean
  onProjectIdChange(value: string): void
  onPromptChange(value: string): void
  onSubmit(event: FormEvent): void
}) {
  return (
    <WorkflowLane>
      <WorkflowCard id="character-setup" eyebrow="起点" title="角色起点">
        <form className="workflow-card__form" onSubmit={onSubmit}>
          <label>
            <span>项目 ID</span>
            <input
              value={projectId}
              onChange={(event) => onProjectIdChange(event.target.value)}
              placeholder="例如 project-7"
            />
          </label>
          <label>
            <span>角色描述</span>
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder="描述外观、服装与整体气质"
              rows={4}
            />
          </label>
          <button type="submit" className="workflow-card__primary" disabled={busy}>
            {busy ? '正在生成' : '生成角色候选'}
          </button>
        </form>
      </WorkflowCard>
    </WorkflowLane>
  )
}

function ActionSetupCard({
  draft,
  busy,
  onChange,
  onSubmit,
}: {
  draft: ActionDraft
  busy: boolean
  onChange(draft: ActionDraft): void
  onSubmit(event: FormEvent): void
}) {
  return (
    <WorkflowCard id="action-setup" eyebrow="待提交" title="动作设定">
      <form className="workflow-card__form" onSubmit={onSubmit}>
        <label>
          <span>动作名称</span>
          <input
            value={draft.name}
            disabled={draft.type !== 'custom'}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          <span>动作描述</span>
          <textarea
            value={draft.prompt}
            onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
            placeholder="描述姿态、速度和身体重心"
            rows={3}
          />
        </label>
        <label>
          <span>FPS</span>
          <input
            type="number"
            min="1"
            max="60"
            value={draft.fps}
            onChange={(event) => onChange({ ...draft, fps: Number(event.target.value) || 8 })}
          />
        </label>
        <button type="submit" className="workflow-card__primary" disabled={busy}>
          {busy ? '正在生成' : '生成动作首帧'}
        </button>
      </form>
    </WorkflowCard>
  )
}

function CandidateCard({
  title,
  candidates,
  selected,
  labelPrefix,
  confirmLabel,
  busy,
  onSelect,
  onConfirm,
}: {
  title: string
  candidates: readonly string[]
  selected: string | null
  labelPrefix: string
  confirmLabel: string
  busy: boolean
  onSelect(url: string): void
  onConfirm(): void
}) {
  return (
    <WorkflowCard id={`${labelPrefix}-candidates`} eyebrow="四选一" title={title} wide>
      <div className="workflow-card__candidates">
        {candidates.map((url, index) => (
          <button
            type="button"
            key={url}
            aria-label={`选择${labelPrefix} ${index + 1}`}
            aria-pressed={selected === url}
            className={selected === url ? 'is-selected' : ''}
            onClick={() => onSelect(url)}
          >
            <img src={url} alt={`${labelPrefix} ${index + 1}`} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="workflow-card__primary"
        disabled={!selected || busy}
        onClick={onConfirm}
      >
        {busy ? '正在处理' : confirmLabel}
      </button>
    </WorkflowCard>
  )
}

function ReviewCard({
  frames,
  busy,
  onApprove,
}: {
  frames: readonly { imageUrl: string }[]
  busy: boolean
  onApprove(): void
}) {
  return (
    <WorkflowCard id="action-review" eyebrow="等待决定" title="动画审核" wide>
      <div className="workflow-card__frames">
        {frames.map((frame, index) => (
          <img
            key={`${frame.imageUrl}-${index}`}
            src={frame.imageUrl}
            alt={`动画帧 ${index + 1}`}
          />
        ))}
      </div>
      <button type="button" className="workflow-card__primary" disabled={busy} onClick={onApprove}>
        {busy ? '正在保存' : '审核通过并打开 Playtest'}
      </button>
    </WorkflowCard>
  )
}

function EditorShell({ children, run = null }: { children: ReactNode; run?: WorkflowRun | null }) {
  return (
    <main className="workflow-editor">
      <header className="workflow-editor__header">
        <div>
          <p className="workflow-editor__eyebrow">手动创作</p>
          <h1>工作流编辑器</h1>
        </div>
        <div className="workflow-editor__constraints" aria-label="当前工作流约束">
          <span>单角色</span>
          <span>单造型</span>
          <span>{run ? `项目 ${run.projectId}` : '等待项目'}</span>
        </div>
      </header>
      <section className="workflow-editor__canvas" aria-label="工作流画布">
        {children}
      </section>
    </main>
  )
}

function WorkflowLane({ children }: { children: ReactNode }) {
  return <div className="workflow-editor__lane">{children}</div>
}

function WorkflowCard({
  id,
  eyebrow,
  title,
  wide = false,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  wide?: boolean
  children: ReactNode
}) {
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  function beginDrag(event: DragEvent<HTMLElement>) {
    dragOrigin.current = { x: event.clientX - offset.x, y: event.clientY - offset.y }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  function finishDrag(event: DragEvent<HTMLElement>) {
    if (!dragOrigin.current) return
    setOffset({ x: event.clientX - dragOrigin.current.x, y: event.clientY - dragOrigin.current.y })
    dragOrigin.current = null
  }

  return (
    <article
      className={`workflow-card${wide ? ' workflow-card--wide' : ''}`}
      data-node-id={id}
      draggable
      onDragStart={beginDrag}
      onDragEnd={finishDrag}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div className="workflow-card__heading">
        <div>
          <p>{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <span className="workflow-card__drag" title="拖动卡片" aria-hidden="true">
          :::
        </span>
      </div>
      {children}
    </article>
  )
}

function CompletedCard({ title, detail }: { title: string; detail: string }) {
  return (
    <WorkflowCard id={`completed-${title}`} eyebrow="已完成" title={title}>
      <p>{detail}</p>
    </WorkflowCard>
  )
}

function NoticeCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <WorkflowCard id={`notice-${title}`} eyebrow="当前状态" title={title}>
      <p className="workflow-card__muted">{children}</p>
    </WorkflowCard>
  )
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="workflow-editor__empty">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  )
}

function isCompletedCharacter(
  run: WorkflowRun,
): run is Extract<WorkflowRun, { purpose: 'create_character'; characterId: string }> {
  return (
    run.purpose === 'create_character' && run.status === 'completed' && Boolean(run.characterId)
  )
}

function replaceSnapshotRun(
  snapshot: WorkflowControllerSnapshot | null,
  run: WorkflowRun,
): WorkflowControllerSnapshot | null {
  return snapshot ? ({ ...snapshot, run } as WorkflowControllerSnapshot) : null
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback
}
