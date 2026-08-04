import { useMemo, useReducer, useState, type KeyboardEvent } from 'react'

import type { Character } from '@/entities/character'
import type { PlaytestInspectionApis } from '@/entities/playtest-inspection'
import type { CanvasBaseline } from './analysis/quality-policy'

import { ActionSelector, type PlaytestAssetOption } from './action-selector'
import { Acceptance } from './acceptance'
import { useFrameReviewEvidence } from './analysis/use-frame-review-evidence'
import { AnimationStage } from './animation-stage'
import { AuditPanel } from './audit/audit-panel'
import { reduceAuditSession } from './audit/audit-session'
import { FrameTimeline } from './frame-timeline'
import { Inspector } from './inspector'
import { createPreviewModel } from './model/create-preview-model'
import type { PreviewAction } from './model/types'
import { PlaybackControls } from './playback-controls'
import { usePlaybackController } from './playback/use-playback-controller'
import { useStageMotion } from './stage-motion'
import { StatusPanel } from './status-panel'
import { usePlaytestKeyboard } from './use-playtest-keyboard'
import { usePlaytestInspection } from './use-playtest-inspection'

export interface PlaytestWorkbenchProps {
  character: Character
  outfitId: string
  assetOptions?: readonly PlaytestAssetOption[]
  expectedCanvas?: CanvasBaseline | null
  inspectionApis?: Pick<PlaytestInspectionApis, 'get' | 'save'>
  initialActionId?: string | null
  onSelectAsset?(asset: PlaytestAssetOption): void
}

export type { PlaytestAssetOption } from './action-selector'

const EMPTY_PREVIEW_ACTIONS: readonly PreviewAction[] = []
const RIGHT_PANELS = [
  ['inspect', '帧检查'],
  ['audit', '问题记录'],
] as const
type RightPanel = (typeof RIGHT_PANELS)[number][0]

