import type { Project, WorkflowRun } from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'

/**
 * Quick Start 创建项目所需的页面级边界。
 *
 * 当前项目规划规则和 ProjectApis 实现都未落地，所以页面不能自己猜视角、方向、
 * 尺寸或伪造 projectId。后续实现负责把提示词整理成项目参数并返回真实项目。
 */
export type PrepareQuickStartProject = (prompt: string) => Promise<Pick<Project, 'id'>>

export interface QuickStartService {
  /** 为 null 时可以创建；非 null 时页面必须明确阻止提交，不能回退到假数据。 */
  readonly unavailableReason: string | null
  start(prompt: string): Promise<WorkflowRun>
  getWorkflow(runId: WorkflowRun['id']): WorkflowRun | null
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  interrupt(runId: WorkflowRun['id']): WorkflowRun | null
}

export interface CreateQuickStartServiceOptions {
  controller: WorkflowController
  prepareProject: PrepareQuickStartProject
}

/**
 * Quick Start 只改变输入与自动推进方式，WorkflowRun 状态仍由同一个 Controller 维护。
 * Project 必须先成功创建，避免产生没有真实项目归属的运行记录。
 */
export function createQuickStartService({
  controller,
  prepareProject,
}: CreateQuickStartServiceOptions): QuickStartService {
  return {
    unavailableReason: null,

    async start(prompt) {
      const normalizedPrompt = prompt.trim()
      if (!normalizedPrompt) throw new Error('请先描述想要创建的角色')

      const project = await prepareProject(normalizedPrompt)
      const projectId = project.id.trim()
      if (!projectId) throw new Error('项目服务没有返回有效的项目 ID')

      const created = controller.create({
        projectId,
        purpose: 'create_character',
        driver: 'ai',
        prompt: normalizedPrompt,
      })

      try {
        return await controller.nextStep(created.id)
      } catch (cause) {
        // Controller 会把生成提交失败写回同一条 Run。页面仍进入这条 Run 展示真实失败，
        // 而不是丢失 runId 后重新创建第二条记录。
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

    resume(runId) {
      return controller.resume(runId)
    },

    interrupt(runId) {
      const run = controller.getWorkflow(runId)
      return run ? controller.interrupt(runId) : null
    },
  }
}

const UNAVAILABLE_REASON = '项目与生成服务尚未配置，暂时无法开始新的创作'

/**
 * 当前生产组合还没有 Project / Generation / Task 实现。这里故意不可用，
 * 让未配置环境停在入口并说明原因，不能静默切换到 Mock 或伪造成功。
 */
export const unavailableQuickStartService: QuickStartService = {
  unavailableReason: UNAVAILABLE_REASON,

  async start() {
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

  interrupt() {
    return null
  },
}
