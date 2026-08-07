import { describe, expect, it, vi } from "vitest";

import {
  CHARACTER_ACTION_FRAME_COUNT,
  type Character,
  type CharacterApis,
  type Generation,
  type GenerationApis,
  type GenerationEvent,
  type GenerationInput,
  type WorkflowRun,
  type WorkflowRunStore,
} from "@/entities";
import { createWorkflowController } from ".";

const NOW = "2026-07-30T12:00:00.000Z";

function createStore(): WorkflowRunStore {
  const runs = new Map<string, WorkflowRun>();
  return {
    async create(input) {
      return {
        id: `run-${runs.size + 1}`,
        projectId: input.projectId,
        characterId: input.purpose === "add_action" ? input.characterId : null,
        outfitId: input.purpose === "add_action" ? input.outfitId : null,
        purpose: input.purpose,
        status: "active",
        nodes: [],
        generationStatus: "not_started",
        exportStatus: "not_exported",
        prompt: input.prompt ?? null,
        createdAt: NOW,
      };
    },
    async get(id) {
      const run = runs.get(id);
      return run ? structuredClone(run) : null;
    },
    async getByCharacter(characterId) {
      const run = [...runs.values()].find(
        (item) => item.characterId === characterId,
      );
      return run ? structuredClone(run) : null;
    },
    async list(projectId) {
      return [...runs.values()]
        .filter((run) => !projectId || run.projectId === projectId)
        .map((run) => structuredClone(run));
    },
    async save(run) {
      runs.set(run.id, structuredClone(run));
    },
  };
}