export function PlaytestWorkbench({
  character,
  outfitId,
  assetOptions = [],
  expectedCanvas = null,
  inspectionApis,
  initialActionId = null,
  onSelectAsset = () => undefined,
}: PlaytestWorkbenchProps) {
  const [frameAvailable, setFrameAvailable] = useState(false)
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
  const reviewEvidence = useFrameReviewEvidence(
    playback.sequence,
    playback.action?.type ?? null,
    undefined,
    expectedCanvas,
  )
  const inspectionTarget = useMemo(
    () =>
      playback.action === null
        ? null
        : {
            characterId: character.id,
            outfitId,
            actionId: playback.action.id,
          },
    [character.id, outfitId, playback.action],
  )
  const inspection = usePlaytestInspection(inspectionApis, inspectionTarget)
  const [activeRightPanel, setActiveRightPanel] = useState<RightPanel>('inspect')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [manualIssues, dispatchAudit] = useReducer(reduceAuditSession, [])

  const frameCount = playback.sequence?.frames.length ?? 0
  const automaticFindings =
    reviewEvidence.status === 'ready' ? reviewEvidence.evidence.findings : []
  const automaticErrorCount = automaticFindings.filter(
    (finding) => finding.severity === 'error',
  ).length
  const qualityIssueCount = automaticErrorCount + manualIssues.length

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
      previousFrame: () => {
        if (isPlaying) togglePlaying()
        previousFrame()
      },
      nextFrame: () => {
        if (isPlaying) togglePlaying()
        nextFrame()
      },
      firstFrame,
      lastFrame,
      toggleLoop,
      playLeft: () => {
        if (isPlaying) togglePlaying()
        previousFrame()
      },
      playRight: () => {
        if (isPlaying) togglePlaying()
        nextFrame()
      },
      stopHorizontal: () => {
        // A/D 松开后无需恢复播放，用户通过空格控制播放
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
      toggleLoop,
      isPlaying,
      togglePlaying,
      jumpAvailable,
      crouchAvailable,
    ],
  )
  usePlaytestKeyboard(keyboardCommands, preview !== null)

  if (preview === null) {
    return (
      <main aria-label="Playtest">
        <StatusPanel title="无法打开 Playtest" tone="warning">
          找不到指定造型，无法构造只读预览。
        </StatusPanel>
      </main>
    )
  }

  const selectedAssetKey = `${character.id}:${outfitId}`
  const availableAssets =
    assetOptions.length > 0
      ? assetOptions
      : [
          {
            key: selectedAssetKey,
            characterId: character.id,
            outfitId,
            name: preview.outfitName,
            actionCount: preview.actions.length,
          },
        ]

  return (
    <main
      aria-label="Playtest"
      className="mx-auto min-h-[calc(100vh-5rem)] w-full max-w-[1920px] space-y-3 bg-[#eef0ed] px-3 pb-4 pt-2 text-[#202722] sm:px-5"
    >
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-[#d3d8d4] pb-3">
        <div className="min-w-0">
          <p className="font-mono text-[9px] font-semibold text-[#79817b]">PLAYTEST</p>
          <h1 className="mt-1 truncate text-lg font-semibold">
            {preview.characterName} · {preview.outfitName}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden text-[10px] text-[#727a74] sm:block">
            只读预览，不写入角色、动作或帧
          </p>
          <button
            type="button"
            aria-label={toolsOpen ? '关闭检查工具' : '打开检查工具'}
            aria-expanded={toolsOpen}
            aria-controls="playtest-tools"
            onClick={() => setToolsOpen((open) => !open)}
            className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors ${
              toolsOpen
                ? 'border-[#35583f] bg-[#35583f] text-white'
                : 'border-[#aeb7b0] bg-white text-[#35583f] hover:border-[#718278]'
            }`}
          >
            检查
            {qualityIssueCount > 0 ? (
              <span className="min-w-5 rounded bg-[#f7e2de] px-1 py-0.5 text-[9px] text-[#8d352d]">
                {qualityIssueCount}
              </span>
            ) : null}
          </button>
        </div>
      </header>
      <div
        className={`grid items-stretch gap-3 lg:min-h-[680px] lg:grid-cols-[208px_minmax(0,1fr)] ${
          toolsOpen ? 'xl:grid-cols-[208px_minmax(0,1fr)_320px]' : ''
        }`}
      >
        <nav
          aria-label="动作列表"
          className="min-h-0 min-w-0 overflow-hidden rounded-lg lg:h-[calc(100vh-9.5rem)] lg:min-h-[680px] lg:max-h-[900px]"
        >
          <ActionSelector
            assets={availableAssets}
            selectedAssetKey={selectedAssetKey}
            actions={preview.actions}
            selectedActionId={playback.state.actionId}
            onSelectAsset={onSelectAsset}
            onSelectAction={playback.selectAction}
          />
        </nav>
        <section aria-label="预览工作台" className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="relative min-h-[360px] flex-1 lg:min-h-[480px]">
            <AnimationStage
              currentFrame={playback.frame}
              motionOffset={stageMotion.offset}
              mirrored={stageMotion.mirrored}
              onHorizontalBoundsChange={stageMotion.setBounds}
              onFrameAvailabilityChange={setFrameAvailable}
              showGrid
              showChecker
            />
            <div
              role="group"
              aria-label="方向选择"
              className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-md border border-[#aeb7b0] bg-white/90 p-1 backdrop-blur-sm"
            >
              <button
                type="button"
                aria-label="翻转方向"
                aria-pressed={stageMotion.mirrored}
                onClick={() => setMirrored(!stageMotion.mirrored)}
                className={`grid h-8 w-8 place-items-center rounded text-base transition-colors ${
                  stageMotion.mirrored
                    ? 'bg-[#35583f] text-white'
                    : 'text-[#59635b] hover:bg-[#e7ebe7]'
                }`}
                title="翻转水平方向 (F)"
              >
                ⇄
              </button>
              {playback.action?.sequences.map((sequence) => (
                <button
                  key={sequence.direction}
                  type="button"
                  aria-pressed={sequence.direction === playback.state.direction}
                  disabled={sequence.frames.length === 0}
                  onClick={() => playback.selectDirection(sequence.direction)}
                  className={`min-h-8 rounded px-2 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    sequence.direction === playback.state.direction
                      ? 'bg-[#252a27] text-white'
                      : 'text-[#59635b] hover:bg-[#e7ebe7]'
                  }`}
                >
                  {sequence.direction}
                </button>
              ))}
            </div>
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
        {toolsOpen ? (
          <aside
            id="playtest-tools"
            aria-label="Playtest 工具栏"
            className="flex min-h-0 flex-col gap-3 rounded-lg border border-[#cdd4ce] bg-[#f8f9f7] p-2 lg:col-span-2 xl:col-span-1 xl:h-[calc(100vh-9.5rem)] xl:min-h-[680px] xl:max-h-[900px]"
          >
            <header className="flex min-h-9 items-center justify-between border-b border-[#d9ded9] px-1 pb-2">
              <strong className="text-xs">检查工具</strong>
              <button
                type="button"
                aria-label="关闭检查工具"
                onClick={() => setToolsOpen(false)}
                className="grid h-8 w-8 place-items-center rounded text-lg text-[#687069] hover:bg-[#e8ece8]"
              >
                ×
              </button>
            </header>
            <div
              role="tablist"
              aria-label="Playtest 工具"
              className="grid grid-cols-2 gap-1 rounded-md bg-[#e7ebe7] p-1"
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
                  className={`rounded px-2 py-2 text-[10px] font-semibold ${
                    activeRightPanel === value
                      ? 'bg-white text-[#26372c] shadow-sm'
                      : 'text-[#667068] hover:text-[#26372c]'
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
              className="min-h-0 flex-1 overflow-y-auto"
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
              className="min-h-0 flex-1 overflow-y-auto"
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
            <Acceptance
              inspectionStatus={inspection.status}
              available={inspection.available}
              canPass={frameAvailable}
              loading={inspection.loading}
              saving={inspection.saving}
              error={inspection.error}
              onRecordStatus={inspection.save}
            />
          </aside>
        ) : null}
      </div>
    </main>
  )
}
