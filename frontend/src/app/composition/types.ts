import type { ProductionEnginePort } from '@/application/production-engine'
import type { WorkflowRestartPort } from '@/application/workflow-restart'
import type { WorkflowControllerPort } from '@/application/workflow-controller'
import type { ImageGenerationPort } from '@/capabilities/image-generation'
import type { ImageUploadPort } from '@/capabilities/image-upload'
import type {
  PlaytestInspectionRepository,
  CharacterRepository,
  ProjectRepository,
  TaskEventSource,
  TaskRepository,
  WorkflowRunRepository,
} from '@/entities'
import type { QuickStartService } from '@/pages/quick-start'

/** 由应用启动阶段一次性选择的外部实现。 */
export interface AppServices {
  projects: ProjectRepository
  /** Character 整树读取与更新边界，供项目页和 Playtest 只读消费。 */
  characters: CharacterRepository
  /** 前端流程存取只从组合根注入。页面只用它读取，状态变化由 Application 用例负责。 */
  workflowRuns: WorkflowRunRepository
  /** 原始图片能力留在组合根，供未来 Application 用例构造实现。 */
  imageGeneration: ImageGenerationPort
  /** 生成提交后的任务查询与取消入口；不直接注入页面。 */
  tasks: TaskRepository
  /** 任务事件订阅入口；不直接注入页面。 */
  taskEvents: TaskEventSource
  imageUpload: ImageUploadPort
  /** Quick Start 页面专用的自动创作会话服务。 */
  quickStart: QuickStartService
  /** 手动与自动入口共用的单次制作执行边界。 */
  productionEngine: ProductionEnginePort
  /** 从历史节点创建新执行线的唯一公开用例。 */
  workflowRestart: WorkflowRestartPort
  /** Quick Start 与手动编辑器共用的界面无关工作流推进用例。 */
  workflowController: WorkflowControllerPort
  /** 独立保存 Playtest 核验结论，不写入 Character 或 WorkflowRun。 */
  playtestInspections: PlaytestInspectionRepository
}
