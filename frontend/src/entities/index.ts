/**
 * 全部 Entity 类型的统一公共门面。
 *
 * Page、Feature 和 WorkflowController 可以从本入口导入跨实体类型；各实体内部
 * 仍优先从自己的入口导入，避免形成隐蔽循环依赖。本文件只转发类型，不创建全局
 * 状态，也不装配 APIs 实现。
 */
export type { ActionTemplate, ActionTemplateAPIs } from './action-template'
export type {
  Action,
  ActionSource,
  ActionStatus,
  ActionType,
  AddActionInput,
  ActionSequence,
  BaseFrame,
  Character,
  CharacterAPIs,
  CharacterTemplateCandidate,
  ConfirmCharacterTemplateInput,
  CreateCharacterInput,
  Frame,
  FrameQcResult,
  FrameRootMotion,
  Outfit,
} from './character'
export type {
  CreateGenerationInput,
  Generation,
  GenerationAPIs,
  GenerationStatus,
  GenerationType,
} from './generation'
export type {
  PlaytestInspection,
  PlaytestInspectionAPIs,
  PlaytestInspectionStatus,
  RecordPlaytestInspectionInput,
} from './playtest-inspection'
export type {
  CharacterPerspective,
  CreateProjectInput,
  DirectionMode,
  Project,
  ProjectAPIs,
  SpriteDirection,
  UpdateProjectInput,
} from './project'
export type { Task, TaskAPIs, TaskStatus } from './task'
export type {
  CreateWorkflowRunInput,
  WorkflowDriver,
  WorkflowRevision,
  WorkflowRevisionStatus,
  WorkflowRun,
  WorkflowRunAPIs,
  WorkflowRunPurpose,
  WorkflowRunStatus,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowStepType,
} from './workflow-run'
