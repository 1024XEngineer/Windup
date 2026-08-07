import { describe, expect, it, vi } from "vitest";

import type {
  Character,
  CharacterApis,
  Generation,
  GenerationApis,
  GenerationInput,
  MediaApis,
} from "@/entities";
import { createWorkflowRunStore } from "@/entities/workflow-run/store";
import { createWorkflowController } from "@/features/workflow-controller";
import { createQuickStartService } from "./service";

function characterApis(): CharacterApis {
  const character: Character = {
    id: "character-1",
    projectId: "project-1",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
    outfits: [
      {
        id: "outfit-1",
        characterId: "character-1",
        name: "默认造型",
        candidateCharacterTemplates: [],
        characterTemplateUrl: "https://example.com/template.png",
        baseFrames: [],
        actions: [],
      },
    ],
  };
  return {
    get: vi.fn(async () => character),
    listByProject: vi.fn(async () => [character]),
    create: vi.fn(async () => character),
    update: vi.fn(async (input) => input),
    remove: vi.fn(async () => undefined),
  };
}

function createHarness() {
  const store = createWorkflowRunStore();
  const createGeneration: GenerationApis["create"] = async <
    T extends GenerationInput,
  >(
    input: T,
  ) =>
    ({
      id: `task-${input.type}`,
      projectId: input.projectId,
      type: input.type,
      status: "pending",
      result: null,
      error: null,
    }) as Generation<T["type"]>;
  const generationApis: GenerationApis = {
    create: vi.fn(createGeneration),
    get: vi.fn(async () => {
      throw new Error("not used");
    }),
    subscribe: vi.fn(() => () => undefined),
  };
  const characters = characterApis();
  const mediaUpload = vi.fn(
    async () => "https://example.com/uploaded.png" as never,
  );
  const mediaApis: MediaApis = { upload: mediaUpload };
  const prepareProject = vi.fn(async () => ({
    id: "project-1",
    spriteSize: { width: 64, height: 64 },
  }));
  const controller = createWorkflowController({
    store,
    generationApis,
    characterApis: characters,
  });
  const service = createQuickStartService({
    controller,
    prepareProject,
    characterApis: characters,
    mediaApis,
  });
  return {
    service,
    store,
    generationApis,
    prepareProject,
    mediaUpload,
    characters,
  };
}

describe("createQuickStartService", () => {
  it("creates a real project-owned run and starts character image generation", async () => {
    const harness = createHarness();

    const run = await harness.service.start("  像素骑士  ");

    expect(harness.prepareProject).toHaveBeenCalledWith("像素骑士");
    expect(run).toMatchObject({ projectId: "project-1", prompt: "像素骑士" });
    expect(
      run.nodes.find((node) => node.type === "character-template"),
    ).toMatchObject({
      status: "active",
      taskId: "task-character_image",
    });
    expect(harness.generationApis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "character_image",
        spriteWidth: 64,
        spriteHeight: 64,
      }),
    );
  });

  it("does not leave an orphan run when project creation fails", async () => {
    const harness = createHarness();
    vi.mocked(harness.prepareProject).mockRejectedValueOnce(
      new Error("项目服务不可用"),
    );

    await expect(harness.service.start("像素骑士")).rejects.toThrow(
      "项目服务不可用",
    );
    await expect(harness.store.list()).resolves.toEqual([]);
  });

  it("uploads an existing template and skips character image generation", async () => {
    const harness = createHarness();
    const file = new File(["png"], "template.png", { type: "image/png" });

    const run = await harness.service.startWithUploadedTemplate(file, "挥手");

    expect(harness.mediaUpload).toHaveBeenCalledWith(
      file,
      "reference-image",
      undefined,
    );
    expect(harness.generationApis.create).toHaveBeenCalledTimes(1);
    expect(harness.generationApis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "character_action",
        numFrames: 32,
        prompt: "挥手",
        firstFrameUrl: "https://example.com/uploaded.png",
      }),
    );
    expect(
      run.nodes.find((node) => node.type === "character-template"),
    ).toMatchObject({
      status: "passed",
      taskId: null,
    });
  });

  it("recovers character references from the backend for an older run", async () => {
    const harness = createHarness();
    const created = await harness.service.start("旧角色");

    const info = await harness.service.resolveCharacterInfo(created.id);

    expect(harness.characters.listByProject).toHaveBeenCalledWith("project-1");
    expect(info).toEqual({ characterId: "character-1", outfitId: "outfit-1" });
  });
});
