import { useCallback, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";

import type { Character } from "@/entities/character";
import type { PlaytestInspectionStatus } from "@/entities/playtest-inspection";

import { ActionSelector } from "./action-selector";
import { Acceptance } from "./acceptance";
import { useFrameReviewEvidence } from "./analysis/use-frame-review-evidence";
import { AnimationStage } from "./animation-stage";
import { AuditPanel } from "./audit/audit-panel";
import { reduceAuditSession } from "./audit/audit-session";
import { FrameTimeline } from "./frame-timeline";
import { ExportPanel } from "./export/export-panel";
import { Inspector } from "./inspector";
import { createPreviewModel } from "./model/create-preview-model";
import type { PreviewAction } from "./model/types";
import { PlaybackControls } from "./playback-controls";
import { usePlaybackController } from "./playback/use-playback-controller";
import { useStageMotion } from "./stage-motion";
import { StatusPanel } from "./status-panel";
import { usePlaytestKeyboard } from "./use-playtest-keyboard";

export interface PlaytestWorkbenchProps {
  character: Character;
  outfitId: string;
  initialActionId?: string | null;
  source?: { runId: string; revisionId: string } | null;
  inspectionStatus?: PlaytestInspectionStatus | null;
  inspectionMode: "demo" | "persisted";
  saving?: boolean;
  saveError?: string | null;
  onRecordStatus?(status: PlaytestInspectionStatus): void;
}

const EMPTY_PREVIEW_ACTIONS: readonly PreviewAction[] = [];
const RIGHT_PANELS = [
  ["inspect", "帧检查"],
  ["audit", "问题记录"],
  ["export", "资产导出"],
] as const;
type RightPanel = (typeof RIGHT_PANELS)[number][0];

export function PlaytestWorkbench({
  character,
  outfitId,
  initialActionId = null,
  source = null,
  inspectionStatus = null,
  inspectionMode,
  saving = false,
  saveError = null,
  onRecordStatus,
}: PlaytestWorkbenchProps) {
  const previewResult = useMemo(
    () => createPreviewModel(character, outfitId),
    [character, outfitId],
  );
  const preview = previewResult.ok ? previewResult.model : null;
  const playback = usePlaybackController(
    preview?.actions ?? EMPTY_PREVIEW_ACTIONS,
    initialActionId,
  );
  const stageMotion = useStageMotion({
    frame: playback.frame,
    playing: playback.state.playing,
    frameTick: playback.frameTick,
    resetKey: `${character.id}:${outfitId}`,
  });
  const walkAvailable =
    preview?.actions.some(
      (action) =>
        action.type === "walk" && action.sequences.some((sequence) => sequence.frames.length > 0),
    ) ?? false;
  const jumpAvailable =
    preview?.actions.some(
      (action) =>
        action.type === "jump" && action.sequences.some((sequence) => sequence.frames.length > 0),
    ) ?? false;
  const crouchAvailable =
    preview?.actions.some(
      (action) =>
        action.type === "crouch" && action.sequences.some((sequence) => sequence.frames.length > 0),
    ) ?? false;
  const reviewEvidence = useFrameReviewEvidence(playback.sequence, playback.action?.type ?? null);
  const [demoInspectionStatus, setDemoInspectionStatus] = useState<PlaytestInspectionStatus | null>(
    null,
  );
  const [playbackStartFrameIndex, setPlaybackStartFrameIndex] = useState<number | null>(null);
  const [announcedFacing, setAnnouncedFacing] = useState<"left" | "right" | null>(null);
  const [activeRightPanel, setActiveRightPanel] = useState<RightPanel>("inspect");
  const [actionSidebarCollapsed, setActionSidebarCollapsed] = useState(false);
  const [manualIssues, dispatchAudit] = useReducer(reduceAuditSession, []);
  const horizontalHoldStartedPaused = useRef<boolean | null>(null);

  const frameCount = playback.sequence?.frames.length ?? 0;
  const currentInspectionStatus =
    inspectionMode === "demo" ? demoInspectionStatus : inspectionStatus;
  const announcedFrameIndex =
    playback.state.playing && playbackStartFrameIndex !== null
      ? playbackStartFrameIndex
      : playback.state.frameIndex;
  const playbackAnnouncement = `${playback.action?.name ?? "未选择动作"}，第 ${
    frameCount === 0 ? 0 : announcedFrameIndex + 1
  }/${frameCount} 帧，${playback.state.playing ? "播放中" : "已暂停"}${
    announcedFacing === null ? "" : `，面向${announcedFacing === "left" ? "左" : "右"}`
  }`;
  const automaticFindings =
    reviewEvidence.status === "ready" ? reviewEvidence.evidence.findings : [];
  const qualityIssueCount = automaticFindings.length + manualIssues.length;

  const movePanelFocus = (event: KeyboardEvent<HTMLButtonElement>, current: RightPanel) => {
    const currentIndex = RIGHT_PANELS.findIndex(([value]) => value === current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % RIGHT_PANELS.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + RIGHT_PANELS.length) % RIGHT_PANELS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = RIGHT_PANELS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextPanel = RIGHT_PANELS[nextIndex]?.[0];
    if (nextPanel === undefined) return;
    setActiveRightPanel(nextPanel);
    document.getElementById(`playtest-tool-tab-${nextPanel}`)?.focus();
  };

  const togglePlaying = useCallback(() => {
    if (!playback.state.playing) setPlaybackStartFrameIndex(playback.state.frameIndex);
    playback.togglePlaying();
  }, [playback.state.frameIndex, playback.state.playing, playback.togglePlaying]);

  const keyboardCommands = useMemo(
    () => ({
      togglePlaying,
      previousFrame: playback.previousFrame,
      nextFrame: playback.nextFrame,
      firstFrame: playback.firstFrame,
      lastFrame: playback.lastFrame,
      toggleLoop: playback.toggleLoop,
      playLeft: () => {
        if (!walkAvailable) return;
        if (horizontalHoldStartedPaused.current === null) {
          horizontalHoldStartedPaused.current = !playback.state.playing;
        }
        stageMotion.setMirrored(true);
        setAnnouncedFacing("left");
        if (!playback.state.playing) setPlaybackStartFrameIndex(playback.state.frameIndex);
        if (playback.action?.type !== "walk") setPlaybackStartFrameIndex(0);
        playback.continueActionType("walk");
      },
      playRight: () => {
        if (!walkAvailable) return;
        if (horizontalHoldStartedPaused.current === null) {
          horizontalHoldStartedPaused.current = !playback.state.playing;
        }
        stageMotion.setMirrored(false);
        setAnnouncedFacing("right");
        if (!playback.state.playing) setPlaybackStartFrameIndex(playback.state.frameIndex);
        if (playback.action?.type !== "walk") setPlaybackStartFrameIndex(0);
        playback.continueActionType("walk");
      },
      stopHorizontal: () => {
        const shouldRestorePause = horizontalHoldStartedPaused.current === true;
        horizontalHoldStartedPaused.current = null;
        if (shouldRestorePause && playback.state.playing) playback.togglePlaying();
      },
      playJump: () => {
        if (!jumpAvailable) return;
        setPlaybackStartFrameIndex(0);
        playback.playActionType("jump");
      },
      playCrouch: () => {
        if (!crouchAvailable) return;
        setPlaybackStartFrameIndex(0);
        playback.playActionType("crouch");
      },
    }),
    [
      playback.firstFrame,
      playback.lastFrame,
      playback.nextFrame,
      playback.previousFrame,
      playback.playActionType,
      playback.continueActionType,
      playback.toggleLoop,
      playback.action?.type,
      playback.state.frameIndex,
      playback.state.playing,
      stageMotion.setMirrored,
      togglePlaying,
      walkAvailable,
      jumpAvailable,
      crouchAvailable,
    ],
  );
  usePlaytestKeyboard(keyboardCommands, preview !== null);

  const recordStatus = useCallback(
    (status: PlaytestInspectionStatus) => {
      if (inspectionMode === "demo") {
        setDemoInspectionStatus(status);
        return;
      }
      onRecordStatus?.(status);
    },
    [inspectionMode, onRecordStatus],
  );

  if (preview === null) {
    return (
      <main aria-label="Playtest">
        <StatusPanel title="无法打开 Playtest" tone="warning">
          找不到指定造型，无法构造只读预览。
        </StatusPanel>
      </main>
    );
  }

  return (
    <main aria-label="Playtest" className="mx-auto max-w-[1600px] space-y-4 p-4 text-slate-900">
      <span aria-live="polite" className="sr-only">
        {playbackAnnouncement}
      </span>
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
        className={`grid items-stretch gap-4 xl:h-[calc(100vh-128px)] xl:min-h-[720px] xl:max-h-[880px] ${
          actionSidebarCollapsed
            ? "xl:grid-cols-[48px_minmax(0,1fr)_300px]"
            : "xl:grid-cols-[190px_minmax(0,1fr)_300px]"
        }`}
      >
        <nav
          aria-label="动作列表"
          className={
            actionSidebarCollapsed ? "h-full min-h-0 w-12" : "flex h-full min-h-0 min-w-0 flex-col"
          }
        >
          <button
            type="button"
            aria-label={actionSidebarCollapsed ? "展开动作栏" : "收起动作栏"}
            aria-expanded={!actionSidebarCollapsed}
            aria-controls="playtest-action-list"
            onClick={() => setActionSidebarCollapsed((collapsed) => !collapsed)}
            className="mb-2 grid h-10 w-full shrink-0 place-items-center rounded-lg border border-slate-300 bg-white text-lg font-semibold text-slate-600 shadow-sm hover:border-slate-500"
          >
            {actionSidebarCollapsed ? "›" : "‹"}
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
                    ? "border-emerald-900 bg-emerald-950 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
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
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-50"
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
            hidden={activeRightPanel !== "inspect"}
            className="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <Inspector
              action={playback.action}
              sequence={playback.sequence}
              frame={playback.frame}
              frameIndex={playback.state.frameIndex}
              source={source}
              inspectionStatus={currentInspectionStatus}
              reviewEvidence={reviewEvidence}
            />
          </div>
          <div
            id="playtest-tool-panel-audit"
            role="tabpanel"
            aria-labelledby="playtest-tool-tab-audit"
            hidden={activeRightPanel !== "audit"}
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
              onAdd={(issue) => dispatchAudit({ type: "add", issue })}
              onUpdate={(id, category, note) =>
                dispatchAudit({ type: "update", id, category, note })
              }
              onRemove={(id) => dispatchAudit({ type: "remove", id })}
            />
          </div>
          <div
            id="playtest-tool-panel-export"
            role="tabpanel"
            aria-labelledby="playtest-tool-tab-export"
            hidden={activeRightPanel !== "export"}
            className="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <ExportPanel model={preview} qualityIssueCount={qualityIssueCount} />
          </div>
          <Acceptance
            inspectionMode={inspectionMode}
            inspectionStatus={currentInspectionStatus}
            saving={saving}
            saveError={saveError}
            onRecordStatus={recordStatus}
          />
        </aside>
      </div>
    </main>
  );
}
