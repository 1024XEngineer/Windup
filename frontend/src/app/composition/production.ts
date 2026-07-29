import type { ProductionEnginePort } from '@/application/production-engine'
import type { WorkflowRestartPort } from '@/application/workflow-restart'
import type { WorkflowControllerPort } from '@/application/workflow-controller'
import type { ImageGenerationPort } from '@/capabilities/image-generation'
import { createImageUploadAdapter } from '@/capabilities/image-upload'
import type {
  PlaytestInspectionRepository,
  CharacterRepository,
  ProjectRepository,
  TaskEventSource,
  TaskRepository,
} from '@/entities'
import type { WorkflowRunRepository } from '@/entities'
import type { QuickStartService } from '@/pages/quick-start'
import type { AppServices } from './types'

/**
 * Project API 契约已撤回。生产环境只注入明确失败的未配置 Repository，
 * 防止错误路径、DTO 或响应壳继续发出网络请求。
 */
export function createProductionAppServices(): AppServices {
  const projectUnavailable = (): never => {
    throw new Error('Project API 契约尚未冻结，真实接口已停用')
  }

  const projects: ProjectRepository = {
    async list() {
      return projectUnavailable()
    },
    async get() {
      return projectUnavailable()
    },
    async create() {
      return projectUnavailable()
    },
    async remove() {
      return projectUnavailable()
    },
  }

  const characters: CharacterRepository = {
    async get() {
      throw new Error('Character API 尚未配置')
    },
    async listByProject() {
      throw new Error('Character API 尚未配置')
    },
    async create() {
      throw new Error('Character API 尚未配置')
    },
    async update() {
      throw new Error('Character API 尚未配置')
    },
  }

  const workflowUnavailable = (): never => {
    throw new Error('WorkflowRun Repository 尚未配置')
  }
  const workflowRuns: WorkflowRunRepository = {
    async create() {
      return workflowUnavailable()
    },
    async get() {
      return workflowUnavailable()
    },
    async save() {
      return workflowUnavailable()
    },
  }

  const imageUpload = createImageUploadAdapter()

  const imageGeneration: ImageGenerationPort = {
    async submit() {
      throw new Error('图片生成能力尚未配置')
    },
  }

  const tasks: TaskRepository = {
    async get() {
      throw new Error('任务存取尚未配置')
    },
    async cancel() {
      throw new Error('任务存取尚未配置')
    },
  }

  const taskEvents: TaskEventSource = {
    subscribe() {
      throw new Error('任务事件订阅尚未配置')
    },
  }

  const quickStart: QuickStartService = {
    async start() {
      throw new Error('Quick Start 用例尚未配置')
    },
    async getSession() {
      throw new Error('Quick Start 用例尚未配置')
    },
    async interrupt() {
      throw new Error('Quick Start 用例尚未配置')
    },
  }

  const productionEngine: ProductionEnginePort = {
    async generate() {
      throw new Error('制作引擎尚未配置')
    },
    async cancelAttempt() {
      throw new Error('制作引擎尚未配置')
    },
  }

  const workflowRestart: WorkflowRestartPort = {
    async restart() {
      throw new Error('流程重启用例尚未配置')
    },
  }

  const workflowController: WorkflowControllerPort = {
    async advance() {
      throw new Error('工作流推进用例尚未配置')
    },
    async runToCompletion() {
      throw new Error('工作流推进用例尚未配置')
    },
  }

  const playtestInspections: PlaytestInspectionRepository = {
    async getLatest() {
      throw new Error('Playtest 核验记录尚未配置')
    },
    async record() {
      throw new Error('Playtest 核验记录尚未配置')
    },
  }

  return {
    projects,
    characters,
    workflowRuns,
    imageGeneration,
    tasks,
    taskEvents,
    imageUpload,
    quickStart,
    productionEngine,
    workflowRestart,
    workflowController,
    playtestInspections,
  }
}
