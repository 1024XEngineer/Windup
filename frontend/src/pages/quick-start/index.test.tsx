// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import type { WorkflowRun } from "@/entities";
import { createWorkflowRunState } from "@/features/workflow-controller/workflow-state";
import { QuickStartPage } from ".";
import type { QuickStartService } from "./service";

afterEach(cleanup);

function runFixture(): WorkflowRun {
  return createWorkflowRunState(
    { projectId: "project-1", purpose: "create_character", prompt: "像素骑士" },
    { runId: "run-1", createdAt: "2026-08-07T00:00:00.000Z" },
  );
}

function service(
  overrides: Partial<QuickStartService> = {},
): QuickStartService {
  const run = runFixture();
  return {
    unavailableReason: null,
    start: vi.fn(async () => run),
    startWithUploadedTemplate: vi.fn(async () => run),
    continueWithUploadedTemplate: vi.fn(async () => run),
    startAction: vi.fn(async () => run),
    getWorkflow: vi.fn(() => null),
    subscribe: vi.fn(() => () => undefined),
    resume: vi.fn(async () => run),
    interrupt: vi.fn(async () => run),
    confirmCandidate: vi.fn(async () => run),
    approveReview: vi.fn(async () => run),
    getCharacterInfo: vi.fn(() => null),
    resolveCharacterInfo: vi.fn(async () => null),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前路径">{location.pathname}</output>;
}

function renderPage(testService: QuickStartService, entry = "/quick-start") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/quick-start"
          element={
            <>
              <QuickStartPage service={testService} />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/quick-start/:runId"
          element={
            <>
              <QuickStartPage service={testService} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("QuickStartPage", () => {
  it("starts from natural language and stays in the Quick Start interface", async () => {
    const testService = service();
    renderPage(testService);

    fireEvent.change(screen.getByLabelText("创作指令"), {
      target: { value: "像素骑士" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    await waitFor(() => {
      expect(screen.getByLabelText("当前路径").textContent).toBe(
        "/quick-start/run-1",
      );
    });
    expect(testService.start).toHaveBeenCalledWith("像素骑士");
  });

  it("restores a run asynchronously when the page cache starts empty", async () => {
    const testService = service();
    renderPage(testService, "/quick-start/run-1");

    expect(await screen.findByText("像素骑士")).toBeTruthy();
    expect(testService.resume).toHaveBeenCalledWith("run-1");
  });

  it("shows the configured unavailable reason instead of starting a fake run", () => {
    const testService = service({ unavailableReason: "生成服务尚未配置" });
    renderPage(testService);

    expect(screen.getByText("生成服务尚未配置")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "开始生成" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
