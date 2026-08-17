/** entities 唯一公开入口。外部不得绕过本文件访问内部文件。 */

/* 用户 —— 认证传输与稳定会话身份 */
export { createUserApis, userApis } from './user'
export type { AuthTokens, CreateUserApisOptions, SendCodePurpose, User, UserApis } from './user'

/* 积分 —— 读取当前用户的可用余额与账本汇总 */
export { createQuotaApis, quotaApis } from './quota'
export type {
  CreateQuotaApisOptions,
  CreditAccount,
  CreditTransaction,
  InviteCode,
  QuotaApis,
  QuotaTransactionPageQuery,
} from './quota'

/* 项目 —— 全局约束：视角、朝向、精灵尺寸、画风 */
export {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  ProjectHasCharactersError,
  ProjectNameConflictError,
} from './project'
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
  CharacterPageQuery,
  CharacterPublicationStatus,
  CharacterStatus,
  CreateCharacterInput,
  Frame,
  Outfit,
} from './character'
export { CHARACTER_STATUS, characterApis } from './character'
export { getOutfitPlayback } from './character/outfit-playback'

/* 动作模板 —— 能跨角色复用的配方 */
export type { ActionTemplate, ActionTemplateApis } from './action-template'

/* 生成 —— 业务数据，不是「调用生成能力」 */
export {
  createAuthenticatedGenerationApis,
  createGenerationApis,
  GenerationApiError,
  IMAGE_CANDIDATE_COUNT,
} from './generation/api'
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
  GenerationExpectation,
  GenerationInput,
  GenerationResult,
  GenerationResultFor,
  GenerationType,
  TaskStatus,
} from './generation'
export type { GenerationApiConfig, GenerationTransport } from './generation/api'

/* 媒体上传 —— 页面只依赖公开工厂与不透明引用，不处理 multipart 协议。 */
export { createMediaApis } from './media/api'
export type { MediaApis, MediaCategory, MediaReference } from './media'

/* 工作流 —— 前端管理节点，后端只持久化完整 nodes 文档 */
export { workflowRunApis } from './workflow-run'
export type {
  ActionFirstFrameWorkflowNode,
  ActionFullFrameWorkflowNode,
  ActionGenerationMethod,
  ActionGenerationMethodWorkflowNode,
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
