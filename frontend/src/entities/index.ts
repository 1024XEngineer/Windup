/**
 * entities 唯一公开门面。外部不得绕过本文件访问内部 Entity 文件。
 * WorkflowRun 是前端编排模型；Project 已有后端实现，其他独立能力等待 OpenAPI 接入。
 */

/* 项目 —— 已对接后端 PR #57 */
export {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  SPRITE_SIZES,
  createHttpProjectRepository,
  useProject,
  useProjects,
} from './project'
export type {
  CharacterPerspective,
  CreateHttpProjectRepositoryOptions,
  CreateProjectInput,
  DirectionalMovement,
  Project,
  ProjectRepository,
  ProjectRepositoryAdapterKind,
} from './project'

/* 角色 / 动作 / 帧 —— 提案，待与后端 review */
export {
  addAction,
  confirmAction,
  confirmCharacterTemplate,
  createCharacter,
  fetchCharacter,
  fetchCharactersByProject,
  useCharacter,
  useCharacters,
} from './character'
export type {
  Action,
  ActionKind,
  ActionStatus,
  AddActionInput,
  Character,
  CreateCharacterInput,
  Frame,
  FrameQcResult,
  Outfit,
} from './character'

/* 工作流数据 —— Revision、五节点和领域门禁 */
export {
  WORKFLOW_NODE_ORDER,
  canEnterNode,
  canImportToPlaytest,
  canRestartFromNode,
  canSubmitCommand,
  createWorkflowRun,
  fetchWorkflowRun,
  getCurrentNode,
  getCurrentRevision,
  getFirstAccessibleNodeType,
  getNode,
  getNodeByType,
  getRevision,
  isWorkflowNodeType,
  listRevisionHistory,
  nextNodeType,
  submitWorkflowCommand,
  useWorkflowRun,
} from './workflow-run'
export type {
  CreateWorkflowRunInput,
  ExportStatus,
  GenerationStatus,
  PlaytestStatus,
  WorkflowTaskLink,
  WorkflowCommand,
  WorkflowCommandKind,
  WorkflowDriver,
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowNodeType,
  WorkflowRevision,
  WorkflowRevisionStatus,
  WorkflowRun,
  WorkflowRunStatus,
} from './workflow-run'

/* 后端异步任务 —— 独立于前端 WorkflowRun 编排 */
export { subscribeTask } from './task'
export type { Task, TaskEvent, TaskStatus } from './task'

/* AI Provider 临时会话 —— Generation 只消费，不拥有其数据形状 */
export type {
  ProviderCredentialMode,
  ProviderDescriptor,
  ProviderSession,
  ProviderSessionStatus,
} from './provider-session'

/* 资产库 —— 提案，待与后端 review */
export { fetchActionTemplates, useActionTemplates } from './action-template'
export type { ActionTemplate } from './action-template'
export { fetchWearables, useWearables } from './wearable'
export type { Wearable } from './wearable'
