import {
  type CharacterImageOutput,
  type Generation,
  type GenerationApis,
  type GenerationEvent,
  type WorkflowRun,
  type WorkflowRunStore,
  type WorkflowNode,
} from "@/entities";
import {
  getActiveNode,
  replaceWorkflowNode,
  type WorkflowNodeTarget,
} from "./workflow-state";

interface ApplyServerResultInput extends WorkflowNodeTarget {
  taskId: string;
  result: unknown;
}

interface ActiveSubscription {
  runId: WorkflowRun["id"];
  stop: () => void;
}

export interface CharacterTemplateTask {
  start(
    runId: WorkflowRun["id"],
    target: WorkflowNodeTarget,
  ): Promise<WorkflowRun>;
  resume(runId: WorkflowRun["id"]): Promise<WorkflowRun | null>;
  stop(runId: WorkflowRun["id"]): void;
}

interface CreateCharacterTemplateTaskOptions {
  store: WorkflowRunStore;
  generationApis: GenerationApis;
  createSubmissionId: () => string;
}

/** 管理角色图生成的提交、任务关联、订阅和刷新恢复。 */
export function createCharacterTemplateTask({
  store,
  generationApis,
  createSubmissionId,
}: CreateCharacterTemplateTaskOptions): CharacterTemplateTask {
  const submissions = new Map<string, Promise<WorkflowRun>>();
  const subscriptions = new Map<string, ActiveSubscription>();

  async function getWorkflow(runId: WorkflowRun["id"]) {
    return store.get(runId);
  }

  async function requireWorkflow(runId: WorkflowRun["id"]) {
    const run = await getWorkflow(runId);
    if (!run) throw new Error(`WorkflowRun 不存在：${runId}`);
    return run;
  }

  async function save(run: WorkflowRun) {
    await store.save(run);
    return run;
  }

  async function start(
    runId: WorkflowRun["id"],
    target: WorkflowNodeTarget,
  ): Promise<WorkflowRun> {
    const run = await requireWorkflow(runId);
    const node = run.nodes.find((item) => item.id === target.nodeId);
    if (
      run.id !== target.runId ||
      !node ||
      node.type !== "character-template" ||
      node.status !== "active"
    ) {
      return run;
    }
    if (node.taskId) {
      ensureTaskSubscription(run, node.id, node.taskId);
      return requireWorkflow(runId);
    }
    if (!node.input) throw new Error("角色图生成节点缺少输入快照");
    return submit(runId, target);
  }

  function submit(runId: WorkflowRun["id"], target: WorkflowNodeTarget) {
    const key = submissionKey(runId, target.nodeId);
    const pending = submissions.get(key);
    if (pending) return pending;

    const submission = performSubmission(runId, target).finally(() =>
      submissions.delete(key),
    );
    submissions.set(key, submission);
    return submission;
  }

  async function performSubmission(
    runId: WorkflowRun["id"],
    target: WorkflowNodeTarget,
  ): Promise<WorkflowRun> {
    const before = await requireWorkflow(runId);
    const beforeNode = before.nodes.find((node) => node.id === target.nodeId);
    if (
      before.status !== "active" ||
      before.id !== target.runId ||
      !beforeNode ||
      beforeNode.type !== "character-template" ||
      beforeNode.status !== "active" ||
      !beforeNode.input
    ) {
      return before;
    }
    if (beforeNode.taskId) {
      ensureTaskSubscription(before, beforeNode.id, beforeNode.taskId);
      return before;
    }
    if (beforeNode.submissionId) {
      throw new Error("角色图生成请求仍在等待后端确认，不能重复提交");
    }

    const submissionId = createSubmissionId();
    await save(
      replaceWorkflowNode(before, beforeNode.id, (current) =>
        current.type === "character-template"
          ? { ...current, submissionId }
          : current,
      ),
    );

    try {
      const generation = await generationApis.create(beforeNode.input);
      const latest = await requireWorkflow(runId);
      const latestNode = latest.nodes.find((node) => node.id === target.nodeId);
      if (
        (latest.status !== "active" && latest.status !== "interrupted") ||
        latest.id !== target.runId ||
        !latestNode ||
        latestNode.type !== "character-template" ||
        latestNode.status !== "active" ||
        latestNode.taskId ||
        latestNode.submissionId !== submissionId
      ) {
        return latest;
      }
      const projectMatches =
        generation.projectId == null ||
        latest.projectId == null ||
        String(generation.projectId) === String(latest.projectId);
      if (generation.type !== "character_image" || !projectMatches) {
        throw new Error(
          `生成任务返回的类型或项目与当前 WorkflowRun 不匹配 ` +
            `(type: ${generation.type}, project: ${generation.projectId} vs ${latest.projectId})`,
        );
      }

      const withTask = await save(
        replaceWorkflowNode(latest, latestNode.id, (current) =>
          current.type === "character-template"
            ? { ...current, taskId: generation.id, submissionId: null }
            : current,
        ),
      );
      if (latest.status === "interrupted") return withTask;
      if (generation.status === "failed") {
        return await markFailed(
          runId,
          target,
          generation.id,
          null,
          generation.error?.trim() || "角色图生成任务失败",
        );
      }
      if (generation.status === "completed") {
        return await applyServerResult(runId, {
          ...target,
          taskId: generation.id,
          result: generation.result,
        });
      }

      ensureTaskSubscription(withTask, latestNode.id, generation.id);
      return await requireWorkflow(runId);
    } catch (cause) {
      await markFailed(
        runId,
        target,
        null,
        submissionId,
        errorMessage(cause, "角色图生成请求失败"),
      );
      throw cause instanceof Error ? cause : new Error(String(cause));
    }
  }

  function ensureTaskSubscription(
    run: WorkflowRun,
    nodeId: WorkflowNode["id"],
    taskId: string,
  ) {
    const key = subscriptionKey(run.id, nodeId, taskId);
    if (subscriptions.has(key)) return;

    subscriptions.set(key, { runId: run.id, stop: () => undefined });
    try {
      const stop = generationApis.subscribe(run.projectId, taskId, (event) => {
        void handleGenerationEvent(
          run.id,
          { runId: run.id, nodeId },
          taskId,
          event,
        ).catch((cause) => {
          console.error("[workflow] 保存角色图生成终态失败，正在重新查询", cause);
          void generationApis
            .get(run.projectId, taskId)
            .then((task) =>
              handleGenerationEvent(
                run.id,
                { runId: run.id, nodeId },
                taskId,
                taskEvent(task),
              ),
            )
            .catch((retryCause) => {
              console.error("[workflow] 重新保存角色图生成终态失败", retryCause);
            });
        });
      });
      const active = subscriptions.get(key);
      if (active) subscriptions.set(key, { ...active, stop });
      else stop();
    } catch (cause) {
      subscriptions.delete(key);
      throw cause;
    }
  }

  async function handleGenerationEvent(
    runId: WorkflowRun["id"],
    target: WorkflowNodeTarget,
    taskId: string,
    event: GenerationEvent,
  ) {
    if (
      event.taskId !== taskId ||
      event.status === "pending" ||
      event.status === "running"
    )
      return;
    if (event.status === "failed") {
      await markFailed(
        runId,
        target,
        taskId,
        null,
        event.error?.trim() || "角色图生成任务失败",
      );
      return;
    }
    if (event.type !== "character_image") {
      await markFailed(
        runId,
        target,
        taskId,
        null,
        "任务结果类型与角色图生成节点不匹配",
      );
      return;
    }
    await applyServerResult(runId, { ...target, taskId, result: event.result });
  }

  async function resume(runId: WorkflowRun["id"]): Promise<WorkflowRun | null> {
    const run = await getWorkflow(runId);
    if (!run || run.status !== "active") return run;
    const activeNode = getActiveNode(run);
    if (
      activeNode?.type !== "character-template" ||
      activeNode.status !== "active"
    )
      return run;
    const target = { runId: run.id, nodeId: activeNode.id };

    if (activeNode.submissionId && !activeNode.taskId) {
      if (submissions.has(submissionKey(run.id, activeNode.id))) return run;
      return await markFailed(
        run.id,
        target,
        null,
        activeNode.submissionId,
        "页面刷新时生成请求尚未返回任务 ID，已停止恢复以避免重复提交",
      );
    }
    if (!activeNode.taskId) return run;

    const task = await generationApis.get(run.projectId, activeNode.taskId);
    const latest = await getWorkflow(run.id);
    if (!latest || latest.status !== "active") return latest;
    const latestNode = latest.nodes.find((node) => node.id === activeNode.id);
    if (
      latestNode?.type !== "character-template" ||
      latestNode.status !== "active" ||
      latestNode.taskId !== activeNode.taskId
    ) {
      return latest;
    }
    if (task.id !== latestNode.taskId) {
      throw new Error("任务查询结果与 WorkflowRun 记录的 taskId 不匹配");
    }
    if (task.type !== "character_image") {
      return await markFailed(
        latest.id,
        { runId: latest.id, nodeId: latestNode.id },
        latestNode.taskId,
        null,
        "任务查询结果类型与角色图生成节点不匹配",
      );
    }
    if (task.status === "pending" || task.status === "running") {
      ensureTaskSubscription(latest, latestNode.id, latestNode.taskId);
    } else {
      await handleGenerationEvent(
        latest.id,
        { runId: latest.id, nodeId: latestNode.id },
        latestNode.taskId,
        taskEvent(task),
      );
    }
    return getWorkflow(runId);
  }

  async function applyServerResult(
    runId: WorkflowRun["id"],
    input: ApplyServerResultInput,
  ): Promise<WorkflowRun> {
    const run = await requireWorkflow(runId);
    if (run.status !== "active" || run.id !== input.runId) return run;

    const node = run.nodes.find((item) => item.id === input.nodeId);
    if (
      !node ||
      node.type !== "character-template" ||
      node.status !== "active" ||
      node.taskId !== input.taskId
    ) {
      return run;
    }
    const result = parseCharacterImageOutput(input.result);
    if (!result || result.imageUrls.length === 0) {
      return await markFailed(
        runId,
        { runId: run.id, nodeId: node.id },
        input.taskId,
        null,
        "角色图生成任务返回了无法识别的结果",
      );
    }
    const candidateStep = run.nodes.find(
      (item) => item.type === "template-candidate",
    );
    if (!candidateStep)
      throw new Error("WorkflowRun 缺少 template-candidate 节点");

    const updated: WorkflowRun = {
      ...run,
      nodes: run.nodes.map((current) => {
        if (current.id === node.id && current.type === "character-template") {
          return {
            ...current,
            status: "passed" as const,
            output: result,
            taskId: null,
            submissionId: null,
          };
        }
        if (
          current.id === candidateStep.id &&
          current.type === "template-candidate"
        ) {
          return { ...current, status: "active" as const };
        }
        return current;
      }),
    };
    stopSubscription(subscriptionKey(run.id, node.id, input.taskId));
    return save(updated);
  }

  async function markFailed(
    runId: WorkflowRun["id"],
    target: WorkflowNodeTarget,
    expectedTaskId: string | null,
    expectedSubmissionId: string | null,
    error: string,
  ) {
    const run = await requireWorkflow(runId);
    if (run.status !== "active" || run.id !== target.runId) return run;
    const node = run.nodes.find((item) => item.id === target.nodeId);
    if (
      !node ||
      node.type !== "character-template" ||
      node.status !== "active" ||
      (expectedTaskId !== null && node.taskId !== expectedTaskId) ||
      (expectedSubmissionId !== null &&
        node.submissionId !== expectedSubmissionId)
    ) {
      return run;
    }

    const failureMessage = error.trim() || "角色图生成失败";
    const failed = replaceWorkflowNode(run, node.id, (current) =>
      current.type === "character-template"
        ? {
            ...current,
            status: "failed",
            taskId: null,
            submissionId: null,
            error: failureMessage,
          }
        : current,
    );
    if (node.taskId)
      stopSubscription(subscriptionKey(run.id, node.id, node.taskId));
    return save({ ...failed, status: "failed", generationStatus: "failed" });
  }

  function stopSubscription(key: string) {
    const subscription = subscriptions.get(key);
    subscriptions.delete(key);
    try {
      subscription?.stop();
    } catch {
      // 停止订阅失败不能破坏已经保存的工作流状态。
    }
  }

  function stop(runId: WorkflowRun["id"]) {
    for (const [key, subscription] of subscriptions) {
      if (subscription.runId === runId) stopSubscription(key);
    }
  }

  return { start, resume, stop };
}

function parseCharacterImageOutput(
  value: unknown,
): CharacterImageOutput | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    !("imageUrls" in value)
  ) {
    return null;
  }
  if (value.type !== "character_image" || !Array.isArray(value.imageUrls))
    return null;
  const imageUrls = value.imageUrls.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return imageUrls.length > 0 ? { type: "character_image", imageUrls } : null;
}

function taskEvent(task: Generation): GenerationEvent {
  return {
    taskId: task.id,
    type: task.type,
    status: task.status,
    error: task.error,
    result: task.result,
  };
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim()
    ? cause.message.trim()
    : fallback;
}

function subscriptionKey(
  runId: WorkflowRun["id"],
  nodeId: WorkflowNode["id"],
  taskId: string,
) {
  return `${runId}:${nodeId}:${taskId}`;
}

function submissionKey(runId: WorkflowRun["id"], nodeId: WorkflowNode["id"]) {
  return `${runId}:${nodeId}`;
}
