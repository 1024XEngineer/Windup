/**
 * entities 唯一公开入口。外部不得绕过本文件访问内部文件。
 * 本次只提交类型与接口，不提交实现。
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
export { createCharacterApis } from './character/api'

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

/* Playtest 核验 —— 只保存某个动作当前的核验结论，不承担历史记录。 */
export { createPlaytestInspectionApis } from './playtest-inspection/api'
export type {
  PlaytestInspection,
  PlaytestInspectionApis,
  PlaytestInspectionStatus,
  PlaytestInspectionTarget,
  SavePlaytestInspectionInput,
} from './playtest-inspection'

/* 工作流 —— 节点与运行状态都由前端管理 */
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
  WorkflowRunPurpose,
  WorkflowRunStatus,
} from './workflow-run'
