/**
 * entities 唯一公开入口。外部不得绕过本文件访问内部文件。
 * 外部只从这里使用实体契约与已经落地的实体能力。
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

/* 生成 —— 业务数据，不是「调用生成能力」 */
export { parseCharacterTemplateGenerationResult } from './generation'
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
  GenerationInput,
  GenerationResult,
  GenerationResultFor,
  GenerationType,
} from './generation'

/* 媒体引用 —— 不承诺 URL 或后端 Media ID 的具体表示 */
export type { MediaReference } from './media'

/* 后端异步任务 —— 与工作流节点是两回事 */
export type { Task, TaskApis, TaskEvent, TaskStatus, TaskType } from './task'

/* 工作流 —— 节点与运行状态都由前端管理 */
export { createWorkflowRunStore, WORKFLOW_STEP_ORDER } from './workflow-run'
export type {
  CharacterSetupStepInput,
  CharacterSetupWorkflowStep,
  CharacterTemplateWorkflowStep,
  CreateWorkflowRunStoreOptions,
  CreateWorkflowRunInput,
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
  WorkflowRunPurpose,
  WorkflowRunStatus,
} from './workflow-run'
