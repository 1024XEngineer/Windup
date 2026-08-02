/**
 * entities 唯一公开入口。外部不得绕过本文件访问内部文件。
 * 外部只从这里使用实体契约与已经落地的实体能力。
 */

/* 项目 —— 全局约束：视角、朝向、精灵尺寸、画风 */
export { CHARACTER_PERSPECTIVE, DIRECTIONAL_MOVEMENT, SPRITE_SIZES } from './project'
export { createProjectApis } from './project/api'
export type {
  CharacterPerspective,
  CreateProjectInput,
  DirectionalMovement,
  Project,
  ProjectApis,
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
export { createCharacterApis } from './character/api'

/* 生成 —— 业务数据，不是「调用生成能力」 */
export { parseCharacterTemplateGenerationResult } from './generation'
export { createGenerationApis } from './generation/api'
export type {
  CharacterTemplateGenerationInput,
  CharacterTemplateGenerationResult,
  CompleteAnimationGenerationInput,
  CompleteAnimationGenerationResult,
  FirstFrameGenerationInput,
  FirstFrameGenerationResult,
  GeneratedAnimationFrame,
  GeneratedImage,
  Generation,
  GenerationApis,
  GenerationEvent,
  GenerationInput,
  GenerationResult,
  GenerationResultFor,
  GenerationTaskStatus,
  GenerationType,
} from './generation'

/* 媒体引用 —— 不承诺 URL 或后端 Media ID 的具体表示 */
export { createMediaApis } from './media/api'
export type { MediaApis, MediaCategory, MediaReference } from './media'

/* 工作流 —— 节点与运行状态都由前端管理 */
export { createWorkflowRunStore, WORKFLOW_STEP_ORDER } from './workflow-run'
export type {
  CharacterSetupStepInput,
  CharacterSetupWorkflowStep,
  CharacterTemplateWorkflowStep,
  ActionGenerationWorkflowStep,
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
