/** entities 唯一公开入口。外部不得绕过本文件访问内部文件。 */

/* 用户 —— 认证传输与稳定会话身份 */
export { createUserApis, userApis } from './user'
export type { AuthTokens, CreateUserApisOptions, SendCodePurpose, User, UserApis } from './user'

/* 项目 —— 全局约束：视角、朝向、精灵尺寸、画风 */
export { CHARACTER_PERSPECTIVE, DIRECTIONAL_MOVEMENT } from './project'
export { projectApis } from './project'
export type {
  CharacterPerspective,
  CreateProjectInput,
  DirectionalMovement,
  Project,
  ProjectApis,
  ProjectPageQuery,
} from './project'

/* 角色 —— 资产本体；造型、动作、帧都在这棵树里 */
export type {
  Action,
  ActionType,
  Character,
  CharacterApis,
  CreateCharacterInput,
  Frame,
  Outfit,
} from './character'
export { characterApis } from './character'

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
  GenerationEvent,
  GenerationInput,
  GenerationResult,
  GenerationResultFor,
  GenerationType,
  TaskStatus,
} from './generation'

/* 媒体引用 —— 不承诺 URL 或后端 Media ID 的具体表示 */
export type { MediaReference } from './media'

/* 工作流 —— 前端管理节点，后端只持久化完整 nodes 文档 */
export { workflowRunApis } from './workflow-run'
export type {
  ActionFirstFrameWorkflowNode,
  ActionFullFrameWorkflowNode,
  CharacterSetupWorkflowNode,
  CharacterTemplateWorkflowNode,
  CreateWorkflowRunInput,
  ReviewWorkflowNode,
  WorkflowActionInput,
  WorkflowCharacterInput,
  WorkflowGenerationRef,
  WorkflowGenerationRole,
  WorkflowNode,
  WorkflowNodePhase,
  WorkflowNodeStatus,
  WorkflowNodeType,
  WorkflowRunApis,
  WorkflowRunStorageStatus,
  WorkflowRun,
} from './workflow-run'
