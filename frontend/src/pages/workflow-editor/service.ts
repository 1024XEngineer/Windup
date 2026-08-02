/**
 * 工作流编辑器服务层 — 对齐 PR #74 的 QuickStartService 模式。
 */
import type { MediaReference, Project, WorkflowRun } from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'
import { submitReview } from '@/features/review'

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
  getWorkflow(runId: WorkflowRun['id']): WorkflowRun | null
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  nextStep(runId: WorkflowRun['id']): Promise<WorkflowRun>
  confirmCandidate(runId: WorkflowRun['id'], selectedImageUrl: string): Promise<WorkflowRun>
  approveReview(runId: WorkflowRun['id']): Promise<WorkflowRun>
  interrupt(runId: WorkflowRun['id']): WorkflowRun | null
  updateCharacterSetup(
    runId: WorkflowRun['id'],
    input: { description: string; referenceMedia: readonly MediaReference[] },
  ): WorkflowRun
}

export interface CreateWorkflowEditorServiceOptions {
  controller: WorkflowController
  prepareProject: PrepareWorkflowProject
  /** 可复用 Quick Start 已实现的角色落库与动作生成编排。 */
  confirmCandidate?: (runId: WorkflowRun['id'], selectedImageUrl: string) => Promise<WorkflowRun>
  /** 刷新后恢复项目尺寸；项目 ID 已持久化在 WorkflowRun。 */
  getProject?: (projectId: string) => Promise<Pick<Project, 'spriteSize'>>
  /** 复用 Quick Start 的审核后发布逻辑。 */
  approveReview?: (runId: WorkflowRun['id']) => Promise<WorkflowRun>
}

export function createWorkflowEditorService({
  controller,
  prepareProject,
  confirmCandidate,
  getProject,
  approveReview,
}: CreateWorkflowEditorServiceOptions): WorkflowEditorService {
  /** 记录每个 runId 对应的项目精灵图尺寸，供后续 nextStep 调用使用。 */
  const spriteSizeMap = new Map<string, { width: number; height: number }>()

  return {
    unavailableReason: null,

    async createRun(input) {
      const project = await prepareProject(input)
      const projectId = project.id.trim()
      if (!projectId) throw new Error('项目服务没有返回有效的项目 ID')

      const created = controller.create({
        projectId,
        purpose: 'create_character',
        driver: 'manual',
      })

      const spriteSize = { width: project.spriteSize.width, height: project.spriteSize.height }
      spriteSizeMap.set(created.id, spriteSize)

      return created
    },

    getWorkflow(runId) {
      return controller.getWorkflow(runId)
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
        const run = controller.getWorkflow(runId)
        if (!run || !getProject) throw new Error('无法恢复项目精灵图尺寸')
        const project = await getProject(run.projectId)
        spriteSize = { width: project.spriteSize.width, height: project.spriteSize.height }
        spriteSizeMap.set(runId, spriteSize)
      }
      return controller.nextStep(runId, spriteSize)
    },

    async confirmCandidate(runId, selectedImageUrl) {
      return confirmCandidate
        ? confirmCandidate(runId, selectedImageUrl)
        : controller.confirmCandidate(runId, selectedImageUrl)
    },

    async approveReview(runId) {
      return approveReview
        ? approveReview(runId)
        : submitReview(controller, { runId, decision: { kind: 'approve' } })
    },

    interrupt(runId) {
      const run = controller.getWorkflow(runId)
      return run ? controller.interrupt(runId) : null
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
  getWorkflow() {
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
  async confirmCandidate() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async approveReview() {
    throw new Error(UNAVAILABLE_REASON)
  },
  interrupt() {
    return null
  },
  updateCharacterSetup() {
    throw new Error(UNAVAILABLE_REASON)
  },
}
