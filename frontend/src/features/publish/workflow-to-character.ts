/**
 * WorkflowRun → Character 桥接层。
 * 从工作流节点中提取数据，组装为 Playtest 可消费的 Character 实体。
 * 前三个角色节点只读取一次，后续按 action-full-frame / review 成对读取全部动作。
 */
import type {
  Action,
  Character,
  CharacterTemplateCandidate,
  Frame,
  Outfit,
  WorkflowRevision,
  WorkflowRun,
  WorkflowNode,
} from "@/entities";

function getRevision(run: WorkflowRun): WorkflowRevision | null {
  return [run].find((r) => r.id === run.id) ?? null;
}

function getNode(
  revision: WorkflowRevision,
  type: string,
): WorkflowNode | null {
  return revision.nodes.find((s) => s.type === type) ?? null;
}

/** 从 character-template 节点提取母版 URL */
function extractCharacterTemplateUrl(
  revision: WorkflowRevision,
): string | null {
  const template = getNode(revision, "character-template");
  const templateOutput = template?.output as { imageUrls?: string[] } | null;
  return templateOutput?.imageUrls?.[0] ?? null;
}

/** 从 character-template 节点提取候选列表 */
function extractCandidates(
  revision: WorkflowRevision,
): CharacterTemplateCandidate[] {
  const node = getNode(revision, "character-template");
  const output = node?.output as { imageUrls?: string[] } | null;
  if (!output?.imageUrls) return [];
  return output.imageUrls.map((imageUrl, i) => ({
    id: `candidate-${i}`,
    imageUrl,
    attemptId: `attempt-${Date.now()}`,
  }));
}

/** 从 character-setup 节点提取角色描述 */
function extractDescription(revision: WorkflowRevision): string {
  const node = getNode(revision, "character-setup");
  const input = node?.input as { description?: string } | null;
  return input?.description?.trim() || "未命名角色";
}

/** 只导出已经通过对应审核的动作，未审核的中间结果不进入正式 Character。 */
function extractReviewedActions(revision: WorkflowRevision) {
  return revision.nodes.flatMap((node, index) => {
    const review = revision.nodes[index + 1];
    return node.type === "action-full-frame" &&
      node.status === "passed" &&
      node.output &&
      review?.type === "review" &&
      review.status === "passed"
      ? [node]
      : [];
  });
}

/**
 * 将 WorkflowRun 转换为 Character 实体。
 * 如果关键节点未完成，返回 null。
 */
export function workflowRunToCharacter(run: WorkflowRun): Character | null {
  const revision = getRevision(run);
  if (!revision) return null;

  const templateNode = getNode(revision, "character-template");

  // 至少需要母版已生成
  if (!templateNode || templateNode.status !== "passed") return null;

  const characterTemplateUrl = extractCharacterTemplateUrl(revision);
  const candidates = extractCandidates(revision);
  const description = extractDescription(revision);
  const reviewedActions = extractReviewedActions(revision);

  // 一条 Run 可以持续追加动作；每个动作使用节点 ID 作为稳定后缀，避免发布时互相覆盖。
  const actions: Action[] = reviewedActions.map((node, index) => {
    const frames: Frame[] = (node.output?.frames ?? []).map((frame) => ({
      imageUrl: frame.imageUrl,
      durationMs: frame.durationMs,
      rootMotion: null,
    }));
    const customName = node.input?.prompt?.trim();
    return {
      id: `${run.id}-${node.id}`,
      outfitId: `${run.id}-outfit`,
      name:
        customName ||
        (reviewedActions.length === 1
          ? description.length > 8
            ? `${description.slice(0, 8)}…`
            : description || "动作"
          : `动作 ${index + 1}`),
      expectedFrameCount: frames.length,
      kind: "custom",
      type: node.output?.actionType ?? "custom",
      fps: 8,
      keyFrameIndex: null,
      frames,
    };
  });

  // 构建造型
  const outfit: Outfit = {
    id: `${run.id}-outfit`,
    characterId: run.id,
    name: "默认造型",
    candidateCharacterTemplates: candidates,
    characterTemplateUrl,
    baseFrames: characterTemplateUrl
      ? [{ imageUrl: characterTemplateUrl }]
      : [],
    actions,
  };

  // 构建角色
  const character: Character = {
    id: run.id,
    projectId: run.projectId,
    outfits: [outfit],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return character;
}

/**
 * 检查 WorkflowRun 是否已准备好导出到 Playtest。
 * 至少需要：母版已确认 + 动作生成完成。
 */
export function canPublishToPlaytest(run: WorkflowRun): boolean {
  const revision = getRevision(run);
  if (!revision) return false;

  const templateNode = getNode(revision, "character-template");
  const reviewedActions = extractReviewedActions(revision);
  return (
    run.status === "completed" &&
    templateNode?.status === "passed" &&
    reviewedActions.length > 0 &&
    reviewedActions.every((node) => Boolean(node.output?.frames.length))
  );
}
