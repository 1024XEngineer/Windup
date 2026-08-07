import { describe, expect, it, vi } from "vitest";

import type {
  Character,
  CharacterApis,
  WorkflowRun,
  WorkflowNode,
} from "@/entities";
import {
  buildPlaytestPath,
  buildPublishedActionId,
  publishWorkflowRun,
} from "./index";

describe("buildPlaytestPath", () => {
  it("uses one encoded route contract for every Playtest caller", () => {
    expect(
      buildPlaytestPath({
        characterId: "character/1",
        outfitId: "default outfit",
        actionId: "walk left",
      }),
    ).toBe("/playtest/character%2F1/default%20outfit?actionId=walk+left");
  });
});

describe("publishWorkflowRun with multiple actions", () => {
  it("publishes only the latest reviewed action under a node-specific id", async () => {
    const firstActionId = buildPublishedActionId(
      "character-1",
      "run-1",
      "revision-1:action-generation",
    );
    const character: Character = {
      id: "character-1",
      projectId: "project-1",
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
      outfits: [
        {
          id: "outfit-1",
          characterId: "character-1",
          name: "默认造型",
          candidateCharacterTemplates: [],
          characterTemplateUrl: "template.png",
          baseFrames: [],
          actions: [
            {
              id: firstActionId,
              outfitId: "outfit-1",
              name: "待机",
              expectedFrameCount: 1,
              kind: "custom",
              type: "idle",
              fps: 8,
              keyFrameIndex: 0,
              frames: [
                { imageUrl: "idle.png", durationMs: null, rootMotion: null },
              ],
            },
          ],
        },
      ],
    };
    const common = {
      status: "passed" as const,
      taskId: null,
      submissionId: null,
      error: null,
      referenceStepIds: [],
    };
    const nodes: WorkflowNode[] = [
      {
        ...common,
        id: "setup",
        type: "character-setup",
        input: null,
        output: null,
      },
      {
        ...common,
        id: "template",
        type: "character-template",
        input: null,
        output: null,
      },
      {
        ...common,
        id: "candidate",
        type: "action-first-frame",
        input: null,
        output: null,
      },
      {
        ...common,
        id: "revision-1:action-generation",
        type: "action-generation",
        input: null,
        output: {
          type: "character_action",
          actionType: "idle",
          frames: [{ index: 0, imageUrl: "idle.png", durationMs: null }],
        },
      },
      {
        ...common,
        id: "revision-1:review",
        type: "review",
        input: null,
        output: null,
      },
      {
        ...common,
        id: "revision-1:action-generation:2",
        type: "action-generation",
        input: {
          type: "character_action",
          projectId: "project-1",
          characterId: "character-1",
          outfitId: "outfit-1",
          actionType: "custom",
          firstFrameUrl: "template.png",
          prompt: "挥手",
          referenceMedia: ["template.png" as never],
          numFrames: 32,
        },
        output: {
          type: "character_action",
          actionType: "custom",
          frames: [{ index: 0, imageUrl: "wave.png", durationMs: 125 }],
        },
      },
      {
        ...common,
        id: "revision-1:review:2",
        type: "review",
        input: null,
        output: null,
      },
    ];
    const run: WorkflowRun = {
      id: "run-1",
      projectId: "project-1",
      characterId: "character-1",
      outfitId: "outfit-1",
      purpose: "create_character",
      status: "completed",
      prompt: "像素骑士",
      nodes,
      generationStatus: "completed",
      exportStatus: "not_exported",
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    const update = vi.fn(async (input: Character) => input);
    const apis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(),
      create: vi.fn(),
      update,
      remove: vi.fn(),
    };

    const saved = await publishWorkflowRun(apis, run);

    expect(saved.outfits[0]?.actions).toHaveLength(2);
    expect(saved.outfits[0]?.actions[0]?.id).toBe(firstActionId);
    expect(saved.outfits[0]?.actions[1]).toMatchObject({
      id: buildPublishedActionId(
        "character-1",
        "run-1",
        "revision-1:action-generation:2",
      ),
      name: "挥手",
      frames: [{ imageUrl: "wave.png" }],
    });
  });
});
