// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Character } from "@/entities/character";
import type { PlaytestInspection } from "@/entities/playtest-inspection";

import { PlaytestPage, type PlaytestPageAPIs } from "./index";
import { PLAYTEST_DEMO_ACTION_ID, PLAYTEST_DEMO_CHARACTER } from "./testing/demo-character";

function createCharacter(characterId: string, outfitId: string, name: string): Character {
  return {
    ...PLAYTEST_DEMO_CHARACTER,
    id: characterId,
    name,
    outfits: PLAYTEST_DEMO_CHARACTER.outfits.map((outfit) => ({
      ...outfit,
      id: outfitId,
      characterId,
      actions: outfit.actions.map((action) => ({ ...action, outfitId })),
    })),
  };
}

const character = createCharacter("character-1", "outfit-1", "正式角色");

const inspection: PlaytestInspection = {
  id: "inspection-1",
  characterId: "character-1",
  outfitId: "outfit-1",
  source: { runId: "run-1", revisionId: "revision-1" },
  status: "passed",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
};

function NavigationProbe({ onReady }: { onReady(navigate: NavigateFunction): void }) {
  onReady(useNavigate());
  return null;
}

function renderPage(apis?: PlaytestPageAPIs, initialEntry = "/playtest/character-1/outfit-1") {
  let navigate: NavigateFunction | null = null;
  const rendered = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <NavigationProbe onReady={(value) => (navigate = value)} />
      <Routes>
        <Route path="/playtest/:characterId/:outfitId" element={<PlaytestPage apis={apis} />} />
      </Routes>
    </MemoryRouter>,
  );

  return {
    ...rendered,
    navigate(to: string) {
      if (navigate === null) throw new Error("navigation was not initialized");
      act(() => navigate?.(to));
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(cleanup);

describe("PlaytestPage", () => {
  it("states that the backend APIs are not configured instead of rendering the demo", () => {
    renderPage();

    expect(screen.getByText("Playtest 后端接口尚未配置")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: /少年 · Playtest 演示角色 · 默认造型/ }),
    ).toBeNull();
  });

  it("reads only the requested character and its latest inspection", async () => {
    const apis: PlaytestPageAPIs = {
      characters: { get: vi.fn().mockResolvedValue(character) },
      inspections: {
        getLatest: vi.fn().mockResolvedValue(inspection),
        record: vi.fn(),
      },
    };

    renderPage(apis);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /正式角色 · 默认造型/ })).toBeTruthy(),
    );
    expect(apis.characters.get).toHaveBeenCalledExactlyOnceWith("character-1");
    expect(apis.inspections.getLatest).toHaveBeenCalledExactlyOnceWith({
      characterId: "character-1",
      outfitId: "outfit-1",
    });
    expect(screen.getByText("run-1 / revision-1")).toBeTruthy();
  });

  it.each([{ code: 404 }, { status: 404 }])(
    "reports a missing character for a recognizable 404 error: %o",
    async (notFoundError) => {
      const apis: PlaytestPageAPIs = {
        characters: { get: vi.fn().mockRejectedValue(notFoundError) },
        inspections: {
          getLatest: vi.fn(),
          record: vi.fn(),
        },
      };

      renderPage(apis);

      expect(await screen.findByText("角色不存在")).toBeTruthy();
      expect(apis.inspections.getLatest).not.toHaveBeenCalled();
    },
  );

  it("reports a character read failure for other character errors", async () => {
    const apis: PlaytestPageAPIs = {
      characters: { get: vi.fn().mockRejectedValue(new Error("network unavailable")) },
      inspections: {
        getLatest: vi.fn(),
        record: vi.fn(),
      },
    };

    renderPage(apis);

    expect(await screen.findByText("角色读取失败")).toBeTruthy();
    expect(apis.inspections.getLatest).not.toHaveBeenCalled();
  });

  it("reports an inspection read failure after the character was loaded", async () => {
    const apis: PlaytestPageAPIs = {
      characters: { get: vi.fn().mockResolvedValue(character) },
      inspections: {
        getLatest: vi.fn().mockRejectedValue(new Error("inspection unavailable")),
        record: vi.fn(),
      },
    };

    renderPage(apis);

    expect(await screen.findByText("核验记录读取失败")).toBeTruthy();
    expect(apis.characters.get).toHaveBeenCalledExactlyOnceWith("character-1");
    expect(apis.inspections.getLatest).toHaveBeenCalledExactlyOnceWith({
      characterId: "character-1",
      outfitId: "outfit-1",
    });
    expect(screen.queryByText("角色读取失败")).toBeNull();
  });

  it("synchronizes the initial action when only the actionId query changes", async () => {
    const apis: PlaytestPageAPIs = {
      characters: { get: vi.fn().mockResolvedValue(character) },
      inspections: {
        getLatest: vi.fn().mockResolvedValue(null),
        record: vi.fn(),
      },
    };
    const walkActionId = "playtest-demo-boy-walk";
    const mounted = renderPage(apis, `/playtest/character-1/outfit-1?actionId=${walkActionId}`);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /行走/ }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    mounted.navigate(`/playtest/character-1/outfit-1?actionId=${PLAYTEST_DEMO_ACTION_ID}`);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /待机/ }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(apis.characters.get).toHaveBeenCalledTimes(1);
    expect(apis.inspections.getLatest).toHaveBeenCalledTimes(1);
  });

  it("records a persisted conclusion through the inspection API only", async () => {
    const apis: PlaytestPageAPIs = {
      characters: { get: vi.fn().mockResolvedValue(character) },
      inspections: {
        getLatest: vi.fn().mockResolvedValue(null),
        record: vi.fn().mockResolvedValue({ ...inspection, status: "passed" }),
      },
    };

    renderPage(apis);
    const recordButton = await screen.findByRole("button", { name: "核验通过" });
    fireEvent.click(recordButton);

    await waitFor(() =>
      expect(apis.inspections.record).toHaveBeenCalledExactlyOnceWith({
        characterId: "character-1",
        outfitId: "outfit-1",
        status: "passed",
      }),
    );
    expect(apis.characters.get).toHaveBeenCalledExactlyOnceWith("character-1");
  });

  it("ignores an old record success after navigating to another asset", async () => {
    const oldRecord = deferred<PlaytestInspection>();
    const character2 = createCharacter("character-2", "outfit-2", "第二个正式角色");
    const apis: PlaytestPageAPIs = {
      characters: {
        get: vi.fn((characterId: string) =>
          Promise.resolve(characterId === "character-1" ? character : character2),
        ),
      },
      inspections: {
        getLatest: vi.fn().mockResolvedValue(null),
        record: vi.fn(() => oldRecord.promise),
      },
    };
    const mounted = renderPage(apis);
    fireEvent.click(await screen.findByRole("button", { name: "核验通过" }));
    mounted.navigate("/playtest/character-2/outfit-2");
    await screen.findByRole("heading", { name: /第二个正式角色 · 默认造型/ });

    await act(async () => {
      oldRecord.resolve({
        ...inspection,
        characterId: "character-1",
        outfitId: "outfit-1",
      });
      await oldRecord.promise;
    });

    expect(screen.queryByText("已保存：通过")).toBeNull();
  });

  it("ignores an old record failure after navigating to another asset", async () => {
    const oldRecord = deferred<PlaytestInspection>();
    const character2 = createCharacter("character-2", "outfit-2", "第二个正式角色");
    const apis: PlaytestPageAPIs = {
      characters: {
        get: vi.fn((characterId: string) =>
          Promise.resolve(characterId === "character-1" ? character : character2),
        ),
      },
      inspections: {
        getLatest: vi.fn().mockResolvedValue(null),
        record: vi.fn(() => oldRecord.promise),
      },
    };
    const mounted = renderPage(apis);
    fireEvent.click(await screen.findByRole("button", { name: "核验通过" }));
    mounted.navigate("/playtest/character-2/outfit-2");
    await screen.findByRole("heading", { name: /第二个正式角色 · 默认造型/ });

    await act(async () => {
      oldRecord.reject(new Error("old request failed"));
      await oldRecord.promise.catch(() => undefined);
    });

    expect(screen.queryByText("Playtest 核验结论保存失败")).toBeNull();
  });
});
