import type {
  CharacterApis,
  CharacterSetupNodeInput,
  CharacterActionGenerationInput,
  CharacterActionOutput,
  GenerationApis,
  MediaReference,
  WorkflowRun,
  WorkflowRunStore,
} from "@/entities";
import { publishWorkflowRun } from "@/features/publish";
import {
  createActionGenerationTask,
  getCharacterActionFrameCountError,
} from "./action-generation-task";
import { createCharacterTemplateTask } from "./character-template-task";
import {
  advanceCharacterSetupState,
  appendActionState,
  acceptUploadedCharacterTemplateState,
  approveReviewState,
  completeActionGenerationState,
  confirmFirstFrameState,
  createWorkflowRunState,
  getActiveNode,
  interruptWorkflowRunState,
  recordActionGenerationTaskState,
  restartWorkflowRunState,
  requireActiveWorkflow,
  updateCharacterSetupState,
  type CreateWorkflowRunStateInput,
} from "./workflow-state";

/** 创建角色与给已有角色增加动作共用同一条运行状态机。 */
export type CreateWorkflowControllerInput = CreateWorkflowRunStateInput;

export interface WorkflowController {
  /** 创建前端执行线，并把完整快照保存到持久化端。 */
  create(input: CreateWorkflowControllerInput): Promise<WorkflowRun>;

  /** 按路由中的 runId 读取快照；不存在时返回 null。 */
  getWorkflow(runId: WorkflowRun["id"]): WorkflowRun | null;

  /** 按 Character 定位其唯一制作 Run；新增动作必须优先复用该 Run。 */
  getWorkflowByCharacter(characterId: string): Promise<WorkflowRun | null>;

  /** 订阅当前页面会话中的运行状态；持久化实现不承担 UI 通知。 */
  subscribe(
    runId: WorkflowRun["id"],
    listener: (run: WorkflowRun) => void,
  ): () => void;

  /** 在同一条已完成 Run 中追加新的动作生成与审核节点。 */
  appendAction(runId: WorkflowRun["id"]): Promise<WorkflowRun>;

  /** 修改当前角色资料节点，页面无需知道节点内部 ID。 */
  updateCharacterSetup(
    runId: WorkflowRun["id"],
    input: CharacterSetupNodeInput,
  ): Promise<WorkflowRun>;

  /** 采用已上传的角色母版，跳过图片生成与候选选择并激活动作生成。 */
  acceptUploadedCharacterTemplate(
    runId: WorkflowRun["id"],
    templateUrl: MediaReference,
  ): Promise<WorkflowRun>;

  /**
   * 推进一个节点。当前纵切只实现角色资料到角色图生成；
   * 后续节点进入各自实现 PR 后再扩展，不在这里伪造完成。
   * spriteSize 为项目精灵图尺寸，角色图生成节点需要传给后端做尺寸校验。
   */
  nextStep(
    runId: WorkflowRun["id"],
    spriteSize?: { width: number; height: number },
  ): Promise<WorkflowRun>;

  /** 页面恢复时先读取任务终态；仍在运行时再恢复订阅。 */
  resume(runId: WorkflowRun["id"]): Promise<WorkflowRun | null>;

  /** 只停止前端自动推进和任务订阅；后端当前没有取消任务能力。 */
  interrupt(runId: WorkflowRun["id"]): Promise<WorkflowRun>;

  /** 确认首帧生成完成，推进到完整帧率生成。 */
  confirmFirstFrame(runId: WorkflowRun["id"]): Promise<WorkflowRun>;

  /**
   * 采用已确认的角色母版，并统一完成 Character 落库、Run 绑定与动作任务提交。
   * Quick Start 和 Workflow Editor 都调用这个命令，页面不再各自复制业务编排。
   */
  startActionFromTemplate(
    runId: WorkflowRun["id"],
    templateImageUrl: string,
    actionDescription?: string,
  ): Promise<WorkflowRun>;

  /** 动作生成完成后写回结果，标记当前动作节点为 passed。 */
  completeActionGeneration(
    runId: WorkflowRun["id"],
    result: CharacterActionOutput | { error: string },
  ): Promise<WorkflowRun>;

  /** 提交完整动作生成，并由 Controller 统一处理订阅和刷新恢复。 */
  startActionGeneration(
    runId: WorkflowRun["id"],
    input: CharacterActionGenerationInput,
  ): Promise<WorkflowRun>;

