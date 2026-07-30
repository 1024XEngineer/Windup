/**
 * entities 唯一公开入口。外部不得绕过本文件访问内部文件。
 * 本次只提交类型与接口，不提交实现。
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
  ActionStatus,
  ActionType,
  BaseFrame,
  Character,
  CharacterApis,
  CharacterTemplateCandidate,
  ConfirmCharacterTemplateInput,
  CreateCharacterInput,
  Frame,
  FrameQcResult,
  FrameRootMotion,
  Outfit,
} from './character'

/* 动作模板 —— 能跨角色复用的配方 */
export type { ActionTemplate, ActionTemplateApis } from './action-template'

/* 生成 —— 业务数据，不是「调用生成能力」 */
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

/* 工作流 —— 节点由前端推进，运行记录由后端持久化 */
export { WORKFLOW_STEP_ORDER } from './workflow-run'
export type {
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
  WorkflowRunApis,
  WorkflowRunPurpose,
  WorkflowRunStatus,
  WorkflowTaskLink,
} from './workflow-run'

/* Playtest 核验记录 —— 独立于 Character 与 WorkflowRun */
export type {
  PlaytestInspection,
  PlaytestInspectionApis,
  PlaytestInspectionStatus,
  RecordPlaytestInspectionInput,
} from './playtest-inspection'
