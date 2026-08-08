/**
 * 工作流编辑器服务层 — 对齐 PR #74 的 QuickStartService 模式。
 */
import type {
  ActionGenerationMethod,
  MediaApis,
  MediaReference,
  Project,
  WorkflowRun,
} from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'

export interface ProjectSetupInput {
  projectName: string
  view: string
  directions: string
  canvasSize: string
  style: string
}

export type PrepareWorkflowProject = (
  input: ProjectSetupInput,
) => Promise<Pick<Project, 'id' | 'spriteSize'>>

export interface WorkflowEditorService {
  readonly unavailableReason: string | null
  createRun(input: ProjectSetupInput): Promise<WorkflowRun>
  peekWorkflow(runId: WorkflowRun['id']): WorkflowRun | null
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  nextStep(runId: WorkflowRun['id']): Promise<WorkflowRun>
  continueWithUploadedTemplate(
    runId: WorkflowRun['id'],
    file: File,
    actionDescription: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRun>
  confirmCandidate(
    runId: WorkflowRun['id'],
    selectedImageUrl: string,
    actionDescription?: string,
    nodeId?: string,
  ): Promise<WorkflowRun>
  selectActionGenerationMethod(
    runId: WorkflowRun['id'],
    method: ActionGenerationMethod,
    nodeId?: string,
  ): Promise<WorkflowRun>
  approveReview(runId: WorkflowRun['id'], nodeId?: string): Promise<WorkflowRun>
  interrupt(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  updateCharacterSetup(
    runId: WorkflowRun['id'],
    input: { description: string; referenceMedia: readonly MediaReference[] },
  ): Promise<WorkflowRun>
}

export interface CreateWorkflowEditorServiceOptions {
  controller: WorkflowController
  prepareProject: PrepareWorkflowProject
  mediaApis?: MediaApis
  /** 刷新后恢复项目尺寸；项目 ID 已持久化在 WorkflowRun。 */
  getProject?: (projectId: string) => Promise<Pick<Project, 'spriteSize'>>
}

export function createWorkflowEditorService({
  controller,
  prepareProject,
  mediaApis,
  getProject,
}: CreateWorkflowEditorServiceOptions): WorkflowEditorService {
  /** 记录每个 runId 对应的项目精灵图尺寸，供后续 nextStep 调用使用。 */
  const spriteSizeMap = new Map<string, { width: number; height: number }>()

  return {
    unavailableReason: null,

    async createRun(input) {
      const project = await prepareProject(input)
      const projectId = project.id.trim()
      if (!projectId) throw new Error('项目服务没有返回有效的项目 ID')

      const created = await controller.create({
        projectId,
        purpose: 'create_character',
      })

      const spriteSize = {
        width: project.spriteSize.width,
        height: project.spriteSize.height,
      }
      spriteSizeMap.set(created.id, spriteSize)

      return created
    },

    peekWorkflow(runId) {
      return controller.peekWorkflow(runId)
    },

    subscribe(runId, listener) {
      return controller.subscribe(runId, listener)
    },

    async resume(runId) {
      return controller.resume(runId)
    },

    async nextStep(runId) {
      let spriteSize = spriteSizeMap.get(runId)
      if (!spriteSize) {
        const run = controller.peekWorkflow(runId)
        if (!run || !getProject) throw new Error('无法恢复项目精灵图尺寸')
        const project = await getProject(run.projectId)
        spriteSize = {
          width: project.spriteSize.width,
          height: project.spriteSize.height,
        }
        spriteSizeMap.set(runId, spriteSize)
      }
      return controller.nextStep(runId, spriteSize)
    },

    async continueWithUploadedTemplate(runId, file, actionDescription, signal) {
      if (!mediaApis) throw new Error('上传母版服务尚未配置')
      const templateUrl = await mediaApis.upload(file, 'reference-image', signal)
      await controller.acceptUploadedCharacterTemplate(runId, templateUrl)
      return controller.startActionFromTemplate(
        runId,
        templateUrl,
        actionDescription.trim() || undefined,
      )
    },

    async confirmCandidate(runId, selectedImageUrl, actionDescription, nodeId) {
      return controller.startActionFromTemplate(
        runId,
        selectedImageUrl,
        actionDescription?.trim() || undefined,
        nodeId,
      )
    },

    async selectActionGenerationMethod(runId, method, nodeId) {
      if (method === '3d-to-2d') throw new Error('3D 转 2D 后端接口尚未提供')
      const before = controller.peekWorkflow(runId)
      const methodNode = before?.nodes.find(
        (node) =>
          node.type === 'action-generation-method' &&
          !node.deletedAt &&
          (nodeId ? node.id === nodeId : node.status === 'active'),
      )
      if (!methodNode || methodNode.type !== 'action-generation-method') {
        throw new Error('动作生成路线节点尚未就绪')
      }
      const firstFrameNode = before?.nodes.find(
        (node) =>
          node.type === 'action-first-frame' && methodNode.dependsOnNodeIds.includes(node.id),
      )
      const firstFrameUrl =
        firstFrameNode?.type === 'action-first-frame'
          ? firstFrameNode.output?.frames[0]?.imageUrl
          : undefined
      if (
        firstFrameNode?.type !== 'action-first-frame' ||
        !firstFrameNode.input ||
        !firstFrameUrl
      ) {
        throw new Error('动作首帧尚未生成完成')
      }

      const selected = await controller.selectActionGenerationMethod(runId, method, methodNode.id)
      const fullFrameNode = selected.nodes.find(
        (node) =>
          node.type === 'action-full-frame' &&
          !node.deletedAt &&
          node.dependsOnNodeIds.includes(methodNode.id),
      )
      if (!fullFrameNode) throw new Error('动作生成路线没有关联完整动画节点')
      return controller.startActionGeneration(
        runId,
        {
          ...firstFrameNode.input,
          firstFrameUrl,
          referenceMedia: [
            ...new Set([...firstFrameNode.input.referenceMedia, firstFrameUrl as MediaReference]),
          ],
          numFrames: 32,
        },
        fullFrameNode.id,
      )
    },

    async approveReview(runId, nodeId) {
      return controller.approveAndPublish(runId, nodeId)
    },

    async interrupt(runId) {
      const run = controller.peekWorkflow(runId)
      return run ? await controller.interrupt(runId) : null
    },

    updateCharacterSetup(runId, input) {
      return controller.updateCharacterSetup(runId, input)
    },
  }
}

const UNAVAILABLE_REASON = '项目与生成服务尚未配置，暂时无法开始新的创作'

export const unavailableWorkflowEditorService: WorkflowEditorService = {
  unavailableReason: UNAVAILABLE_REASON,
  async createRun() {
    throw new Error(UNAVAILABLE_REASON)
  },
  peekWorkflow() {
    return null
  },
  subscribe() {
    return () => undefined
  },
  async resume() {
    return null
  },
  async nextStep() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async continueWithUploadedTemplate() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async confirmCandidate() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async selectActionGenerationMethod() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async approveReview() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async interrupt() {
    return null
  },
  updateCharacterSetup() {
    throw new Error(UNAVAILABLE_REASON)
  },
}
