/**
 * 工作流编辑器服务层 — 对齐 PR #74 的 QuickStartService 模式。
 */
import type { Project, WorkflowRun } from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'

export interface ProjectSetupInput {
  projectName: string
  view: string
  directions: string
  canvasSize: string
  style: string
}

export type PrepareWorkflowProject = (input: ProjectSetupInput) => Promise<Pick<Project, 'id'>>

export interface WorkflowEditorService {
  readonly unavailableReason: string | null
  createRun(input: ProjectSetupInput): Promise<WorkflowRun>
  getWorkflow(runId: WorkflowRun['id']): WorkflowRun | null
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  nextStep(runId: WorkflowRun['id']): Promise<WorkflowRun>
  interrupt(runId: WorkflowRun['id']): WorkflowRun | null
  updateCharacterSetup(runId: WorkflowRun['id'], input: { description: string; referenceMedia: readonly string[] }): WorkflowRun
}

export interface CreateWorkflowEditorServiceOptions {
  controller: WorkflowController
  prepareProject: PrepareWorkflowProject
}

export function createWorkflowEditorService({
  controller,
  prepareProject,
}: CreateWorkflowEditorServiceOptions): WorkflowEditorService {
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

      try {
        return await controller.nextStep(created.id)
      } catch (cause) {
        const stored = controller.getWorkflow(created.id)
        if (stored?.status === 'failed') return stored
        throw cause
      }
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
      return controller.nextStep(runId)
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
  async createRun() { throw new Error(UNAVAILABLE_REASON) },
  getWorkflow() { return null },
  subscribe() { return () => undefined },
  async resume() { return null },
  async nextStep() { throw new Error(UNAVAILABLE_REASON) },
  interrupt() { return null },
  updateCharacterSetup() { throw new Error(UNAVAILABLE_REASON) },
}
