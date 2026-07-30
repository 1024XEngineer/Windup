import { describe, expect, it } from "vitest";

import type { Character } from "../../../../entities";
import { createPreviewModel } from "./create-preview-model";

const character: Character = {
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
      baseFrames: [
        { direction: "south", imageUrl: "https://cdn.example.test/base-south.png" },
        { direction: "north", imageUrl: "https://cdn.example.test/base-north.png" },
      ],
      actions: [
        {
          id: "walk",
          outfitId: "outfit-1",
          name: "Walk",
          source: "action_template",
          type: "walk",
          status: "confirmed",
          fps: 5,
          sequences: [
            {
              direction: "south",
              keyFrameIndex: 1,
              frames: [
                {
                  imageUrl: "https://cdn.example.test/walk-south-0.png",
                  durationMs: 125,
                  rootMotion: { dx: 1, dy: 0 },
                  qc: "passed",
                  rejected: false,
                },
                {
                  imageUrl: "https://cdn.example.test/walk-south-1.png",
                  durationMs: null,
                  rootMotion: null,
                  qc: "failed",
                  rejected: true,
                },
              ],
            },
            {
              direction: "north",
              keyFrameIndex: null,
              frames: [
                {
                  imageUrl: "https://cdn.example.test/walk-north-0.png",
                  durationMs: 0,
                  rootMotion: { dx: 0, dy: 2 },
                  qc: "pending",
                  rejected: false,
                },
              ],
            },
          ],
        },
        {
          id: "idle",
          outfitId: "outfit-1",
          name: "Idle",
          source: "custom",
          type: "idle",
          status: "candidate",
          fps: 0,
          sequences: [
            {
              direction: "default",
              keyFrameIndex: 0,
              frames: [
                {
                  imageUrl: "https://cdn.example.test/idle-0.png",
                  durationMs: null,
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
};

describe("createPreviewModel", () => {
  it("reports a missing outfit without constructing a preview model", () => {
    expect(createPreviewModel(character, "missing-outfit")).toEqual({
      ok: false,
      reason: "outfit_not_found",
    });
  });

  it("preserves action and direction order while deriving preview fields", () => {
    const result = createPreviewModel(character, "outfit-1");

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected preview model");

    expect(result.model.actions.map((action) => action.id)).toEqual(["walk", "idle"]);
    expect(result.model.actions[0].sequences.map((sequence) => sequence.direction)).toEqual([
      "south",
      "north",
    ]);
    expect(result.model).toMatchObject({
      characterId: "character-1",
      characterName: "Aster",
      outfitId: "outfit-1",
      outfitName: "Explorer",
      characterTemplateUrl: "https://cdn.example.test/aster.png",
      baseFrameCount: 2,
    });
  });

  it("uses a positive frame duration before fps fallback and maps key frames", () => {
    const result = createPreviewModel(character, "outfit-1");
    if (!result.ok) throw new Error("expected preview model");

    const [south, north] = result.model.actions[0].sequences;
    expect(south.frames.map((frame) => frame.durationMs)).toEqual([125, 200]);
    expect(south.frames.map((frame) => frame.keyFrame)).toEqual([false, true]);
    expect(north.frames[0]).toMatchObject({
      durationMs: 200,
      keyFrame: false,
      rootMotion: { dx: 0, dy: 2 },
      qc: "pending",
      rejected: false,
    });
  });

  it("uses a 100ms display fallback for invalid fps without rewriting the action", () => {
    const result = createPreviewModel(character, "outfit-1");
    if (!result.ok) throw new Error("expected preview model");

    expect(result.model.actions[1].sequences[0].frames[0].durationMs).toBe(100);
    expect(character.outfits[0].actions[1].fps).toBe(0);
  });

  it("does not mutate the input character", () => {
    const before = JSON.stringify(character);

    createPreviewModel(character, "outfit-1");

    expect(JSON.stringify(character)).toBe(before);
  });
});
