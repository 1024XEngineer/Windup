/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Character } from "@/entities/character";

import type { FrameGeometryResult } from "./analysis/sequence-evidence";
import { PlaytestWorkbench } from "./index";

const readImageGeometry = vi.hoisted(() => vi.fn());

vi.mock("./analysis/image-geometry", () => ({ readImageGeometry }));

const character = {
  id: "character-1",
  projectId: "project-1",
  name: "Aster",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
  outfits: [
    {
      id: "outfit-1",
      characterId: "character-1",
      name: "Explorer",
      candidateCharacterTemplates: [],
      characterTemplateUrl: "https://cdn.example.test/aster.png",
      baseFrames: [{ direction: "south", imageUrl: "https://cdn.example.test/base.png" }],
      actions: [
        {
          id: "walk",
          outfitId: "outfit-1",
          name: "Walk",
          source: "action_template",
          type: "walk",
          status: "confirmed",
          fps: 8,
          sequences: [
            {
              direction: "south",
              keyFrameIndex: 0,
              frames: [
                {
                  imageUrl: "https://cdn.example.test/walk-01.png",
                  durationMs: 125,
                  rootMotion: { dx: 2, dy: 1 },
                  qc: "passed",
                  rejected: false,
                },
              ],
            },
            {
              direction: "north",
              keyFrameIndex: 1,
              frames: [
                {
                  imageUrl: "https://cdn.example.test/walk-north-01.png",
                  durationMs: 100,
                  rootMotion: null,
                  qc: "passed",
                  rejected: false,
                },
                {
                  imageUrl: "https://cdn.example.test/walk-north-02.png",
                  durationMs: 100,
                  rootMotion: { dx: 0, dy: 2 },
                  qc: "pending",
                  rejected: false,
                },
              ],
            },
          ],
        },
        {
          id: "jump",
          outfitId: "outfit-1",
          name: "Jump",
          source: "action_template",
          type: "jump",
          status: "confirmed",
          fps: 8,
          sequences: [
            {
              direction: "south",
              keyFrameIndex: 0,
              frames: [
                {
                  imageUrl: "https://cdn.example.test/jump-01.png",
                  durationMs: 125,
                  rootMotion: { dx: 0, dy: 3 },
                  qc: "passed",
                  rejected: false,
                },
              ],
            },
          ],
        },
        {
          id: "crouch",
          outfitId: "outfit-1",
          name: "Crouch",
          source: "action_template",
          type: "crouch",
          status: "confirmed",
          fps: 8,
          sequences: [
            {
              direction: "south",
              keyFrameIndex: 0,
              frames: [
                {
                  imageUrl: "https://cdn.example.test/crouch-01.png",
                  durationMs: 125,
                  rootMotion: null,
                  qc: "passed",
                  rejected: false,
                },
                {
                  imageUrl: "https://cdn.example.test/crouch-02.png",
                  durationMs: 125,
                  rootMotion: null,
                  qc: "passed",
                  rejected: false,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as unknown as Character;

function measuredGeometry(imageUrl: string): FrameGeometryResult {
  const second = imageUrl.includes("north-02");
  return {
    status: "ready",
    geometry: {
      width: 256,
      height: 256,
      bounds: { left: 80, top: 30, right: 175, bottom: 236, width: 96, height: 207 },
      centroid: { x: second ? 3 : 0, y: second ? 14 : 10 },
      footY: 236,
      subjectHeight: 207,
      opaquePixels: 12_000,
      coverageRatio: 12_000 / (256 * 256),
    },
  };
}

beforeEach(() => {
  readImageGeometry.mockReset();
  readImageGeometry.mockImplementation(async (imageUrl: string) => measuredGeometry(imageUrl));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlaytestWorkbench", () => {
  it("renders the unified read-only workbench regions without production mutation controls", () => {
    // Catches a return to a mode switch that hides any part of the single review workbench.
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);

    expect(screen.getByRole("main", { name: "Playtest" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Playtest 模式" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "动作列表" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "动画预览舞台" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "播放控制" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "逐帧时间线" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "资产检查器" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "自动审核依据" })).toBeTruthy();
    expect(screen.getByText("未提交后端")).toBeTruthy();
    expect(screen.queryByText("重新生成")).toBeNull();
    expect(screen.queryByText("通过此帧")).toBeNull();
    expect(screen.queryByText("修改动作")).toBeNull();
    expect(screen.queryByText("导出门禁")).toBeNull();
  });

  it("collapses the action sidebar to give the stage more horizontal space", () => {
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);

    const navigation = screen.getByRole("navigation", { name: "动作列表" });
    const layout = navigation.parentElement;
    expect(layout?.className).toContain("190px");
    expect(within(navigation).getByRole("complementary", { name: "动作列表" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起动作栏" }));

    expect(layout?.className).toContain("48px");
    expect(within(navigation).queryByRole("complementary", { name: "动作列表" })).toBeNull();
    expect(screen.getByRole("button", { name: "展开动作栏" })).toBeTruthy();
  });

  it("keeps the action list, stage workbench and tool rail aligned to one shared bottom edge", () => {
    // Catches the tall inspector extending the grid while the left and middle columns end in blank space.
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);

    const navigation = screen.getByRole("navigation", { name: "动作列表" });
    const layout = navigation.parentElement;
    const stageWorkbench = screen.getByRole("region", { name: "调试工作台" });
    const toolRail = screen.getByRole("complementary", { name: "Playtest 工具栏" });

    expect(layout?.className).toContain("xl:h-[calc(100vh-128px)]");
    expect(navigation.className).toContain("h-full");
    expect(stageWorkbench.className).toContain("h-full");
    expect(toolRail.className).toContain("h-full");
    expect(within(toolRail).getByRole("tabpanel", { name: "帧检查" }).className).toContain(
      "overflow-y-auto",
    );
  });

  it("renders only the current actor image without neighbouring frame ghosts", () => {
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);

    const stage = screen.getByRole("region", { name: "动画预览舞台" });
    expect(within(stage).getAllByRole("img")).toHaveLength(1);
    expect(within(stage).getByRole("img", { name: "角色动画预览" })).toBeTruthy();
  });

  it("shows measured drift, expected root increment and composed motion for the selected frame", async () => {
    // Catches the Workbench computing evidence but failing to connect the selected frame to the Inspector.
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "north" }));

    await waitFor(() => expect(screen.getByText("自动审核依据")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "第 2 帧" }));

    const evidence = screen.getByRole("region", { name: "自动审核依据" });
    expect(within(evidence).getByText("x +3.0 px，y +4.0 px，距离 5.0 px")).toBeTruthy();
    expect(within(evidence).getByText("x +0.0 px，y +2.0 px，距离 2.0 px")).toBeTruthy();
    expect(within(evidence).getByText("x +3.0 px，y -2.0 px，距离 3.6 px")).toBeTruthy();

    const inspector = screen.getByRole("complementary", { name: "资产检查器" });
    expect(within(inspector).getByText("预期根位移")).toBeTruthy();
    expect(within(inspector).getByText("画面内额外漂移")).toBeTruthy();
  });

  it("keeps review controls usable when image evidence is unavailable", async () => {
    // Catches a CORS analysis failure disabling playback or masquerading as a QC failure.
    readImageGeometry.mockResolvedValue({
      status: "unavailable",
      reason: "图片跨域，无法计算像素",
    });
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
    await waitFor(() => expect(screen.getByText("无法计算：图片跨域，无法计算像素")).toBeTruthy());
    expect((screen.getByRole("button", { name: "播放" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByText("QC")).toBeTruthy();
  });

  it("keeps a missing-outfit error inside the named Playtest landmark", () => {
    // Catches the failure branch escaping the page's main landmark and becoming hard to navigate to.
    render(<PlaytestWorkbench character={character} outfitId="missing" inspectionMode="demo" />);

    const main = screen.getByRole("main", { name: "Playtest" });
    expect(within(main).getByText("找不到指定造型，无法构造只读预览。")).toBeTruthy();
  });

  it("records demo acceptance locally and announces the current playback state", () => {
    // Catches demo acceptance escaping the workbench and an inaccessible playback-state change.
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
    expect(screen.getByText("Walk，第 1/1 帧，已暂停")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(screen.getByText("Walk，第 1/1 帧，播放中")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "核验通过" }));
    expect(screen.getByText("本地核验：通过")).toBeTruthy();
    expect(screen.getByText("未提交后端")).toBeTruthy();
  });

  it("switches directions through the controller and resets playback-dependent views", () => {
    // Catches direction controls that only repaint a label without pausing and resetting the real playback state.
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "north" }));
    fireEvent.click(screen.getByRole("button", { name: "第 2 帧" }));
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(screen.getByText("Walk，第 2/2 帧，播放中")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "south" }));

    const inspector = screen.getByRole("complementary", { name: "资产检查器" });
    expect(within(inspector).getByText("south")).toBeTruthy();
    expect(within(inspector).getByText("1 / 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "第 2 帧" })).toBeNull();
    expect(screen.getByText("Walk，第 1/1 帧，已暂停")).toBeTruthy();
  });

  it("routes workbench keyboard shortcuts into playback and announces the result politely", () => {
    // Catches the composed Workbench omitting the real keyboard hook or leaving its state changes unannounced.
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "north" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toBe("Walk，第 2/2 帧，已暂停");

    fireEvent.keyDown(window, { key: " " });
    expect(liveRegion?.textContent).toBe("Walk，第 2/2 帧，播放中");
  });

  it("does not announce every automatically timed frame", () => {
    // Catches 100ms playback ticks flooding the polite live region while visual playback continues.
    vi.useFakeTimers();
    try {
      render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
      fireEvent.click(screen.getByRole("button", { name: "north" }));
      fireEvent.click(screen.getByRole("button", { name: "播放" }));

      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion?.textContent).toBe("Walk，第 1/2 帧，播放中");

      act(() => vi.advanceTimersByTime(100));

      expect(screen.getByRole("button", { name: "第 2 帧" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(liveRegion?.textContent).toBe("Walk，第 1/2 帧，播放中");
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("plays Walk frames only while paused A/D is held", () => {
    // Catches A/D sliding one static image instead of driving the shared Walk frame controller.
    vi.useFakeTimers();
    try {
      render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
      fireEvent.click(screen.getByRole("button", { name: "north" }));
      fireEvent.keyDown(window, { key: "d" });

      const actor = screen.getByAltText("角色动画预览");
      expect(actor.style.transform).toContain("scaleX(1)");
      expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();

      act(() => vi.advanceTimersByTime(100));
      expect(screen.getByRole("button", { name: "第 2 帧" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(actor.getAttribute("src")).toBe("https://cdn.example.test/walk-north-02.png");

      fireEvent.keyUp(window, { key: "d" });
      expect(screen.getByRole("button", { name: "播放" })).toBeTruthy();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("plays frames with A/D after the user pauses through the focused playback button", () => {
    // Reproduces the browser path where clicking Pause leaves keyboard focus on that button.
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);

    const playButton = screen.getByRole("button", { name: "播放" });
    fireEvent.click(playButton);
    const pauseButton = screen.getByRole("button", { name: "暂停" });
    pauseButton.focus();
    fireEvent.click(pauseButton);

    const focusedPlayButton = screen.getByRole("button", { name: "播放" });
    focusedPlayButton.focus();
    fireEvent.keyDown(focusedPlayButton, { key: "d" });

    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    fireEvent.keyUp(focusedPlayButton, { key: "d" });
    expect(screen.getByRole("button", { name: "播放" })).toBeTruthy();
  });

  it("announces D facing once without letting key repeat replace its start frame", () => {
    // Catches a repeated D keydown moving the live-region snapshot to each automatically advanced frame.
    vi.useFakeTimers();
    try {
      render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
      fireEvent.click(screen.getByRole("button", { name: "north" }));
      fireEvent.click(screen.getByRole("button", { name: "播放" }));
      fireEvent.keyDown(window, { key: "d" });

      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion?.textContent).toBe("Walk，第 1/2 帧，播放中，面向右");

      act(() => vi.advanceTimersByTime(100));

      expect(screen.getByRole("button", { name: "第 2 帧" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      fireEvent.keyDown(window, { key: "d", repeat: true });
      expect(liveRegion?.textContent).toBe("Walk，第 1/2 帧，播放中，面向右");

      fireEvent.keyDown(window, { key: "a", repeat: true });
      expect(liveRegion?.textContent).toBe("Walk，第 1/2 帧，播放中，面向左");
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("does not rebuild the preview model for playback-only state changes", () => {
    // Catches frame navigation re-running the Character-to-preview conversion on every render.
    const observedOutfit = { ...character.outfits[0] };
    const actions = observedOutfit.actions;
    let actionsReadCount = 0;
    Object.defineProperty(observedOutfit, "actions", {
      configurable: true,
      get: () => {
        actionsReadCount += 1;
        return actions;
      },
    });
    const observedCharacter: Character = { ...character, outfits: [observedOutfit] };

    render(
      <PlaytestWorkbench character={observedCharacter} outfitId="outfit-1" inspectionMode="demo" />,
    );
    const readsAfterInitialModel = actionsReadCount;

    fireEvent.click(screen.getByRole("button", { name: "north" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(actionsReadCount).toBe(readsAfterInitialModel);
  });

  it("uses D to continue Walk playback from a non-walk action in the unified controller", async () => {
    // Catches D remaining frame navigation instead of continuing the shared controller with Walk.
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
    fireEvent.keyDown(window, { key: "w" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Jump/ }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );

    fireEvent.keyDown(window, { key: "d" });
    expect(screen.getByRole("button", { name: /^Walk/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    expect(
      within(screen.getByRole("complementary", { name: "资产检查器" })).getByText("Walk"),
    ).toBeTruthy();
  });

  it("keeps the playing Walk frame and accumulated offset when A flips its stage facing", () => {
    // Catches a direction change recreating the controller state and resetting its current frame.
    vi.useFakeTimers();
    try {
      render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);
      fireEvent.click(screen.getByRole("button", { name: "north" }));
      fireEvent.click(screen.getByRole("button", { name: "播放" }));
      act(() => vi.advanceTimersByTime(100));

      expect(screen.getByAltText("角色动画预览").style.transform).toContain("translate(0px, -2px)");
      fireEvent.keyDown(window, { key: "a" });
      expect(screen.getByAltText("角色动画预览").style.transform).toContain("scaleX(-1)");
      fireEvent.keyDown(window, { key: "a", repeat: true });

      expect(screen.getByRole("button", { name: /^Walk/ }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(screen.getByRole("button", { name: "第 2 帧" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
      expect(screen.getByAltText("角色动画预览").style.transform).toContain("translate(0px, -2px)");
      expect(screen.getByAltText("角色动画预览").style.transform).toContain("scaleX(-1)");
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("keeps the current action when Walk data are unavailable", () => {
    // Catches A/D selecting an unrelated fallback action when no playable Walk exists.
    const withoutWalk: Character = {
      ...character,
      outfits: [{ ...character.outfits[0], actions: [character.outfits[0].actions[1]] }],
    };
    render(<PlaytestWorkbench character={withoutWalk} outfitId="outfit-1" inspectionMode="demo" />);
    const liveRegion = document.querySelector('[aria-live="polite"]');
    const announcementBefore = liveRegion?.textContent;
    const transformBefore = screen.getByAltText("角色动画预览").style.transform;

    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "d" });

    expect(screen.getByRole("button", { name: /^Jump/ }).getAttribute("aria-pressed")).toBeTruthy();
    expect(liveRegion?.textContent).toBe(announcementBefore);
    expect(screen.getByAltText("角色动画预览").style.transform).toBe(transformBefore);
  });

  it("keeps the current action when jump and crouch data are unavailable", () => {
    // Catches unavailable typed shortcuts resetting playback to an unrelated default action.
    const withoutJumpAndCrouch: Character = {
      ...character,
      outfits: [{ ...character.outfits[0], actions: [character.outfits[0].actions[0]] }],
    };
    render(
      <PlaytestWorkbench
        character={withoutJumpAndCrouch}
        outfitId="outfit-1"
        inspectionMode="demo"
      />,
    );

    fireEvent.keyDown(window, { key: "w" });
    fireEvent.keyDown(window, { key: "s" });

    expect(screen.getByRole("button", { name: /^Walk/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("forwards persisted inspection conclusions without modifying the character", () => {
    // Catches a persisted outcome being swallowed locally instead of being handed to the supplied inspection boundary.
    const onRecordStatus = vi.fn();

    render(
      <PlaytestWorkbench
        character={character}
        outfitId="outfit-1"
        inspectionMode="persisted"
        inspectionStatus="passed"
        onRecordStatus={onRecordStatus}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发现问题" }));
    expect(onRecordStatus).toHaveBeenCalledWith("issues_found");
  });

  it("switches one right-side panel without changing playback selection and keeps manual issues in session", () => {
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["帧检查", "问题记录", "资产导出"]);
    const selectedAction = screen.getByRole("button", { name: /^Walk/ });
    const selectedFrame = screen.getByRole("button", { name: "第 1 帧" });
    const retainedExportPanel = screen.getByRole("region", { name: "资产导出", hidden: true });

    fireEvent.click(screen.getByRole("tab", { name: "问题记录" }));
    expect(screen.getByRole("region", { name: "问题记录" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "标记当前帧问题" }));
    expect(screen.getByText("人工")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "帧检查" }));
    expect(screen.getByRole("complementary", { name: "资产检查器" })).toBeTruthy();
    expect(selectedAction.getAttribute("aria-pressed")).toBe("true");
    expect(selectedFrame.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "问题记录" }));
    expect(screen.getByText("人工")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "资产导出" }));
    expect(screen.getByRole("button", { name: "导出游戏资产包" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "资产导出" })).toBe(retainedExportPanel);
    expect(selectedAction.getAttribute("aria-pressed")).toBe("true");
    expect(selectedFrame.getAttribute("aria-pressed")).toBe("true");
  });

  it("links tabs to retained panels and supports arrow-key navigation", () => {
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" inspectionMode="demo" />);

    const inspectTab = screen.getByRole("tab", { name: "帧检查" });
    const auditTab = screen.getByRole("tab", { name: "问题记录" });
    expect(inspectTab.getAttribute("aria-controls")).toBe("playtest-tool-panel-inspect");
    expect(inspectTab.tabIndex).toBe(0);
    expect(auditTab.tabIndex).toBe(-1);

    fireEvent.keyDown(inspectTab, { key: "ArrowRight" });

    expect(auditTab.getAttribute("aria-selected")).toBe("true");
    expect(auditTab.tabIndex).toBe(0);
    expect(document.activeElement).toBe(auditTab);
    const panel = screen.getByRole("tabpanel", { name: "问题记录" });
    expect(panel.id).toBe("playtest-tool-panel-audit");
    expect(panel.getAttribute("aria-labelledby")).toBe("playtest-tool-tab-audit");
  });

  it("exposes persisted saving and failure states to assistive technology", () => {
    // Catches an in-flight or failed inspection save being conveyed only through button styling and visual color.
    render(
      <PlaytestWorkbench
        character={character}
        outfitId="outfit-1"
        inspectionMode="persisted"
        saving
        saveError="网络连接失败"
      />,
    );

    const acceptance = screen.getByRole("region", { name: "核验状态" });
    expect(acceptance.getAttribute("aria-busy")).toBe("true");
    expect(within(acceptance).getByRole("status").textContent).toContain("正在保存");
    const alert = within(acceptance).getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toContain("网络连接失败");
  });
});
