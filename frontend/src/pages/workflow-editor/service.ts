/**
 * 工作流编辑器服务层 — 对齐 PR #74 的 QuickStartService 模式。
 */
import type {
  MediaApis,
  MediaReference,
  Project,
  WorkflowRun,
} from "@/entities";
import type { WorkflowController } from "@/features/workflow-controller";

export interface ProjectSetupInput {
  projectName: string;
  view: string;
  directions: string;
  canvasSize: string;
  style: string;
}

export type PrepareWorkflowProject = (
  input: ProjectSetupInput,
) => Promise<Pick<Project, "id" | "spriteSize">>;

export interface WorkflowEditorService {
  readonly unavailableReason: string | null;
  createRun(input: ProjectSetupInput): Promise<WorkflowRun>;
  getWorkflow(runId: WorkflowRun["id"]): WorkflowRun | null;
  subscribe(
    runId: WorkflowRun["id"],
    listener: (run: WorkflowRun) => void,
  ): () => void;
  resume(runId: WorkflowRun["id"]): Promise<WorkflowRun | null>;
  nextStep(runId: WorkflowRun["id"]): Promise<WorkflowRun>;
  continueWithUploadedTemplate(
    runId: WorkflowRun["id"],
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRun>;
  confirmCandidate(
    runId: WorkflowRun["id"],
    selectedImageUrl: string,
  ): Promise<WorkflowRun>;
  approveReview(runId: WorkflowRun["id"]): Promise<WorkflowRun>;
  interrupt(runId: WorkflowRun["id"]): Promise<WorkflowRun | null>;
  updateCharacterSetup(
    runId: WorkflowRun["id"],
    input: { description: string; referenceMedia: readonly MediaReference[] },
  ): Promise<WorkflowRun>;
}

export interface CreateWorkflowEditorServiceOptions {
  controller: WorkflowController;
  prepareProject: PrepareWorkflowProject;
  mediaApis?: MediaApis;
  /** 刷新后恢复项目尺寸；项目 ID 已持久化在 WorkflowRun。 */
  getProject?: (projectId: string) => Promise<Pick<Project, "spriteSize">>;
}

export function createWorkflowEditorService({
  controller,
  prepareProject,
  mediaApis,
  getProject,
}: CreateWorkflowEditorServiceOptions): WorkflowEditorService {
  /** 记录每个 runId 对应的项目精灵图尺寸，供后续 nextStep 调用使用。 */
  const spriteSizeMap = new Map<string, { width: number; height: number }>();

  return {
    unavailableReason: null,

    async createRun(input) {
      const project = await prepareProject(input);
      const projectId = project.id.trim();
      if (!projectId) throw new Error("项目服务没有返回有效的项目 ID");

      const created = await controller.create({
        projectId,
        purpose: "create_character",
      });

      const spriteSize = {
        width: project.spriteSize.width,
        height: project.spriteSize.height,
      };
      spriteSizeMap.set(created.id, spriteSize);

      return created;
    },

    getWorkflow(runId) {
      return controller.getWorkflow(runId);
    },

    subscribe(runId, listener) {
      return controller.subscribe(runId, listener);
    },

    async resume(runId) {
      return controller.resume(runId);
    },

    async nextStep(runId) {
      let spriteSize = spriteSizeMap.get(runId);
      if (!spriteSize) {
        const run = controller.getWorkflow(runId);
        if (!run || !getProject) throw new Error("无法恢复项目精灵图尺寸");
        const project = await getProject(run.projectId);
        spriteSize = {
          width: project.spriteSize.width,
          height: project.spriteSize.height,
        };
        spriteSizeMap.set(runId, spriteSize);
      }
      return controller.nextStep(runId, spriteSize);
    },

    async continueWithUploadedTemplate(runId, file, actionDescription, signal) {
      if (!mediaApis) throw new Error("上传母版服务尚未配置");
      const templateUrl = await mediaApis.upload(
        file,
        "reference-image",
        signal,
      );
      await controller.acceptUploadedCharacterTemplate(runId, templateUrl);
      return controller.startActionFromTemplate(
        runId,
        templateUrl,
        actionDescription.trim() || undefined,
      );
    },

    async confirmCandidate(runId, selectedImageUrl) {
      return controller.startActionFromTemplate(runId, selectedImageUrl);
    },

    async approveReview(runId) {
      return controller.approveAndPublish(runId);
    },

    async interrupt(runId) {
      const run = controller.getWorkflow(runId);
      return run ? await controller.interrupt(runId) : null;
    },

    updateCharacterSetup(runId, input) {
      return controller.updateCharacterSetup(runId, input);
    },
  };
}

const UNAVAILABLE_REASON = "项目与生成服务尚未配置，暂时无法开始新的创作";

export const unavailableWorkflowEditorService: WorkflowEditorService = {
  unavailableReason: UNAVAILABLE_REASON,
  async createRun() {
    throw new Error(UNAVAILABLE_REASON);
  },
  getWorkflow() {
    return null;
  },
  subscribe() {
    return () => undefined;
  },
  async resume() {
    return null;
  },
  async nextStep() {
    throw new Error(UNAVAILABLE_REASON);
  },
  async continueWithUploadedTemplate() {
    throw new Error(UNAVAILABLE_REASON);
  },
  async confirmCandidate() {
    throw new Error(UNAVAILABLE_REASON);
  },
  async approveReview() {
    throw new Error(UNAVAILABLE_REASON);
  },
  async interrupt() {
    return null;
  },
  updateCharacterSetup() {
    throw new Error(UNAVAILABLE_REASON);
  },
};
