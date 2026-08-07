import { describe, expect, it } from "vitest";

import type { MediaReference, WorkflowRun } from "@/entities";

import {
  acceptUploadedCharacterTemplateState,
  advanceCharacterSetupState,
  appendActionState,
  approveReviewState,
  beginActionGenerationState,
  completeActionGenerationState,
  createWorkflowRunState,
  restartWorkflowRunState,
  updateCharacterSetupState,
} from "./workflow-state";

const CREATED_AT = "2026-07-31T02:40:00.000Z";

function createRun() {
  return createWorkflowRunState(
    {
      projectId: "project-1",
      purpose: "create_character",
      prompt: "  pixel knight  ",
    },
    { runId: "run-1", createdAt: CREATED_AT },
  );
}

function readyForReview(): WorkflowRun {
  const run = createRun();
  return {
    ...run,
    characterId: "character-1",
    outfitId: "outfit-1",
    generationStatus: "completed",
    nodes: run.nodes.map((node) => ({
      ...node,
      status:
        node.type === "review" ? ("active" as const) : ("passed" as const),
    })),
  };
}

describe("workflow state transitions", () => {
  it("creates one WorkflowRun with the five initial nodes", () => {
    const run = createRun();

    expect(run).toMatchObject({
      id: "run-1",
      projectId: "project-1",
      status: "active",
      prompt: "pixel knight",
      createdAt: CREATED_AT,
    });
    expect(run.nodes.map(({ type, status }) => ({ type, status }))).toEqual([
      { type: "character-setup", status: "active" },
      { type: "character-template", status: "locked" },
      { type: "template-candidate", status: "locked" },
      { type: "action-generation", status: "locked" },
      { type: "review", status: "locked" },
    ]);
  });

  it("starts add_action directly at action generation for the existing outfit", () => {
    const run = createWorkflowRunState(
      {
        projectId: "project-1",
        purpose: "add_action",
        prompt: "挥手打招呼",
        characterId: "character-1",
        outfitId: "outfit-1",
        characterTemplateUrl: "https://example.com/template.png",
        baseFrameUrls: [],
      },
      { runId: "run-action-1", createdAt: CREATED_AT },
    );

    expect(run.nodes.map(({ type, status }) => ({ type, status }))).toEqual([
      { type: "character-setup", status: "passed" },
      { type: "character-template", status: "passed" },
      { type: "template-candidate", status: "passed" },
      { type: "action-generation", status: "active" },
      { type: "review", status: "locked" },
    ]);
  });

  it("normalizes setup and advances with a frozen generation input", () => {
    const updated = updateCharacterSetupState(createRun(), {
      description: "  revised knight  ",
      referenceMedia: [],
    });
    const transitioned = advanceCharacterSetupState(updated, {
      width: 64,
      height: 64,
    });

    expect(transitioned.target).toEqual({
      runId: "run-1",
      nodeId: "run-1:character-template",
    });
    expect(transitioned.run.nodes[1]).toMatchObject({
      type: "character-template",
      status: "active",
      input: {
        type: "character_image",
        projectId: "project-1",
        prompt: "revised knight",
        spriteWidth: 64,
        spriteHeight: 64,
      },
    });
  });

  it("accepts an uploaded template without fabricating a generation task", () => {
    const accepted = acceptUploadedCharacterTemplateState(
      createRun(),
      "https://cdn.example.com/uploaded.png" as MediaReference,
    );

    expect(accepted.nodes[1]).toMatchObject({
      type: "character-template",
      status: "passed",
      taskId: null,
      output: {
        type: "character_image",
        imageUrls: ["https://cdn.example.com/uploaded.png"],
      },
    });
    expect(accepted.nodes[2]?.output).toEqual({
      selectedImageUrl: "https://cdn.example.com/uploaded.png",
    });
    expect(accepted.nodes[3]?.status).toBe("active");
  });

  it("completes the run when the active review is approved", () => {
    const completed = approveReviewState(readyForReview());

    expect(completed.status).toBe("completed");
    expect(completed.nodes.every((node) => node.status === "passed")).toBe(
      true,
    );
  });

  it("reopens the same run and appends a unique action/review pair", () => {
    const appended = appendActionState(approveReviewState(readyForReview()));

    expect(appended.id).toBe("run-1");
    expect(appended.status).toBe("active");
    expect(
      appended.nodes.slice(-2).map(({ type, status }) => ({ type, status })),
    ).toEqual([
      { type: "action-generation", status: "active" },
      { type: "review", status: "locked" },
    ]);
    expect(new Set(appended.nodes.map((node) => node.id)).size).toBe(
      appended.nodes.length,
    );
  });

  it("records a 32-frame action without overwriting earlier action nodes", () => {
    const appended = appendActionState(approveReviewState(readyForReview()));
    const input = {
      type: "character_action" as const,
      projectId: "project-1",
      characterId: "character-1",
      outfitId: "outfit-1",
      actionType: "custom" as const,
      firstFrameUrl: "template.png",
      prompt: "挥手",
      referenceMedia: ["template.png" as MediaReference],
      numFrames: 32,
    };
    const submitting = beginActionGenerationState(
      appended,
      input,
      "submission-2",
    );
    const generated = completeActionGenerationState(submitting, {
      type: "character_action",
      actionType: "custom",
      frames: Array.from({ length: 32 }, (_, index) => ({
        index,
        imageUrl: `wave-${index}.png`,
        durationMs: null,
      })),
    });

    expect(
      generated.nodes.filter((node) => node.type === "action-generation"),
    ).toHaveLength(2);
    expect(generated.nodes.at(-2)).toMatchObject({ status: "passed" });
    expect(generated.nodes.at(-1)).toMatchObject({
      type: "review",
      status: "active",
    });
  });

  it("restarts a passed node in place and clears its downstream results", () => {
    const run = readyForReview();
    const restarted = restartWorkflowRunState(run, "run-1:character-template");

    expect(restarted.id).toBe(run.id);
    expect(restarted.nodes[1]).toMatchObject({
      status: "active",
      output: null,
    });
    expect(
      restarted.nodes.slice(2).every((node) => node.status === "locked"),
    ).toBe(true);
  });
});