  /** 审核通过后完成当前版本和整条运行；不在这里执行发布或下载。 */
  approveReview(runId: WorkflowRun["id"]): Promise<WorkflowRun>;

  /** 审核当前动作并写入正式 Character；发布失败后允许用同一 Run 重试。 */
  approveAndPublish(runId: WorkflowRun["id"]): Promise<WorkflowRun>;

  /** 动作生成任务提交后把任务 ID 落盘，供页面刷新后 resume 恢复轮询。 */
  recordActionGenerationTask(
    runId: WorkflowRun["id"],
    taskId: string,
  ): Promise<WorkflowRun>;

  /** 记录动作生成关联的角色与造型 ID，供导出到 Playtest 使用（刷新后可恢复）。 */
  recordCharacterRefs(
    runId: WorkflowRun["id"],
    refs: { characterId: string; outfitId: string },
  ): Promise<WorkflowRun>;

  /** 从当前执行线中一个已通过的节点重新开始。 */
  restart(runId: WorkflowRun["id"], nodeId: string): Promise<WorkflowRun>;
}

export interface CreateWorkflowControllerOptions {
  store: WorkflowRunStore;
  generationApis: GenerationApis;
  /** 创建角色流程需要该接口；只操作已有角色动作时可不配置。 */
  characterApis?: CharacterApis;
  /** 测试可注入确定性 ID；生产默认使用浏览器随机 UUID。 */
  createId?: (scope: "run" | "submission") => string;
  /** 测试可注入确定性时间。 */
  now?: () => string;
}

/**
 * Quick Start 与手动工作流共用的流程协调器。
 *
 * Controller 只负责读取当前节点、保存状态并委派角色图任务；纯状态转换和异步任务
 * 生命周期分别留在本 Feature 的内部模块。生产接入必须复用同一个 Controller 实例，
 * 不能在组件渲染期间重复创建。
 */
