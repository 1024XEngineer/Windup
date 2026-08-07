import { describe, expect, it, vi } from "vitest";

import {
  createWorkflowRunStore,
  type Generation,
  type GenerationApis,
  type GenerationEvent,
  type GenerationInput,
} from "@/entities";
import { createWorkflowController } from ".";

describe("WorkflowRun first vertical slice", () => {
  it("runs character setup through a completed character-template task", async () => {
    const store = createWorkflowRunStore();
    const taskChannel: { listener?: (event: GenerationEvent) => void } = {};

    const createGeneration: GenerationApis["create"] = async <
      T extends GenerationInput,
    >(
      input: T,
    ) =>
      ({
        id: "task-character-template-1",
        projectId: input.projectId,
        type: input.type,
        status: "pending",
        result: null,
        error: null,
      }) as Generation<T["type"]>;

    const generationApis: GenerationApis = {
      create: vi.fn(createGeneration),
      get: vi.fn(async () => {
        throw new Error("not used in this slice");
      }),
      subscribe: vi.fn((_projectId, taskId, onEvent) => {
        taskChannel.listener = onEvent;
        onEvent({
          taskId,
          type: "character_image",
          status: "pending",
          error: null,
          result: null,
        });
        return () => {
          delete taskChannel.listener;
        };
      }),
    };
    const controller = createWorkflowController({
      store,
      generationApis,
      createId: () => "submission-1",
      now: () => "2026-07-30T12:00:00.000Z",
    });

    const created = await controller.create({
      projectId: "project-1",
      purpose: "create_character",
      prompt: "像素骑士",
    });

    await controller.nextStep(created.id, { width: 64, height: 64 });

    const inFlight = await store.get(created.id);
    expect(
      inFlight?.nodes.find((node) => node.type === "character-template"),
    ).toMatchObject({
      status: "active",
      taskId: "task-character-template-1",
    });

    const taskListener = taskChannel.listener;
    if (!taskListener)
      throw new Error("expected the task subscription to be active");
    taskListener({
      taskId: "task-character-template-1",
      type: "character_image",
      status: "completed",
      error: null,
      result: {
        type: "character_image",
        imageUrls: ["https://example.com/knight.png"],
      },
    });
    await vi.waitFor(async () => {
      const completed = await store.get(created.id);
      expect(
        completed?.nodes.find((node) => node.type === "character-template"),
      ).toMatchObject({
        status: "passed",
        taskId: null,
        output: {
          type: "character_image",
          imageUrls: ["https://example.com/knight.png"],
        },
      });
      expect(
        completed?.nodes.find((node) => node.type === "template-candidate"),
      ).toMatchObject({ status: "active" });
    });
  });
});
