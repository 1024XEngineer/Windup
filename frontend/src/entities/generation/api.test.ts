import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaReference } from "../media";
import { createGenerationApis } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function generationTaskResponse() {
  return new Response(
    JSON.stringify({
      code: 200,
      message: "success",
      data: {
        id: 11,
        user_id: 1,
        project_id: 7,
        task_type: "character_action",
        status: "pending",
        input_payload: {},
        result: null,
        error_message: null,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("generation API adapter", () => {
  it("requests 32 frames for a complete animation while keeping first-frame generation at one frame", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => generationTaskResponse());
    vi.stubGlobal("fetch", fetchMock);
    const api = createGenerationApis();

    await api.create({
      type: "character_action",
      projectId: "7",
      characterId: "9",
      outfitId: "outfit-9-default",
      actionType: "walk",
      prompt: null,
      firstFrameUrl: null,
      numFrames: 1,
      referenceMedia: [],
    });
    await api.create({
      type: "character_action",
      projectId: "7",
      characterId: "9",
      outfitId: "outfit-9-default",
      actionType: "walk",
      firstFrameUrl: "https://cdn.example.com/first-frame.png",
      prompt: null,
      numFrames: 32,
      referenceMedia: ["media-reference-1" as MediaReference],
    });

    const firstFramePayload = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    const completeAnimationPayload = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(firstFramePayload.num_frames).toBe(1);
    expect(completeAnimationPayload.num_frames).toBe(32);
  });

  it("maps the SSE id field to the frontend taskId", () => {
    const listeners: Record<string, ((event: Event) => void) | undefined> = {};
    const close = vi.fn();
    class FakeEventSource {
      onerror: ((event: Event) => void) | null = null;
      addEventListener(type: string, listener: (event: Event) => void) {
        listeners[type] = listener;
      }
      removeEventListener() {}
      close = close;
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const onEvent = vi.fn();
    createGenerationApis().subscribe("7", "11", onEvent);

    listeners.task_update?.({
      data: JSON.stringify({
        id: 11,
        task_type: "character_action",
        status: "running",
        result: null,
        error_message: null,
      }),
    } as MessageEvent);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "11",
        type: "character_action",
        status: "running",
      }),
    );
    expect(close).not.toHaveBeenCalled();
  });
});
