/**
 * entities 唯一公开入口。外部不得绕过本文件访问内部文件。
 * 外部只从这里使用实体契约与已经落地的实体能力。
 */

/* 用户 —— 认证态与账户资料。 */
export { createUserApis } from './user/api'
export type { CreateUserApisOptions } from './user/api'
export type { AuthTokens, User, UserApis } from './user'

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
export { CHARACTER_ACTION_FRAME_COUNT } from './generation'
export { createGenerationApis } from './generation/api'
export type {
  CharacterActionFrame,
  CharacterActionGenerationInput,
  CharacterActionOutput,
  CharacterImageGenerationInput,
  CharacterImageOutput,
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

/* Playtest 核验 —— 每个动作当前最新的核验结论，不形成历史版本 */
export { createPlaytestInspectionApis } from './playtest-inspection/api'
export type {
  PlaytestInspection,
  PlaytestInspectionApis,
  PlaytestInspectionStatus,
  PlaytestInspectionTarget,
  SavePlaytestInspectionInput,
} from './playtest-inspection'

/* 工作流 —— 节点与运行状态都由前端管理 */
export { createWorkflowRunStore, WORKFLOW_NODE_ORDER } from './workflow-run'
export type {
  CharacterSetupNodeInput,
  CharacterSetupWorkflowNode,
  CharacterTemplateWorkflowNode,
  ActionFirstFrameWorkflowNode,
  ActionFullFrameWorkflowNode,
  CreateWorkflowRunInput,
  ExportStatus,
  GenerationStatus,
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowNodeType,
  WorkflowRun,
  WorkflowRunStore,
  WorkflowRunPurpose,
  WorkflowRunStatus,
  WorkflowRevision,
  CreateWorkflowRunStoreOptions,
} from './workflow-run'
