/**
 * entities 唯一公开门面。外部不得绕过本文件访问内部 Entity 文件。
 * WorkflowRun 由前端推进、后端持久化；当前通过异步 Repository 保持调用方稳定。
 */

/* 项目 —— 前端领域骨架，真实 API 契约已撤回 */
export {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  SPRITE_SIZES,
  useProject,
  useProjects,
} from './project'
export type {
  CharacterPerspective,
  CreateProjectInput,
  DirectionalMovement,
  Project,
  ProjectRepository,
} from './project'

/* 媒体引用 —— 不承诺 URL 或后端 Media ID 的具体表示 */
export type { MediaReference } from './media'

/* 角色 / 动作 / 帧 —— 仅类型与 Repository 契约 */
export type {
  Action,
  ActionKind,
  ActionType,
  ActionStatus,
  AddActionInput,
  BaseFrame,
  Character,
  CharacterReader,
  CharacterRepository,
  CharacterTemplateCandidate,
  ConfirmCharacterTemplateInput,
  CreateCharacterInput,
  Frame,
  FrameQcResult,
  FrameRootMotion,
  Outfit,
} from './character'

/* 工作流数据 —— 后端持久化的 WorkflowRun、Revision、八阶段节点和异步 Repository 契约 */
export { WORKFLOW_NODE_ORDER } from './workflow-run'
export type {
  CreateWorkflowRunInput,
  ExportStatus,
  GenerationStatus,
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
  WorkflowRunPurpose,
  WorkflowRunReader,
  WorkflowRunRepository,
  WorkflowRunStatus,
} from './workflow-run'

/* 后端异步任务 —— 独立于前端 WorkflowRun 编排 */
export type { Task, TaskEvent, TaskEventSource, TaskRepository, TaskStatus, TaskType } from './task'

/* Playtest 核验记录 —— 独立于 Character、WorkflowRun 和 Revision */
export type {
  PlaytestInspection,
  PlaytestInspectionRepository,
  PlaytestInspectionStatus,
  RecordPlaytestInspectionInput,
} from './playtest-inspection'

/* 动作模板 —— 仅类型与 Repository 契约 */
export type { ActionTemplate, ActionTemplateRepository } from './action-template'