export function createWorkflowController({
  store,
  generationApis,
  characterApis,
  createId = createRuntimeId,
  now = () => new Date().toISOString(),
}: CreateWorkflowControllerOptions): WorkflowController {
  const cache = new Map<WorkflowRun["id"], WorkflowRun>();
  const listeners = new Map<
    WorkflowRun["id"],
    Set<(run: WorkflowRun) => void>
  >();
  const saveQueues = new Map<WorkflowRun["id"], Promise<void>>();
  const persistedSnapshots = new Map<WorkflowRun["id"], WorkflowRun>();
  const mutationVersions = new Map<WorkflowRun["id"], number>();
  const templateActionSubmissions = new Map<
    WorkflowRun["id"],
    Promise<WorkflowRun>
  >();

  function notify(run: WorkflowRun) {
    const snapshot = structuredClone(run);
    for (const listener of listeners.get(snapshot.id) ?? []) {
      try {
        listener(structuredClone(snapshot));
      } catch {
        // 一个页面订阅者渲染失败不能阻断持久化，也不能影响其他订阅者。
      }
    }
    return structuredClone(snapshot);
  }

  function rememberStored(run: WorkflowRun) {
    const snapshot = structuredClone(run);
    cache.set(snapshot.id, snapshot);
    persistedSnapshots.set(snapshot.id, structuredClone(snapshot));
    return notify(snapshot);
  }

  async function load(runId: WorkflowRun["id"]) {
    const cached = cache.get(runId);
    if (cached) return structuredClone(cached);
    const stored = await store.get(runId);
    return stored ? rememberStored(stored) : null;
  }

  async function persist(run: WorkflowRun) {
    const snapshot = structuredClone(run);
    const version = (mutationVersions.get(snapshot.id) ?? 0) + 1;
    mutationVersions.set(snapshot.id, version);
    cache.set(snapshot.id, structuredClone(snapshot));
    // 同一 Run 的网络写入必须保持调用顺序，避免较慢的旧请求最后落库覆盖新状态。
    const previous = saveQueues.get(snapshot.id) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(() => store.save(structuredClone(snapshot)));
    saveQueues.set(snapshot.id, pending);
    try {
      await pending;
      persistedSnapshots.set(snapshot.id, structuredClone(snapshot));
      if (mutationVersions.get(snapshot.id) === version) notify(snapshot);
    } catch (cause) {
      if (mutationVersions.get(snapshot.id) === version) {
        const fallback = persistedSnapshots.get(snapshot.id);
        if (fallback) {
          cache.set(snapshot.id, structuredClone(fallback));
          notify(fallback);
        } else {
          cache.delete(snapshot.id);
        }
      }
      throw cause;
    } finally {
      if (saveQueues.get(snapshot.id) === pending)
        saveQueues.delete(snapshot.id);
    }
    return snapshot;
  }

  const taskStore: WorkflowRunStore = {
    create: (input) => store.create(input),
    get: load,
    getByCharacter: async (characterId) => {
      const cached = [...cache.values()].find(
        (run) => run.characterId === characterId,
      );
      if (cached) return structuredClone(cached);
      const stored = await store.getByCharacter(characterId);
      return stored ? rememberStored(stored) : null;
    },
    list: (projectId) => store.list(projectId),
    save: async (run) => {
      await persist(run);
    },
  };

  const characterTemplateTask = createCharacterTemplateTask({
    store: taskStore,
    generationApis,
    createSubmissionId: () => createId("submission"),
  });
  const actionGenerationTask = createActionGenerationTask({
    store: taskStore,
    generationApis,
    createSubmissionId: () => createId("submission"),
  });

  function getWorkflow(runId: WorkflowRun["id"]) {
    const run = cache.get(runId);
    return run ? structuredClone(run) : null;
  }

  async function getWorkflowByCharacter(characterId: string) {
    const run = [...cache.values()].find(
      (item) => item.characterId === characterId,
    );
    if (run) return structuredClone(run);
    const stored = await store.getByCharacter(characterId);
    return stored ? rememberStored(stored) : null;
  }

  async function requireWorkflow(runId: WorkflowRun["id"]) {
    const run = await load(runId);
    if (!run) throw new Error(`WorkflowRun 不存在：${runId}`);
    return run;
  }

  function subscribe(
    runId: WorkflowRun["id"],
    listener: (run: WorkflowRun) => void,
  ) {
    const runListeners =
      listeners.get(runId) ?? new Set<(run: WorkflowRun) => void>();
    runListeners.add(listener);
    listeners.set(runId, runListeners);
    return () => {
      runListeners.delete(listener);
      if (runListeners.size === 0) listeners.delete(runId);
    };
  }

  async function create(
    input: CreateWorkflowControllerInput,
  ): Promise<WorkflowRun> {
    const created = await store.create(input);
    rememberStored(created);
    return persist(
      createWorkflowRunState(input, {
        runId: created.id || createId("run"),
        createdAt: created.createdAt || now(),
      }),
    );
  }

  async function appendAction(runId: WorkflowRun["id"]): Promise<WorkflowRun> {
    return persist(appendActionState(await requireWorkflow(runId)));
  }

  async function updateCharacterSetup(
    runId: WorkflowRun["id"],
    input: CharacterSetupNodeInput,
  ): Promise<WorkflowRun> {
    return persist(
      updateCharacterSetupState(await requireWorkflow(runId), input),
    );
  }

  async function acceptUploadedCharacterTemplate(
    runId: WorkflowRun["id"],
    templateUrl: MediaReference,
  ): Promise<WorkflowRun> {
    return persist(
      acceptUploadedCharacterTemplateState(
        await requireWorkflow(runId),
        templateUrl,
      ),
    );
  }

  async function nextStep(
    runId: WorkflowRun["id"],
    spriteSize?: { width: number; height: number },
  ): Promise<WorkflowRun> {
    const run = requireActiveWorkflow(await requireWorkflow(runId));
    const activeNode = getActiveNode(run);
    if (!activeNode) throw new Error("当前 WorkflowRun 没有 active 节点");

    if (activeNode.type === "character-template") {
      return characterTemplateTask.start(runId, {
        runId: run.id,
        nodeId: activeNode.id,
      });
    }
    if (activeNode.type !== "character-setup") {
      throw new Error(`节点 ${activeNode.type} 尚未进入本轮实现`);
    }

    if (!spriteSize) throw new Error("推进角色资料节点需要项目精灵图尺寸");

    const transitioned = advanceCharacterSetupState(run, spriteSize);
    await persist(transitioned.run);
    return characterTemplateTask.start(runId, transitioned.target);
  }

  function resume(runId: WorkflowRun["id"]) {
    return load(runId).then((run) => {
      if (!run || run.status !== "active") return run;
      const node = getActiveNode(run);
      return node?.type === "action-first-frame" || node?.type === "action-full-frame"
        ? actionGenerationTask.resume(runId)
        : characterTemplateTask.resume(runId);
    });
  }

  async function interrupt(runId: WorkflowRun["id"]): Promise<WorkflowRun> {
    const run = await requireWorkflow(runId);
    if (run.status !== "active") return run;

    characterTemplateTask.stop(runId);
    actionGenerationTask.stop(runId);
    const latest = await requireWorkflow(runId);
    if (latest.status !== "active") return latest;
    return persist(interruptWorkflowRunState(latest));
  }

  async function confirmFirstFrame(runId: WorkflowRun["id"]): Promise<WorkflowRun> {
    return persist(confirmFirstFrameState(await requireWorkflow(runId)));
  }

  async function startActionFromTemplate(
    runId: WorkflowRun["id"],
    templateImageUrl: string,
    actionDescription?: string,
  ): Promise<WorkflowRun> {
    const pending = templateActionSubmissions.get(runId);
    if (pending) return pending;
    const submission = submitActionFromTemplate(
      runId,
      templateImageUrl,
      actionDescription,
    ).finally(() => templateActionSubmissions.delete(runId));
    templateActionSubmissions.set(runId, submission);
    return submission;
  }

  async function submitActionFromTemplate(
    runId: WorkflowRun["id"],
    templateImageUrl: string,
    actionDescription?: string,
  ): Promise<WorkflowRun> {
    if (!characterApis) throw new Error("角色服务尚未配置，不能开始动作生成");

    const run = await requireWorkflow(runId);
    const initialState = getTemplateActionInputState(run, templateImageUrl);
    let character: Awaited<ReturnType<CharacterApis["create"]>> | null = null;
    let bound = false;
    try {
      character = await characterApis.create({
        projectId: run.projectId,
        description: "Workflow auto-created character",
        referenceImageUrl: templateImageUrl,
      });

      if (character.outfits.length === 0) {
        character = await characterApis.update({
          ...character,
          outfits: [
            {
              id: `outfit-${character.id}-default`,
              characterId: character.id,
              name: "默认造型",
              candidateCharacterTemplates: [],
              characterTemplateUrl: templateImageUrl,
              baseFrames: [],
              actions: [],
            },
          ],
        });
      }

      const outfitId = character.outfits[0]?.id;
      if (!outfitId) throw new Error("角色服务没有返回可用的造型 ID");

      const latest = await requireWorkflow(runId);
      const latestState = getTemplateActionInputState(latest, templateImageUrl);
      if (latestState !== initialState) {
        throw new Error("角色母版节点已变更，不能继续提交动作生成");
      }
      const ready =
        latestState === "candidate-active"
          ? await persist(confirmFirstFrameState(latest))
          : latest;
      const boundRun = await persist({
        ...ready,
        characterId: character.id,
        outfitId,
      });
      bound = true;
      const prompt = actionDescription?.trim();

      return await actionGenerationTask.start(runId, {
        type: "character_action",
        projectId: boundRun.projectId,
        characterId: character.id,
        outfitId,
        actionType: prompt ? "custom" : "idle",
        firstFrameUrl: templateImageUrl,
        prompt: prompt || null,
        referenceMedia: [templateImageUrl as MediaReference],
        numFrames: 32,
      });
    } catch (error) {
      if (!bound && character) {
        try {
          await characterApis.remove(character.id);
        } catch (cleanupError) {
          console.error("[workflow] 清理未绑定角色失败", cleanupError);
        }
      }
      const failedRun = await load(runId);
      if (bound && failedRun?.status === "active") {
        const activeNode = getActiveNode(failedRun);
        if (
          (activeNode?.type === "action-first-frame" || activeNode?.type === "action-full-frame") &&
          !activeNode.taskId &&
          !activeNode.submissionId
        ) {
          const message =
            error instanceof Error && error.message.trim()
              ? error.message.trim()
              : "动作生成失败";
          await persist(
            completeActionGenerationState(failedRun, { error: message }),
          );
        }
      }
      throw error;
    }
  }

  async function completeActionGeneration(
    runId: WorkflowRun["id"],
    result: CharacterActionOutput | { error: string },
  ): Promise<WorkflowRun> {
    const run = await requireWorkflow(runId);
    if (run.status !== "active") {
      console.warn("[completeActionGen] run not active:", run.status);
      return run;
    }
    const node = getActiveNode(run);
    if (!node || node.status !== "active") {
      console.warn(
        "[completeActionGen] node not active:",
        node?.type,
        node?.status,
      );
      return run;
    }
    if ("error" in result)
      return persist(completeActionGenerationState(run, result));

    const frameCountError = getCharacterActionFrameCountError(result);
    return persist(
      completeActionGenerationState(
        run,
        frameCountError ? { error: frameCountError } : result,
      ),
    );
  }

  function startActionGeneration(
    runId: WorkflowRun["id"],
    input: CharacterActionGenerationInput,
  ) {
    return actionGenerationTask.start(runId, input);
  }

  async function approveReview(runId: WorkflowRun["id"]): Promise<WorkflowRun> {
    return persist(approveReviewState(await requireWorkflow(runId)));
  }

  async function approveAndPublish(
    runId: WorkflowRun["id"],
  ): Promise<WorkflowRun> {
    if (!characterApis) throw new Error("角色服务尚未配置，不能发布资产");
    const run = await requireWorkflow(runId);
    const reviewStep = run.nodes.findLast((node) => node.type === "review");
    const approved =
      run.status === "active" && reviewStep?.status === "active"
        ? await approveReview(runId)
        : run.status === "completed" && reviewStep?.status === "passed"
          ? run
          : null;
    if (!approved) throw new Error("审核节点尚未就绪，不能发布资产");

    await publishWorkflowRun(characterApis, approved);
    return approved;
  }

  async function recordActionGenerationTask(
    runId: WorkflowRun["id"],
    taskId: string,
  ): Promise<WorkflowRun> {
    const run = await requireWorkflow(runId);
    if (run.status !== "active") {
      console.warn("[recordActionTask] run not active:", run.status);
      return run;
    }
    return persist(recordActionGenerationTaskState(run, taskId));
  }

  async function recordCharacterRefs(
    runId: WorkflowRun["id"],
    refs: { characterId: string; outfitId: string },
  ): Promise<WorkflowRun> {
    const run = await requireWorkflow(runId);
    if (run.status !== "active") {
      console.warn("[recordCharacterRefs] run not active:", run.status);
      return run;
    }
    return persist({
      ...run,
      characterId: refs.characterId,
      outfitId: refs.outfitId,
    });
  }

  async function restart(
    runId: WorkflowRun["id"],
    nodeId: string,
  ): Promise<WorkflowRun> {
    characterTemplateTask.stop(runId);
    actionGenerationTask.stop(runId);
    return persist(
      restartWorkflowRunState(await requireWorkflow(runId), nodeId),
    );
  }

  return {
    create,
    getWorkflow,
    getWorkflowByCharacter,
    subscribe,
    appendAction,
    updateCharacterSetup,
    acceptUploadedCharacterTemplate,
    nextStep,
    confirmFirstFrame,
    startActionFromTemplate,
    completeActionGeneration,
    startActionGeneration,
    approveReview,
    approveAndPublish,
    recordActionGenerationTask,
    recordCharacterRefs,
    restart,
    resume,
    interrupt,
  };
}

function getTemplateActionInputState(
  run: WorkflowRun,
  _templateImageUrl: string,
): "first-frame-active" | "uploaded-template" {
  const firstFrameNode = run.nodes.find(
    (node) => node.type === "action-first-frame",
  );
  const activeNode = getActiveNode(run);
  if (
    firstFrameNode?.status === "active" &&
    activeNode?.type === "action-first-frame"
  ) {
    return "first-frame-active";
  }
  if (
    firstFrameNode?.status === "passed" &&
    (activeNode?.type === "action-full-frame" || activeNode?.type === "review")
  ) {
    return "uploaded-template";
  }
  throw new Error("当前流程状态不能开始动作生成");
}

function hasSelectedTemplateUrl(
  output: unknown,
  templateImageUrl: string,
): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    "selectedImageUrl" in output &&
    output.selectedImageUrl === templateImageUrl
  );
}

function createRuntimeId(scope: "run" | "submission") {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${scope}-${suffix}`;
}
