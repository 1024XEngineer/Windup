/**
 * Entity 层的唯一公开入口。
 *
 * Page 和 Feature 只从 `@/entities` 导入，不直接访问某个 Entity 的内部文件。
 * 这不是为了少写一段路径，而是为了稳定模块边界：内部文件可以重构，
 * 但公开名称和依赖方向必须经过本文件明确审核。
 *
 * 这里只暴露 Entity 级别的数据结构、后端端口契约以及必要的本地 Store 工厂。
 * 页面状态、路由、弹窗和按钮行为不属于 Entity，不应从此处导出。
 */

/* 项目 —— 全局约束：视角、朝向、精灵尺寸、画风 */
export { CHARACTER_PERSPECTIVE, DIRECTIONAL_MOVEMENT, SPRITE_SIZES } from './project'
export type {
  CharacterPerspective,
  CreateProjectInput,
  DirectionalMovement,
  Project,
  ProjectApis,
  UpdateProjectInput,
} from './project'

/* 角色 —— 资产本体；造型、动作、帧都在这棵树里 */
export type {
  Action,
  ActionKind,
  ActionType,
  BaseFrame,
  Character,
  CharacterApis,
  CharacterTemplateCandidate,
  ConfirmCharacterTemplateInput,
  CreateCharacterInput,
  Frame,
  FrameRootMotion,
  Outfit,
} from './character'

/* 动作模板 —— 能跨角色复用的配方 */
export type { ActionTemplate, ActionTemplateApis } from './action-template'

/* 生成 —— 业务数据，不是「调用生成能力」；后端的 task 就是它，不另立实体 */
export type {
  CharacterTemplateGenerationInput,
  CharacterTemplateGenerationResult,
  CompleteAnimationGenerationInput,
  CompleteAnimationGenerationResult,
  FirstFrameGenerationInput,
  FirstFrameGenerationResult,
  GeneratedImage,
  Generation,
  GenerationApis,
  GenerationEvent,
  GenerationInput,
  GenerationResult,
  GenerationResultFor,
  GenerationType,
  TaskStatus,
} from './generation'

/* 媒体引用 —— 不承诺 URL 或后端 Media ID 的具体表示 */
export type { MediaReference } from './media'

/*
 * 工作流 —— 记录“一次用户任务如何运行”。
 * 它不是角色/动作资产，也不是负责调后端的 WorkflowController。
 */
export {
  ACTION_FIRST_FRAME_CANDIDATE_COUNT,
  CHARACTER_CANDIDATE_COUNT,
  createWorkflowRunService,
  createWorkflowRunStore,
  WORKFLOW_STEP_ORDERS,
} from './workflow-run'
export type {
  ActionFirstFrameCandidateBatch,
  ActionReviewFrame,
  ActionReviewResult,
  CreateWorkflowRunStoreOptions,
  CreateWorkflowRunServiceOptions,
  CreateWorkflowRunInput,
  CharacterCandidateBatch,
  CharacterCandidateConfirmationApis,
  ConfirmCharacterSelectionInput,
  ConfirmActionFirstFrameInput,
  ExportStatus,
  GenerationStatus,
  WorkflowDriver,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowStepType,
  WorkflowRevision,
  WorkflowRevisionStatus,
  WorkflowRun,
  WorkflowRunStore,
  WorkflowRunService,
  WorkflowRunPurpose,
  WorkflowRunStatus,
  PublishActionResult,
  StartActionRunInput,
  StartCharacterRunInput,
} from './workflow-run'