function createHarness(characterApis?: CharacterApis) {
  const listeners = new Map<string, (event: GenerationEvent) => void>();
  const createGeneration: GenerationApis["create"] = async <
    T extends GenerationInput,
  >(
    input: T,
  ) =>
    ({
      id: input.type === "character_image" ? "task-image-1" : "task-action-1",
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
    subscribe: vi.fn((_projectId, taskId, onEvent) => {
      listeners.set(taskId, onEvent);
      return () => listeners.delete(taskId);
    }),
  };
  const store = createStore();
  const controller = createWorkflowController({
    store,
    generationApis,
    characterApis,
    now: () => NOW,
    createId: () => "submission-1",
  });
  return {
    controller,
    store,
    emit(taskId: string, event: GenerationEvent) {
      const listener = listeners.get(taskId);
      if (!listener) throw new Error(`missing listener ${taskId}`);
      listener(event);
    },
  };
}

describe("createWorkflowController", () => {
  it("creates and persists the frontend-owned node graph", async () => {
    const { controller, store } = createHarness();
    const run = await controller.create({
      projectId: "project-1",
      purpose: "create_character",
      prompt: "pixel knight",
    });

    expect(run.nodes).toHaveLength(5);
    expect(run.nodes[0]).toMatchObject({
      type: "character-setup",
      status: "active",
    });
    expect(await store.get(run.id)).toEqual(run);
  });

  it("notifies page subscribers whenever the persisted snapshot changes", async () => {
    const { controller } = createHarness();
    const run = await controller.create({
      projectId: "project-1",
      purpose: "create_character",
    });
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(run.id, listener);

    await controller.updateCharacterSetup(run.id, {
      description: "revised knight",
      referenceMedia: [],
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            type: "character-setup",
            input: expect.objectContaining({ description: "revised knight" }),
          }),
        ]),
      }),
    );
    unsubscribe();
  });

  it("rolls the page cache back when persistence fails", async () => {
    const { controller, store } = createHarness();
    const run = await controller.create({
      projectId: "project-1",
      purpose: "create_character",
    });
    const listener = vi.fn();
    controller.subscribe(run.id, listener);
    store.save = vi.fn().mockRejectedValue(new Error("save failed"));

    await expect(
      controller.updateCharacterSetup(run.id, {
        description: "must not appear as saved",
        referenceMedia: [],
      }),
    ).rejects.toThrow("save failed");

    expect(controller.getWorkflow(run.id)).toEqual(run);
    expect(listener).toHaveBeenLastCalledWith(run);
  });

  it("moves from setup to candidate selection when the image task completes", async () => {
    const { controller, emit } = createHarness();
    const run = await controller.create({
      projectId: "project-1",
      purpose: "create_character",
      prompt: "pixel knight",
    });
    await controller.nextStep(run.id, { width: 64, height: 64 });

    emit("task-image-1", {
      taskId: "task-image-1",
      type: "character_image",
      status: "completed",
      error: null,
      result: {
        type: "character_image",
        imageUrls: ["https://example.com/knight.png"],
      },
    });

    await vi.waitFor(() => {
      expect(controller.getWorkflow(run.id)?.nodes[2]).toMatchObject({
        type: "template-candidate",
        status: "active",
      });
    });
  });

  it("keeps interruption as frontend state and preserves the active node", async () => {
    const { controller } = createHarness();
    const run = await controller.create({
      projectId: "project-1",
      purpose: "create_character",
    });

    const interrupted = await controller.interrupt(run.id);

    expect(interrupted.status).toBe("interrupted");
    expect(
      interrupted.nodes.filter((node) => node.status === "active"),
    ).toHaveLength(1);
  });

  it("deduplicates concurrent character creation for one candidate", async () => {
    const character: Character = {
      id: "character-1",
      projectId: "project-1",
      createdAt: NOW,
      updatedAt: NOW,
      outfits: [
        {
          id: "outfit-1",
          characterId: "character-1",
          name: "默认造型",
          candidateCharacterTemplates: [],
          characterTemplateUrl: "https://example.com/knight.png",
          baseFrames: [],
          actions: [],
        },
      ],
    };
    let releaseCreate: ((character: Character) => void) | undefined;
    const characterApis: CharacterApis = {
      get: vi.fn(async () => character),
      listByProject: vi.fn(async () => [character]),
      create: vi.fn(
        () =>
          new Promise<Character>((resolve) => {
            releaseCreate = resolve;
          }),
      ),
      update: vi.fn(async (updated) => updated),
      remove: vi.fn(async () => undefined),
    };
    const { controller, emit } = createHarness(characterApis);
    const run = await controller.create({
      projectId: "project-1",
      purpose: "create_character",
      prompt: "pixel knight",
    });
    await controller.nextStep(run.id, { width: 64, height: 64 });
    emit("task-image-1", {
      taskId: "task-image-1",
      type: "character_image",
      status: "completed",
      error: null,
      result: {
        type: "character_image",
        imageUrls: ["https://example.com/knight.png"],
      },
    });
    await vi.waitFor(() => {
      expect(controller.getWorkflow(run.id)?.nodes[2]?.status).toBe("active");
    });

    const first = controller.startActionFromTemplate(
      run.id,
      "https://example.com/knight.png",
    );
    const second = controller.startActionFromTemplate(
      run.id,
      "https://example.com/knight.png",
    );
    await vi.waitFor(() => expect(characterApis.create).toHaveBeenCalledOnce());
    releaseCreate?.(character);
    await Promise.all([first, second]);

    expect(characterApis.create).toHaveBeenCalledOnce();
  });

  it("rejects an action result that is not exactly 32 frames", async () => {
    const { controller } = createHarness();
    const run = await controller.create({
      projectId: "project-1",
      purpose: "add_action",
      characterId: "character-1",
      outfitId: "outfit-1",
      characterTemplateUrl: "template.png",
      baseFrameUrls: [],
    });
    const result = await controller.completeActionGeneration(run.id, {
      type: "character_action",
      actionType: "idle",
      frames: Array.from(
        { length: CHARACTER_ACTION_FRAME_COUNT - 1 },
        (_, index) => ({
          index,
          imageUrl: `frame-${index}.png`,
          durationMs: null,
        }),
      ),
    });

    expect(result.status).toBe("failed");
    expect(
      result.nodes.find((node) => node.type === "action-generation"),
    ).toMatchObject({
      status: "failed",
      error: expect.stringContaining("32 帧"),
    });
  });
});
