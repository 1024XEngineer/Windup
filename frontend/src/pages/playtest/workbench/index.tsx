import { useCallback, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react'

import type { Character } from '@/entities/character'

import { ActionSelector } from './action-selector'
import { Acceptance, type PlaytestInspectionStatus } from './acceptance'
import { useFrameReviewEvidence } from './analysis/use-frame-review-evidence'
import { AnimationStage } from './animation-stage'
import { AuditPanel } from './audit/audit-panel'
import { reduceAuditSession } from './audit/audit-session'
import { FrameTimeline } from './frame-timeline'
import { ExportPanel } from './export/export-panel'
import { Inspector } from './inspector'
import { createPreviewModel } from './model/create-preview-model'
import type { PreviewAction } from './model/types'
import { PlaybackControls } from './playback-controls'
import { usePlaybackController } from './playback/use-playback-controller'
import { useStageMotion } from './stage-motion'
import { StatusPanel } from './status-panel'
import { usePlaytestKeyboard } from './use-playtest-keyboard'

export interface PlaytestWorkbenchProps {
  character: Character
  outfitId: string
  initialActionId?: string | null
}

const EMPTY_PREVIEW_ACTIONS: readonly PreviewAction[] = []
const RIGHT_PANELS = [
  ['inspect', '帧检查'],
  ['audit', '问题记录'],
  ['export', '资产导出'],
] as const
type RightPanel = (typeof RIGHT_PANELS)[number][0]

export function PlaytestWorkbench({
  character,
  outfitId,
  initialActionId = null,
}: PlaytestWorkbenchProps) {
  const previewResult = useMemo(
    () => createPreviewModel(character, outfitId),
    [character, outfitId],
  )
  const preview = previewResult.ok ? previewResult.model : null
  const playback = usePlaybackController(preview?.actions ?? EMPTY_PREVIEW_ACTIONS, initialActionId)
  const {
    firstFrame,
    lastFrame,
    nextFrame,
    previousFrame,
    playActionType,
    continueActionType,
    toggleLoop,
    togglePlaying,
  } = playback
  const isPlaying = playback.state.playing
  const stageMotion = useStageMotion({
    frame: playback.frame,
    playing: isPlaying,
    frameTick: playback.frameTick,
    resetKey: `${character.id}:${outfitId}`,
  })
  const { setMirrored } = stageMotion
  const jumpAvailable =
    preview?.actions.some(
      (action) =>
        action.type === 'jump' && action.sequences.some((sequence) => sequence.frames.length > 0),
    ) ?? false
  const crouchAvailable =
    preview?.actions.some(
      (action) =>
        action.type === 'crouch' && action.sequences.some((sequence) => sequence.frames.length > 0),
    ) ?? false
  const reviewEvidence = useFrameReviewEvidence(playback.sequence, playback.action?.type ?? null)
  const [demoInspectionStatus, setDemoInspectionStatus] = useState<PlaytestInspectionStatus | null>(
    null,
  )
  const [activeRightPanel, setActiveRightPanel] = useState<RightPanel>('inspect')
  const [actionSidebarCollapsed, setActionSidebarCollapsed] = useState(false)
  const [manualIssues, dispatchAudit] = useReducer(reduceAuditSession, [])
  const horizontalHoldStartedPaused = useRef<boolean | null>(null)

  const frameCount = playback.sequence?.frames.length ?? 0
  const automaticFindings =
    reviewEvidence.status === 'ready' ? reviewEvidence.evidence.findings : []
  const qualityIssueCount = automaticFindings.length + manualIssues.length

  const movePanelFocus = (event: KeyboardEvent<HTMLButtonElement>, current: RightPanel) => {
    const currentIndex = RIGHT_PANELS.findIndex(([value]) => value === current)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % RIGHT_PANELS.length
    else if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + RIGHT_PANELS.length) % RIGHT_PANELS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = RIGHT_PANELS.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextPanel = RIGHT_PANELS[nextIndex]?.[0]
    if (nextPanel === undefined) return
    setActiveRightPanel(nextPanel)
    document.getElementById(`playtest-tool-tab-${nextPanel}`)?.focus()
  }

  const keyboardCommands = useMemo(
    () => ({
      togglePlaying,
      previousFrame,
      nextFrame,
      firstFrame,
      lastFrame,
      toggleLoop,
      playLeft: () => {
        if (playback.action === null) return
        if (horizontalHoldStartedPaused.current === null) {
          horizontalHoldStartedPaused.current = !isPlaying
        }
        if (playback.action.type === 'walk') setMirrored(true)
        continueActionType(playback.action.type)
      },
      playRight: () => {
        if (playback.action === null) return
        if (horizontalHoldStartedPaused.current === null) {
          horizontalHoldStartedPaused.current = !isPlaying
        }
        if (playback.action.type === 'walk') setMirrored(false)
        continueActionType(playback.action.type)
      },
      stopHorizontal: () => {
        const shouldRestorePause = horizontalHoldStartedPaused.current === true
        horizontalHoldStartedPaused.current = null
        if (shouldRestorePause && isPlaying) togglePlaying()
      },
      playJump: () => {
        if (!jumpAvailable) return
        playActionType('jump')
      },
      playCrouch: () => {
        if (!crouchAvailable) return
        playActionType('crouch')
      },
    }),
    [
      firstFrame,
      lastFrame,
      nextFrame,
      previousFrame,
      playActionType,
      continueActionType,
      toggleLoop,
      isPlaying,
      setMirrored,
      togglePlaying,
      playback.action?.type,
      jumpAvailable,
      crouchAvailable,
    ],
  )
  usePlaytestKeyboard(keyboardCommands, preview !== null)

  const recordStatus = useCallback((status: PlaytestInspectionStatus) => {
    setDemoInspectionStatus(status)
  }, [])

  if (preview === null) {
    return (
      <main aria-label="Playtest">
        <StatusPanel title="无法打开 Playtest" tone="warning">
          找不到指定造型，无法构造只读预览。
        </StatusPanel>
      </main>
    )
  }

  return (
    <main
      aria-label="Playtest"
      className="mx-auto w-full max-w-[1920px] space-y-3 p-2 text-slate-900 sm:p-4"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">PLAYTEST</p>
          <h1 className="mt-1 text-xl font-semibold">
            {preview.characterName} · {preview.outfitName}
          </h1>
        </div>
        <p className="text-xs text-slate-500">只读预览，不写入角色、动作或帧</p>
      </header>
      <div
        className={`grid items-stretch gap-4 lg:h-[calc(100vh-112px)] lg:min-h-[720px] lg:max-h-[920px] ${
          actionSidebarCollapsed
            ? 'lg:grid-cols-[48px_minmax(0,1fr)_300px]'
            : 'lg:grid-cols-[190px_minmax(0,1fr)_300px]'
        }`}
      >
        <nav
          aria-label="动作列表"
          className={
            actionSidebarCollapsed ? 'h-full min-h-0 w-12' : 'flex h-full min-h-0 min-w-0 flex-col'
          }
        >
          <button
            type="button"
            aria-label={actionSidebarCollapsed ? '展开动作栏' : '收起动作栏'}
            aria-expanded={!actionSidebarCollapsed}
            aria-controls="playtest-action-list"
            onClick={() => setActionSidebarCollapsed((collapsed) => !collapsed)}
            className="mb-2 grid h-10 w-full shrink-0 place-items-center rounded-lg border border-slate-300 bg-white text-lg font-semibold text-slate-600 shadow-sm hover:border-slate-500"
          >
            {actionSidebarCollapsed ? '›' : '‹'}
          </button>
          <div id="playtest-action-list" hidden={actionSidebarCollapsed} className="min-h-0 flex-1">
            <ActionSelector
              actions={preview.actions}
              selectedActionId={playback.state.actionId}
              onSelectAction={playback.selectAction}
            />
          </div>
        </nav>
        <section
          aria-label="调试工作台"
          className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden"
        >
          <div
            role="group"
            aria-label="方向选择"
            className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <span className="mr-1 text-xs font-semibold text-slate-500">方向</span>
            {playback.action?.sequences.map((sequence) => (
              <button
                key={sequence.direction}
                type="button"
                aria-pressed={sequence.direction === playback.state.direction}
                disabled={sequence.frames.length === 0}
                onClick={() => playback.selectDirection(sequence.direction)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  sequence.direction === playback.state.direction
                    ? 'border-emerald-900 bg-emerald-950 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                }`}
              >
                {sequence.direction}
              </button>
            ))}
          </div>
          <div className="min-h-[320px] flex-1">
            <AnimationStage
              currentFrame={playback.frame}
              motionOffset={stageMotion.offset}
              mirrored={stageMotion.mirrored}
              onHorizontalBoundsChange={stageMotion.setBounds}
              showGrid
              showChecker
            />
          </div>
          <div role="group" aria-label="播放控制">
            <PlaybackControls
              playing={playback.state.playing}
              loop={playback.state.loop}
              frameIndex={playback.state.frameIndex}
              frameCount={frameCount}
              fps={playback.action?.fps ?? 0}
              jumpAvailable={jumpAvailable}
              crouchAvailable={crouchAvailable}
              onFirstFrame={playback.firstFrame}
              onPreviousFrame={playback.previousFrame}
              onTogglePlaying={togglePlaying}
              onNextFrame={playback.nextFrame}
              onLastFrame={playback.lastFrame}
              onToggleLoop={playback.toggleLoop}
            />
          </div>
          <FrameTimeline
            sequence={playback.sequence}
            currentFrameIndex={playback.state.frameIndex}
            onSelectFrame={playback.selectFrame}
          />
        </section>
        <aside
          aria-label="Playtest 工具栏"
          className="flex h-full min-h-0 flex-col gap-4 overflow-hidden"
        >
          <div
            role="tablist"
            aria-label="Playtest 工具"
            className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
          >
            {RIGHT_PANELS.map(([value, label]) => (
              <button
                key={value}
                id={`playtest-tool-tab-${value}`}
                type="button"
                role="tab"
                aria-selected={activeRightPanel === value}
                aria-controls={`playtest-tool-panel-${value}`}
                tabIndex={activeRightPanel === value ? 0 : -1}
                onClick={() => setActiveRightPanel(value)}
                onKeyDown={(event) => movePanelFocus(event, value)}
                className={`rounded-lg px-2 py-2 text-[11px] font-semibold ${
                  activeRightPanel === value
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            id="playtest-tool-panel-inspect"
            role="tabpanel"
            aria-labelledby="playtest-tool-tab-inspect"
            hidden={activeRightPanel !== 'inspect'}
            className="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <Inspector
              action={playback.action}
              sequence={playback.sequence}
              frame={playback.frame}
              frameIndex={playback.state.frameIndex}
              reviewEvidence={reviewEvidence}
            />
          </div>
          <div
            id="playtest-tool-panel-audit"
            role="tabpanel"
            aria-labelledby="playtest-tool-tab-audit"
            hidden={activeRightPanel !== 'audit'}
            className="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <AuditPanel
              actionId={playback.action?.id ?? null}
              actionName={playback.action?.name ?? null}
              direction={playback.sequence?.direction ?? null}
              frameIndex={playback.state.frameIndex}
              frame={playback.frame}
              automaticFindings={automaticFindings}
              issues={manualIssues}
              onAdd={(issue) => dispatchAudit({ type: 'add', issue })}
              onUpdate={(id, category, note) =>
                dispatchAudit({ type: 'update', id, category, note })
              }
              onRemove={(id) => dispatchAudit({ type: 'remove', id })}
            />
          </div>
          <div
            id="playtest-tool-panel-export"
            role="tabpanel"
            aria-labelledby="playtest-tool-tab-export"
            hidden={activeRightPanel !== 'export'}
            className="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <ExportPanel model={preview} qualityIssueCount={qualityIssueCount} />
          </div>
          <Acceptance inspectionStatus={demoInspectionStatus} onRecordStatus={recordStatus} />
        </aside>
      </div>
    </main>
  )
}
